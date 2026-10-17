import { mergeFetchedChannelModelProfiles } from "@/lib/channel-model-catalog";
import { seedancePortraitModel } from "@/lib/seedance-portrait";
import type { ChannelModelFetchResult } from "@/services/api/image";
import { getTransportFailureKind } from "@/services/api/request";

type BeefAPIConnectionSummary = { state?: string };
import { channelHasGenerationCredential, channelHasManagedBeefAPICredential, filterModelsByCapability, isBuiltinBeefAPIChannel, modelOptionsFromChannels, type AiConfig, type ModelChannel } from "@/stores/use-config-store";

/**
 * 渠道配置的校验与派生集中在这里，供设置页与一键导入共用。
 *
 * 一键导入只是换了一种「怎么拿到密钥」的方式：写入渠道之后的校验、模型拉取
 * 与失败提示都必须和手工填写完全一致，所以规则只有这一份实现。
 */

/** 连接指纹：拉取模型期间用户改了连接配置，旧结果必须丢弃。 */
export function channelConnectionSignature(channel: ModelChannel) {
    return [channel.baseUrl.trim(), channel.referenceAssetOrigin?.trim() || "", channel.apiKey.trim(), channel.secretKey?.trim() || "", channel.apiFormat, JSON.stringify(channel.headers || [])].join("\n");
}

export function channelConnectionError(channel: ModelChannel, connection?: BeefAPIConnectionSummary | null) {
    const baseUrl = channel.baseUrl.trim();
    if (!baseUrl) return "请填写 Base URL";
    try {
        const parsed = new URL(baseUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "Base URL 只支持 HTTP 或 HTTPS";
    } catch {
        return "Base URL 格式不正确";
    }
    if (isBuiltinBeefAPIChannel(channel)) {
        if (connection?.state === "connected" || channelHasManagedBeefAPICredential(channel)) return "";
        return "请先连接 BeefTV";
    }
    if (!channelHasGenerationCredential(channel)) return "请填写 API Key / Access Key";
    if (requiresSecretKey(channel) && !channel.secretKey?.trim()) return "当前协议需要填写 Secret Key";
    return "";
}

export function channelModelFetchErrorMessage(error: unknown) {
    if (getTransportFailureKind(error) === "timeout") return "读取模型目录超时，请检查地址和网络后重试；也可以手动添加模型 ID";
    const detail = error instanceof Error ? error.message : "读取模型失败";
    if (detail.includes("不允许访问本机") || detail.includes("不允许访问保留地址")) return `${detail}；可信私网服务需由部署管理员配置 CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS`;
    return `${detail}；也可以直接在模型列表中手动输入模型名`;
}

export function requiresSecretKey(channel: ModelChannel) {
    return channel.modelProfiles?.some((item) => item.protocol?.startsWith("volcengine-jimeng-")) === true;
}

export function applyFetchedChannelModelCatalog(channel: ModelChannel, result: ChannelModelFetchResult): ModelChannel {
    const profiles = mergeFetchedChannelModelProfiles(channel, result.catalog);
    if (channel.id === "beefapi") return { ...channel, models: uniqueModels(result.models), modelProfiles: profiles };
    const existing = new Map((channel.modelProfiles || []).map((profile) => [profile.model, profile]));
    // Refresh updates the catalog without silently enabling new models or removing manual ones.
    return {
        ...channel,
        models: channel.models.length ? channel.models : uniqueModels(result.models),
        modelProfiles: profiles.map((profile) => {
            const previous = existing.get(profile.model);
            if (!previous) return profile;
            return seedancePortraitModel(profile.model) ? { ...previous, videoPricing: profile.videoPricing ?? null } : previous;
        }).concat((channel.modelProfiles || []).filter((profile) => !profiles.some((item) => item.model === profile.model))
            .map((profile) => seedancePortraitModel(profile.model) ? { ...profile, videoPricing: null } : profile)),
    };
}

export function withChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const models = modelOptionsFromChannels(channels);
    const imageModels = filterModelsByCapability(models, "image", channels);
    const videoModels = filterModelsByCapability(models, "video", channels);
    const textModels = filterModelsByCapability(models, "text", channels);
    const audioModels = filterModelsByCapability(models, "audio", channels);
    return {
        ...config,
        channels,
        models,
        model: normalizeDefaultModel(config.model, models),
        assistantModel: config.channels.some((channel) => !channels.some((item) => item.id === channel.id) && config.assistantModel?.startsWith(`${channel.id}::`)) ? "" : config.assistantModel,
        baseUrl: channels[0]?.baseUrl || config.baseUrl,
        apiKey: channels[0]?.apiKey || config.apiKey,
        apiFormat: channels[0]?.apiFormat || config.apiFormat,
        imageModels,
        videoModels,
        textModels,
        audioModels,
        imageModel: normalizeDefaultModel(config.imageModel, imageModels),
        videoModel: normalizeDefaultModel(config.videoModel, videoModels),
        textModel: normalizeDefaultModel(config.textModel, textModels),
        audioModel: normalizeDefaultModel(config.audioModel, audioModels),
    };
}

function normalizeDefaultModel(value: string, options: string[]) {
    return options.includes(value) ? value : options[0] || "";
}

function uniqueModels(models: string[]) {
    return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
}
