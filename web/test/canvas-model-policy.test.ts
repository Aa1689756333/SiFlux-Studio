import { describe, expect, test } from "bun:test";

import { canvasConnectionError } from "../src/lib/canvas/canvas-connection-policy";
import { assertCanvasImageReferenceLimit, buildGenerationConfig, canvasImageReferenceLimitError, resolveCanvasGenerationModel } from "../src/lib/canvas/canvas-project-generation";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { groupModelsByDisplayName, modelCompatibilityError, modelGroupReferenceLimits, modelPromptLengthError, resolveCompatibleModel, resolveModelGenerationDefaults } from "../src/lib/model-selection";
import { defaultConfig, normalizeModelOptionValue, type AiConfig, type ModelChannel } from "../src/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";

function policyConfig(): AiConfig {
    const variants = [
        { model: "cinema-text", maxImages: 0 },
        { model: "cinema-image", maxImages: 1 },
    ];
    const channel: ModelChannel = {
        id: "relay",
        name: "中转渠道",
        baseUrl: "https://api.example.com",
        apiKey: "test-key",
        apiFormat: "openai",
        models: variants.map((item) => item.model),
        modelProfiles: variants.map((item) => {
            const capabilityConfig = defaultModelCapabilityConfig(undefined, item.model);
            capabilityConfig.image!.references.maxImages = item.maxImages;
            return {
                model: item.model,
                displayName: "Cinema Pro",
                capability: "image" as const,
                billingMode: "fixed_request" as const,
                unitPriceMicrocredits: 1,
                capabilityConfig,
            };
        }),
    };
    const models = variants.map((item) => `relay::${item.model}`);
    return { ...defaultConfig, channels: [channel], models, imageModels: models, imageModel: models[1], model: models[1] };
}

function node(id: string, type: CanvasNodeType, generationMode?: "image" | "text"): CanvasNodeData {
    return {
        id,
        type,
        title: id,
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        metadata: generationMode ? { generationMode } : undefined,
    };
}

describe("逻辑模型选择", () => {
    test("技能上下文展开后按最终图片模型字符上限拒绝提交", () => {
        const config = policyConfig();
        const model = config.imageModels[0]!;
        config.channels[0]!.modelProfiles![0]!.capabilityConfig!.image!.references.promptMaxChars = 10_000;

        const error = modelPromptLengthError(config, model, "image", "图".repeat(23_142));

        expect(error).toContain("最多 10000 个字符");
        expect(error).toContain("完整提示词为 23142 个字符");
        expect(error).toContain("不会自动截断");
    });

    test("图片逻辑模型按尺寸匹配，不受无关全局配置影响", () => {
        const model = "platform::gpt-image-2";
        const channel: ModelChannel = {
            id: "platform",
            name: "平台模型",
            baseUrl: "/api",
            apiKey: "system",
            apiFormat: "openai",
            scope: "system",
            enabled: true,
            models: ["gpt-image-2"],
            modelProfiles: [{
                model: "gpt-image-2",
                displayName: "GPT Image 2",
                capability: "image",
                billingMode: "fixed_request",
                unitPriceMicrocredits: 1,
                logicalCapabilitySpec: {
                    version: 1,
                    capability: "image",
                    options: { size: { values: ["1:1", "3:2"] } },
                },
            }],
        };
        const config: AiConfig = {
            ...defaultConfig,
            channels: [channel],
            models: [model],
            imageModels: [model],
            imageModel: model,
            model,
        };

        expect(modelCompatibilityError(config, model, {
            capability: "image",
            input: { textCount: 1, imageCount: 0, characterCount: 0 },
            imageSize: "3:2",
            options: { size: "3:2" },
        })).toBe("");
    });

    test("后台图片默认比例优先于旧的全局 1:1 配置", () => {
        const model = "platform::managed-image";
        const profile = defaultModelCapabilityConfig(undefined, "managed-image");
        profile.image!.size = { parameter: "size", values: ["1:1", "16:9"], default: "16:9", allowCustom: false };
        const config: AiConfig = {
            ...defaultConfig,
            size: "1:1",
            channels: [{ id: "platform", name: "平台模型", baseUrl: "/api", apiKey: "system", apiFormat: "openai", scope: "system", models: ["managed-image"], modelProfiles: [{ model: "managed-image", capability: "image", billingMode: "fixed_request", unitPriceMicrocredits: 1, logicalModelId: "managed-image", logicalCapabilitySpec: { version: 1, capability: "image" }, capabilityConfig: profile }] }],
            models: [model],
            imageModels: [model],
            imageModel: model,
            model,
        };

        expect(resolveModelGenerationDefaults(config, model, "image", {}, { size: "1:1" }).size).toBe("16:9");
    });

    test("后台标注的图片模型不因内部标识缺少图片关键词而回退", () => {
        const config = policyConfig();
        const selectedModel = config.imageModels[1]!;
        const imageNode = { ...node("image", CanvasNodeType.Image), metadata: { model: selectedModel } };

        expect(resolveCanvasGenerationModel(config, selectedModel, "image")).toBe(selectedModel);
        expect(buildGenerationConfig(config, imageNode, "image").model).toBe(selectedModel);
    });

    test("同渠道同显示名称合并为一个逻辑模型", () => {
        const config = policyConfig();
        const groups = groupModelsByDisplayName(config, config.imageModels);
        expect(groups).toHaveLength(1);
        expect(groups[0]?.models).toHaveLength(2);
    });

    test("根据参考图自动切换到支持参考图的细分模型", () => {
        const config = policyConfig();
        const resolved = resolveCompatibleModel(config, "relay::cinema-text", {
            capability: "image",
            input: { textCount: 1, imageCount: 1, characterCount: 0 },
        });
        expect(resolved).toBe("relay::cinema-image");
    });

    test("纯文生图只匹配不接受参考图的细分模型时保持当前选择", () => {
        const config = policyConfig();
        const requirements = {
            capability: "image" as const,
            input: { textCount: 1, imageCount: 0, characterCount: 0 },
        };
        expect(modelCompatibilityError(config, "relay::cinema-text", requirements)).toBe("");
        expect(resolveCompatibleModel(config, "relay::cinema-text", requirements)).toBe("relay::cinema-text");
    });

    test("已保存的旧 SKU 选择会解析到新的模型家族", () => {
        const channel: ModelChannel = {
            id: "managed",
            name: "平台模型",
            baseUrl: "/api",
            apiKey: "system",
            apiFormat: "openai",
            scope: "system",
            models: ["family-seedance-2-5"],
            modelAliases: { "legacy-seedance-720": "family-seedance-2-5" },
        };

        expect(normalizeModelOptionValue("managed::legacy-seedance-720", [channel])).toBe("managed::family-seedance-2-5");
    });

    test("逻辑模型容量使用同名细分模型的最大值", () => {
        const config = policyConfig();
        expect(modelGroupReferenceLimits(config, "relay::cinema-text", "image")).toEqual({ maxImages: 1 });
    });
});

describe("画布连线能力", () => {
    test("超过图片模型的参考图上限时拒绝连线", () => {
        const config = policyConfig();
        const nodes = [node("image-a", CanvasNodeType.Image), node("image-b", CanvasNodeType.Image), node("target", CanvasNodeType.Config, "image")];
        const connections: CanvasConnection[] = [{ id: "existing", fromNodeId: "image-a", toNodeId: "target" }];
        expect(canvasConnectionError(config, nodes, connections, { fromNodeId: "image-b", toNodeId: "target" })).toContain("最多支持 1");
    });
});

describe("图片参考图上限", () => {
    test("超出当前模型上限时保留全部输入并返回明确错误", () => {
        const config = policyConfig();
        const modelProfile = config.channels[0]?.modelProfiles?.[1];
        if (!modelProfile?.capabilityConfig?.image) throw new Error("缺少图片能力配置");
        modelProfile.capabilityConfig.image.references.maxImages = 1;
        const references = [
            { id: "image-a", name: "image-a.png", type: "image/png", dataUrl: "data:image/png;base64,YQ==" },
            { id: "image-b", name: "image-b.png", type: "image/png", dataUrl: "data:image/png;base64,Yg==" },
        ];

        expect(canvasImageReferenceLimitError(config, references)).toContain("最多支持 1 张参考图，当前已连接 2 张");
        expect(() => assertCanvasImageReferenceLimit(config, references)).toThrow("请移除多余连线后重试");
        expect(references).toHaveLength(2);
    });
});
