import { runBackendGenerationTask, type BackendGenerationResult } from "@/services/api/generation-task";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import { channelHasGenerationCredential, defaultConfig, encodeChannelModel, isBuiltinBeefAPIChannel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import type { ModelProtocol } from "@/lib/model-protocols";

export async function testChannelModelConnection(channel: ModelChannel, model: string, capability: ModelCapability, protocol: ModelProtocol, runTask = runBackendGenerationTask) {
    if (!channel.baseUrl.trim()) throw new Error("请先填写 Base URL");
    if (!channelHasGenerationCredential(channel)) {
        throw new Error(isBuiltinBeefAPIChannel(channel) ? "请先连接 BeefTV" : "请先填写 API Key");
    }
    const selectedModel = encodeChannelModel(channel.id, model);
    const modelProfile = channel.modelProfiles?.find((item) => item.model === model);
    const limits = modelProfile?.capabilityConfig || defaultModelCapabilityConfig(protocol, model);
    const testProtocol = channel.apiFormat === "gemini" && !modelProfile?.protocol ? undefined : protocol;
    const testChannel: ModelChannel = {
        ...channel,
        models: channel.models.includes(model) ? channel.models : [...channel.models, model],
        modelProfiles: [
            {
                model,
                displayName: modelProfile?.displayName,
                capability,
                protocol: testProtocol,
                capabilityConfig: modelProfile?.capabilityConfig,
            },
            ...(channel.modelProfiles || []).filter((item) => item.model !== model),
        ],
    };
    const config = {
        ...defaultConfig,
        channelMode: "remote" as const,
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        apiFormat: channel.apiFormat,
        channels: [testChannel],
        model: selectedModel,
        imageModel: selectedModel,
        textModel: selectedModel,
        models: [selectedModel],
        imageModels: capability === "image" ? [selectedModel] : [],
        textModels: capability === "text" ? [selectedModel] : [],
        count: "1",
        size: limits?.image?.size.default || "1024x1024",
        quality: limits?.image?.quality.default || "auto",
    };

    const prompt = capability === "text" ? "Reply with OK." : "A static gray circle on a white background.";
    const result = await runTask({ mode: capability, config, prompt, streamText: false, metadata: { source: "model-connection-test" } });
    return modelConnectionResultDetail(result, capability);
}

export function modelConnectionResultDetail(result: BackendGenerationResult, capability: ModelCapability) {
    const media = capability === "image" ? result.images?.[0] : undefined;
    if (capability === "text" ? !result.text?.trim() : !(media?.storageKey || media?.dataUrl || media?.url)) {
        throw new Error("任务已结束，但没有返回可用结果。请在任务中心查看详情。");
    }
    return capability === "text" ? "已收到文本响应" : "已完成图片生成，可在任务中心查看结果";
}
