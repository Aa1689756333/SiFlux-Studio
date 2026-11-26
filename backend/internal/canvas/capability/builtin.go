package capability

const (
	maxAgentNodeTitleRunes   = 240
	maxAgentNodeContentRunes = 16000
)

func BuiltinRegistry() *Registry {
	registry, err := NewRegistry([]Descriptor{
		{
			Type: "text", Version: "1", Label: "提示词", DefaultWidth: 340, DefaultHeight: 240,
			Purpose:   "承载手写图像提示词、创意说明和备注；不执行文本生成。",
			GoodFor:   []string{"图像提示词", "创意说明", "临时备注"},
			Tradeoffs: []string{"文本仅作为生图输入，模型推理由 Agent 负责"},
			InputKind: "text", Connection: ConnectionPolicy{CanSource: true}, CanUpdate: true,
			SummaryFields: []string{"content"}, DetailFields: []string{"content"},
			PatchFields: editableNodeFields("metadata.content", "提示词", "手写提示词正文"),
			CreateMetadata: func(content string) map[string]any {
				return map[string]any{"content": content, "fontSize": float64(14)}
			},
		},
		{
			Type: "image", Version: "4", Label: "图片", DefaultWidth: 720, DefaultHeight: 405,
			Purpose:   "生成、编辑或承载图片，并作为其他图片任务的参考素材。",
			GoodFor:   []string{"图片生成", "图片编辑", "参考图生图"},
			Tradeoffs: []string{"参考图数量与生成参数须符合模型能力"},
			Actions:   []string{"generate_image", "update_prompt", "use_as_reference"},
			InputKind: "image", GenerationMode: "image", CanUpdate: true,
			Connection:    ConnectionPolicy{CanSource: true, CanTarget: true, CanReference: true, AcceptedInputKinds: []string{"text", "image", "config"}},
			SummaryFields: []string{"prompt", "composerContent", "assetTags", "referenceNodeIds"},
			DetailFields:  []string{"prompt", "composerContent", "assetTags", "referenceNodeIds"},
			PatchFields:   generatedDraftFields(), CreateMetadata: generatedMetadata,
		},
		{
			Type: "config", Version: "1", Label: "生图配置", DefaultWidth: 340, DefaultHeight: 240,
			Purpose:   "为图片生成提供共享参数；模式固定为 image。",
			InputKind: "config", CanUpdate: true,
			Connection:    ConnectionPolicy{CanSource: true},
			SummaryFields: []string{"model", "size", "quality", "count"}, DetailFields: []string{"model", "size", "quality", "count"},
			PatchFields: generatedDraftFields(),
			CreateMetadata: func(prompt string) map[string]any {
				metadata := generatedMetadata(prompt)
				metadata["generationMode"] = "image"
				return metadata
			},
		},
		{
			Type: "frame", Version: "1", Label: "分组", DefaultWidth: 760, DefaultHeight: 520,
			Purpose:       "组织画布上的图片、提示词和配置。",
			SummaryFields: []string{"label"}, DetailFields: []string{"label"},
			CreateMetadata: func(string) map[string]any {
				return map[string]any{"frame": map[string]any{"collapsed": false, "expandedWidth": float64(760), "expandedHeight": float64(520)}}
			},
		},
	})
	if err != nil {
		panic(err)
	}
	return registry
}

func generatedDraftFields() map[string]PatchField {
	fields := editableNodeFields("metadata.composerContent", "下一版提示词", "下次生图使用的提示词草稿；不覆盖现有图片")
	fields["count"] = PatchField{Path: "metadata.count", Kind: patchKindNumber, Label: "生成数量", Order: 30}
	for index, name := range []string{"model", "size", "quality", "transparentBackground"} {
		fields[name] = PatchField{Path: "metadata." + name, Kind: patchKindString, Label: name, Order: 40 + index,
			Description: "生图草稿参数；提交时仍会校验模型能力", MaxRunes: 256}
	}
	return fields
}

func editableNodeFields(contentPath, contentLabel, contentDescription string) map[string]PatchField {
	return map[string]PatchField{
		"title":   {Path: "title", Kind: patchKindString, Label: "节点名称", Order: 10, Description: "节点标题", MaxRunes: maxAgentNodeTitleRunes},
		"content": {Path: contentPath, Kind: patchKindString, Label: contentLabel, Order: 20, Description: contentDescription, MaxRunes: maxAgentNodeContentRunes},
	}
}

func generatedMetadata(prompt string) map[string]any {
	return map[string]any{"content": "", "prompt": prompt, "composerContent": prompt, "status": "idle"}
}
