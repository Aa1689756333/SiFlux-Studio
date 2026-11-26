package operations

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"regexp"
	"sort"
	"strings"

	"infinite-canvas/backend/internal/assistantturns"
)

// MediaSourceOpener is optional: domain implementations must open only owned,
// ready resource bytes. No path or URL received from a model reaches a decoder.
type MediaSourceOpener interface {
	OpenMediaResource(context.Context, string, string) (io.ReadCloser, error)
}

type MediaSource struct {
	CanvasID      string `json:"canvasId"`
	NodeID        string `json:"nodeId,omitempty"`
	AssetID       string `json:"assetId,omitempty"`
	ResourceID    string `json:"resourceId"`
	Version       string `json:"version"`
	StartMs       int64  `json:"startMs"`
	EndMs         int64  `json:"endMs"`
	TimestampKind string `json:"timestampKind,omitempty"`
}

type MediaPart struct {
	Type     string      `json:"type"`
	MimeType string      `json:"mimeType"`
	Data     string      `json:"data"`
	SHA256   string      `json:"sha256"`
	Source   MediaSource `json:"source"`
}

type MediaResult struct {
	Source     MediaSource `json:"source"`
	DurationMs int64       `json:"durationMs"`
	HasVideo   bool        `json:"hasVideo"`
	HasAudio   bool        `json:"hasAudio"`
	Content    []MediaPart `json:"content"`
	Note       string      `json:"note,omitempty"`
}

type mediaArgs struct {
	CanvasID        string `json:"canvasId"`
	NodeID          string `json:"nodeId"`
	AssetID         string `json:"assetId"`
	ResourceID      string `json:"resourceId"`
	ExpectedVersion string `json:"expectedVersion"`
	StartMs         int64  `json:"startMs"`
	EndMs           int64  `json:"endMs"`
	Mode            string `json:"mode"`
}

// ValidateMediaReference shares the owned-node/asset linkage checks with chat
// admission. Client-supplied resource IDs never grant access on their own.
func ValidateMediaReference(domain Domain, userID, canvasID, nodeID, assetID, resourceID string) (string, error) {
	id, err := resolveMediaResource(&Context{Domain: domain, UserID: userID}, mediaArgs{
		CanvasID: canvasID, NodeID: nodeID, AssetID: assetID, ResourceID: resourceID,
	})
	if err != nil {
		return "", err
	}
	resource, err := domain.OwnedReadyResource(userID, id)
	if err != nil {
		return "", err
	}
	return resource.MimeType, nil
}

func registerMediaOps(r *Registry) {
	summaries := map[string]string{
		"media.overview": "读取已关联图片的版本与静态画面；用于确认图片内容和版本，不返回连续画面或音轨。",
		"media.inspect":  "读取已关联图片的静态画面；交付图片给支持视觉的模型前先读取一次，确认实际内容。",
	}
	for _, id := range []string{"media.overview", "media.inspect"} {
		operation := id
		r.Register(Op{AssistantCanvas: true, ID: operation, Summary: summaries[operation], ReadOnly: true, Scope: ScopeCanvas,
			Params:  json.RawMessage(`{"type":"object","properties":{"canvasId":{"type":"string"},"nodeId":{"type":"string"},"assetId":{"type":"string"},"resourceId":{"type":"string"},"expectedVersion":{"type":"string"},"startMs":{"type":"integer","minimum":0},"endMs":{"type":"integer","minimum":0},"mode":{"type":"string","description":"图片只支持 frames：读取静态画面。","enum":["frames"]}},"required":["canvasId"]}`),
			Handler: func(ctx *Context, raw json.RawMessage) (any, error) { return runMedia(ctx, operation, raw) }})
	}
}

func resolveMediaResource(ctx *Context, args mediaArgs) (string, error) {
	if strings.TrimSpace(args.CanvasID) == "" || (args.NodeID == "") == (args.AssetID == "") {
		return "", InvalidArg("invalid_media_target", "指定 canvasId 和一个 nodeId 或 assetId")
	}
	var target any
	if assistantturns.IsWorkspaceConversation(args.CanvasID) {
		if args.NodeID != "" {
			return "", PermissionDenied("node_not_in_canvas", "独立对话没有画布节点")
		}
		asset, err := ctx.Domain.OwnedAsset(ctx.UserID, args.AssetID)
		if err != nil {
			return "", mapDomainError(err)
		}
		if asset == nil {
			return "", NotFound("asset_not_found", "素材不存在")
		}
		if err := json.Unmarshal([]byte(asset.PayloadJSON), &target); err != nil {
			return "", PreconditionFailed("media_reference_unreadable", "素材引用无法读取", nil)
		}
	} else {
		// Read the owned canvas even for asset targets; scope authorization is enforced
		// by the registry before this function, not by model-provided claims.
		raw, err := ctx.Domain.UserCanvasProject(ctx.UserID, args.CanvasID)
		if err != nil {
			return "", mapDomainError(err)
		}
		var doc map[string]any
		if err := json.Unmarshal(raw, &doc); err != nil {
			return "", AsError(err)
		}
		if args.NodeID != "" {
			for _, candidate := range canvasNodes(doc) {
				if node, ok := candidate.(map[string]any); ok && node["id"] == args.NodeID {
					target = node
					break
				}
			}
			if target == nil {
				return "", PermissionDenied("node_not_in_canvas", "节点不属于指定画布")
			}
		} else {
			asset, err := ctx.Domain.OwnedAsset(ctx.UserID, args.AssetID)
			if err != nil {
				return "", mapDomainError(err)
			}
			if asset == nil {
				return "", NotFound("asset_not_found", "素材不存在")
			}
			if err := json.Unmarshal([]byte(asset.PayloadJSON), &target); err != nil {
				return "", PreconditionFailed("media_reference_unreadable", "素材引用无法读取", nil)
			}
		}
	}
	ids := map[string]bool{}
	collectMediaResourceIDs(target, ids)
	if args.ResourceID != "" {
		if !ids[args.ResourceID] {
			return "", PermissionDenied("media_not_referenced", "这个资源未关联到指定素材或节点")
		}
		return args.ResourceID, nil
	}
	if len(ids) != 1 {
		return "", InvalidArg("media_resource_required", "目标必须有一个媒体资源，或指定其关联的 resourceId")
	}
	for id := range ids {
		return id, nil
	}
	return "", NotFound("media_not_found", "媒体不存在")
}

func collectMediaResourceIDs(value any, ids map[string]bool) {
	switch v := value.(type) {
	case map[string]any:
		for key, item := range v {
			if key == "resourceId" {
				if id, ok := item.(string); ok && strings.TrimSpace(id) != "" {
					ids[id] = true
				}
			}
			if key == "storageKey" || key == "content" {
				if value, ok := item.(string); ok && strings.HasPrefix(value, "resource:") {
					id := strings.TrimPrefix(value, "resource:")
					if mediaResourceIDPattern.MatchString(id) {
						ids[id] = true
					}
				}
			}
			collectMediaResourceIDs(item, ids)
		}
	case []any:
		for _, item := range v {
			collectMediaResourceIDs(item, ids)
		}
	}
}

// ReferencedMediaResourceIDs extracts canonical references from an already owned
// document. Callers still validate each resource ownership and readiness.
func ReferencedMediaResourceIDs(raw json.RawMessage) ([]string, error) {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, err
	}
	ids := map[string]bool{}
	collectMediaResourceIDs(value, ids)
	result := make([]string, 0, len(ids))
	for id := range ids {
		result = append(result, id)
	}
	sort.Strings(result)
	return result, nil
}

var mediaResourceIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,80}$`)

const maxMediaSourceBytes int64 = 256 << 20
const maxMediaPartBytes int64 = 8 << 20

type contextReader struct {
	context.Context
	io.Reader
}

func (r contextReader) Read(p []byte) (int, error) {
	if err := r.Context.Err(); err != nil {
		return 0, err
	}
	return r.Reader.Read(p)
}

func runMedia(opCtx *Context, operation string, raw json.RawMessage) (any, error) {
	var args mediaArgs
	if err := decodeParams(raw, &args); err != nil {
		return nil, err
	}
	resourceID, err := resolveMediaResource(opCtx, args)
	if err != nil {
		return nil, err
	}
	resource, err := opCtx.Domain.OwnedReadyResource(opCtx.UserID, resourceID)
	if err != nil {
		return nil, mapDomainError(err)
	}
	if resource == nil || resource.Size > maxMediaSourceBytes {
		return nil, PreconditionFailed("media_too_large", "当前图片检查支持 256 MiB 以内的素材", nil)
	}
	if !strings.HasPrefix(resource.MimeType, "image/") {
		return nil, Unsupported("media_format_unsupported", "当前仅支持检查图片素材")
	}
	mimeType, ok := imageMediaMime(resource.MimeType)
	if !ok {
		return nil, Unsupported("media_format_unsupported", "当前检查支持 JPEG、PNG、GIF 和 WebP 图片")
	}
	if args.StartMs != 0 || args.EndMs != 0 {
		return nil, InvalidArg("invalid_media_interval", "图片不支持片段区间")
	}
	if args.Mode != "" && args.Mode != "frames" {
		return nil, InvalidArg("invalid_media_mode", "图片只支持 frames 静态画面检查")
	}
	opener, ok := opCtx.Domain.(MediaSourceOpener)
	if !ok {
		return nil, Unsupported("media_unavailable", "当前工作区不支持图片检查")
	}
	ctx, cancel := context.WithCancel(opCtx.Context)
	defer cancel()
	body, err := opener.OpenMediaResource(ctx, opCtx.UserID, resourceID)
	if err != nil {
		return nil, mapDomainError(err)
	}
	if body == nil {
		return nil, PreconditionFailed("media_unavailable", "图片暂时无法读取", nil)
	}
	defer body.Close()
	readDone := make(chan struct{})
	defer close(readDone)
	go func() {
		select {
		case <-ctx.Done():
			_ = body.Close()
		case <-readDone:
		}
	}()
	data, err := io.ReadAll(io.LimitReader(contextReader{ctx, body}, maxMediaPartBytes+1))
	if err != nil {
		return nil, PreconditionFailed("media_read_failed", "图片读取失败", nil)
	}
	if int64(len(data)) > maxMediaPartBytes {
		return nil, PreconditionFailed("media_part_too_large", "图片超过 8 MiB，无法直接检查", nil)
	}
	sum := sha256.Sum256(data)
	version := hex.EncodeToString(sum[:])
	if operation != "media.overview" && args.ExpectedVersion == "" {
		return nil, InvalidArg("media_version_required", "先读取 overview，再提供 expectedVersion")
	}
	if args.ExpectedVersion != "" && args.ExpectedVersion != version {
		return nil, Conflict("stale_media_version", "素材内容已变化，请重新读取 overview", map[string]any{"currentVersion": version})
	}
	if !imageMediaMagic(mimeType, data) {
		return nil, Unsupported("media_format_unsupported", "图片内容与声明格式不一致")
	}
	source := MediaSource{CanvasID: args.CanvasID, NodeID: args.NodeID, AssetID: args.AssetID, ResourceID: resourceID, Version: version, TimestampKind: "source"}
	return MediaResult{
		Source:  source,
		Content: []MediaPart{{Type: "image", MimeType: mimeType, Data: base64.StdEncoding.EncodeToString(data), SHA256: version, Source: source}},
		Note:    "图片检查返回原图内容；图片没有连续画面或音轨。",
	}, nil
}

func imageMediaMime(mimeType string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(strings.Split(mimeType, ";")[0])) {
	case "image/jpeg", "image/jpg":
		return "image/jpeg", true
	case "image/png":
		return "image/png", true
	case "image/gif":
		return "image/gif", true
	case "image/webp":
		return "image/webp", true
	}
	return "", false
}

func imageMediaMagic(mimeType string, data []byte) bool {
	switch mimeType {
	case "image/jpeg":
		return len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff
	case "image/png":
		return len(data) >= 8 && string(data[:8]) == "\x89PNG\r\n\x1a\n"
	case "image/gif":
		return len(data) >= 6 && (string(data[:6]) == "GIF87a" || string(data[:6]) == "GIF89a")
	case "image/webp":
		return len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP"
	}
	return false
}
