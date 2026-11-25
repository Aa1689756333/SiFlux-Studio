package canvas

import (
	"encoding/json"
	"reflect"
	"strings"

	"infinite-canvas/backend/internal/kernel"
)

// Retired nodes and domain sections are archival bytes, not executable capabilities.
// An image-only edit may preserve them unchanged; neither import nor full-document
// commits may create or modify them through a less constrained write path.
func validateWritableCanvasDocument(previous, current json.RawMessage) error {
	var before, after map[string]any
	if len(previous) > 0 && json.Unmarshal(previous, &before) != nil {
		return kernel.BadAuthRequest("历史画布数据无法读取")
	}
	if json.Unmarshal(current, &after) != nil {
		return kernel.BadAuthRequest("画布数据格式错误")
	}
	for _, key := range []string{"timeline", "director", "director3d", "drawings", "storyboard", "script"} {
		if !reflect.DeepEqual(before[key], after[key]) && after[key] != nil {
			return kernel.BadAuthRequest("画布不再支持写入：" + key)
		}
	}
	oldNodes := map[string]map[string]any{}
	for _, raw := range canvasDocNodes(before) {
		if node, ok := raw.(map[string]any); ok {
			id, _ := node["id"].(string)
			oldNodes[id] = node
		}
	}
	for _, raw := range canvasDocNodes(after) {
		node, ok := raw.(map[string]any)
		if !ok {
			return kernel.BadAuthRequest("画布节点格式错误")
		}
		nodeType, _ := node["type"].(string)
		id, _ := node["id"].(string)
		if _, supported := canvasCapabilityRegistry.Resolve(nodeType); !supported {
			if oldNodes[id] == nil || !reflect.DeepEqual(oldNodes[id], node) {
				return kernel.BadAuthRequest("历史节点仅可读取：" + nodeType)
			}
			continue
		}
		if metadata, ok := node["metadata"].(map[string]any); ok {
			if rawMode, exists := metadata["generationMode"]; exists && rawMode != nil {
				mode, isString := rawMode.(string)
				if !isString || (strings.TrimSpace(mode) != "" && mode != "image") {
					if !reflect.DeepEqual(oldNodes[id], node) {
						return kernel.BadAuthRequest("画布生成模式只能为 image")
					}
				}
			}
		}
	}
	return nil
}
