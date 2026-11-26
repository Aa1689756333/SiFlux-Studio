package operations

import (
	"encoding/json"
	"strings"

	"infinite-canvas/backend/internal/canvas/capability"
)

func registerCanvasNodeConfigureOps(r *Registry) {
	properties := map[string]any{}
	descriptor, _ := capability.BuiltinRegistry().Resolve("image")
	for name, field := range descriptor.PatchFields {
		if name == "title" || name == "content" { continue }
		properties[name] = map[string]any{"type": field.Kind, "description": field.Description}
	}
	properties["count"] = map[string]any{"type": "integer", "minimum": 1, "maximum": 8}
	properties["transparentBackground"].(map[string]any)["enum"] = []string{"true", "false"}
	params, _ := json.Marshal(map[string]any{"type": "object", "additionalProperties": false,
		"properties": map[string]any{"canvasId": map[string]any{"type": "string"}, "nodeId": map[string]any{"type": "string"},
			"kind": map[string]any{"type": "string", "enum": []string{"image"}}, "expectedRevision": map[string]any{"type": "integer", "minimum": 1},
			"patch": map[string]any{"type": "object", "additionalProperties": false, "minProperties": 1, "properties": properties}},
		"required": []string{"canvasId", "nodeId", "kind", "expectedRevision", "patch"}})
	r.Register(Op{ReplaySafe: true, AssistantCanvas: true, ID: "canvas.node.configure", Summary: "设置图片节点或生图配置的草稿参数；不生成、不扣费，不改现有成品", Scope: ScopeCanvas, Params: params, Handler: opCanvasNodeConfigure})
}

func opCanvasNodeConfigure(ctx *Context, raw json.RawMessage) (any, error) {
	var args struct {
		CanvasID string `json:"canvasId"`
		NodeID string `json:"nodeId"`
		Kind string `json:"kind"`
		ExpectedRevision int64 `json:"expectedRevision"`
		Patch map[string]json.RawMessage `json:"patch"`
	}
	if err := decodeParams(raw, &args); err != nil { return nil, err }
	if args.CanvasID == "" || args.NodeID == "" || args.ExpectedRevision <= 0 || len(args.Patch) == 0 { return nil, InvalidArg("invalid_params", "需要画布、节点、类型、当前版本和参数") }
	if args.Kind != "image" { return nil, InvalidArg("unsupported_node_kind", "仅支持生图参数配置") }
	canvasRaw, err := ctx.Domain.UserCanvasProject(ctx.UserID, args.CanvasID)
	if err != nil { return nil, mapDomainError(err) }
	var doc map[string]any
	if err := json.Unmarshal(canvasRaw, &doc); err != nil { return nil, AsError(err) }
	if revision := canvasRevision(doc); revision != args.ExpectedRevision { return nil, Conflict("revision_conflict", "画布已变化，请重新读取", map[string]any{"currentRevision": revision}) }
	node := findDocNode(doc, args.NodeID)
	if node == nil { return nil, NotFound("node_not_found", "节点不在当前画布") }
	if node["type"] != "image" && node["type"] != "config" { return nil, InvalidArg("node_kind_mismatch", "目标不是图片节点或生图配置") }
	descriptor, _ := capability.BuiltinRegistry().Resolve("image")
	patch := map[string]any{}
	for name, value := range args.Patch {
		field, ok := descriptor.PatchFields[name]
		if !ok || name == "title" || name == "content" { return nil, InvalidArg("unsupported_field", "生图不支持参数 " + name) }
		if name == "count" {
			var count int
			if json.Unmarshal(value, &count) != nil || count < 1 || count > 8 { return nil, InvalidArg("invalid_parameter", "count 必须是 1..8 的整数") }
			patch[name] = float64(count)
			continue
		}
		var text string
		if string(value) == "null" || json.Unmarshal(value, &text) != nil || len([]rune(text)) > field.MaxRunes { return nil, InvalidArg("invalid_parameter", name + " 必须是长度有限的字符串") }
		if name == "transparentBackground" && text != "true" && text != "false" { return nil, InvalidArg("invalid_parameter", "transparentBackground 必须为 true 或 false") }
		if (name == "size" || name == "quality") && strings.TrimSpace(text) == "" { return nil, InvalidArg("invalid_parameter", name + " 不能为空") }
		patch[name] = text
	}
	if selected, exists := patch["model"]; exists {
		choice, err := ctx.Domain.ResolveAssistantGenerationModel("image", selected.(string))
		if err != nil { return nil, mapDomainError(err) }
		if choice.KindMismatch { return nil, InvalidArg("generation_model_kind_mismatch", "所选模型不支持生图") }
		if choice.ModelKey == "" || choice.Display == "" { return nil, PreconditionFailed("generation_model_unavailable", "所选模型当前不可用", nil) }
		patch["model"] = choice.ModelKey
	}
	if _, err := ctx.Domain.UpdateUserCanvasNodeFields(ctx.UserID, args.CanvasID, args.NodeID, patch, args.ExpectedRevision); err != nil { return nil, mapDomainError(err) }
	return canvasWriteResult(ctx, args.CanvasID, func(doc map[string]any) map[string]any {
		return map[string]any{"canvasId": args.CanvasID, "nodeId": args.NodeID, "node": findDocNode(doc, args.NodeID), "draftConfigured": true}
	})
}
