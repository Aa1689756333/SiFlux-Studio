import { defaultModelCapabilityConfig, type ModelCapabilityConfig } from "@/lib/model-capabilities";
import { modelProtocolCapability, protocolForModelCatalog, protocolForBeefAPICatalog, protocolForRelayCatalog, type ModelProtocol } from "@/lib/model-protocols";
import { isBuiltinRelayChannel, type ModelChannel } from "@/stores/use-config-store";
import { beefAPIImageContract, isBeefAPIEndpoint } from "@/lib/beefapi-image-contracts";

export type ChannelModelCatalogItem = {
    id: string;
    displayName?: string;
    modelType?: "text" | "image";
    supportedEndpointTypes?: string[];
    supportsImages?: boolean;
    maxImages?: number;
};

type ChannelModelProfile = NonNullable<ModelChannel["modelProfiles"]>[number];

// A standard OpenAI-compatible relay (new-api) names its extension fields in
// snake_case (supported_endpoint_types, display_name, model_type, ...) while this
// host's own relay shipped camelCase. Reading only camelCase silently turned every
// extension field into undefined, which emptied the protocol picker and blocked
// saving the channel. Fill a camelCase alias for any snake_case key; an explicitly
// present camelCase value always wins.
function withCamelCaseAliases(record: Record<string, unknown>): Record<string, unknown> {
    const normalized: Record<string, unknown> = { ...record };
    for (const [key, value] of Object.entries(record)) {
        if (!key.includes("_")) continue;
        const camelKey = key.replace(/_([a-z0-9])/g, (_match, letter) => letter.toUpperCase());
        if (normalized[camelKey] === undefined) normalized[camelKey] = value;
    }
    return normalized;
}

export function sanitizeChannelModelCatalogItem(value: unknown): ChannelModelCatalogItem | null {
    if (!value || typeof value !== "object") return null;
    const record = withCamelCaseAliases(value as Record<string, unknown>);
    const id = stringValue(record.id);
    if (!id) return null;
    // 目录可能同时列出文本、图片和已退场的音视频模型；产品只保留前两种。
    const modelType = stringValue(record.modelType).toLowerCase();
    if (modelType === "video" || modelType === "audio") return null;
    return compactCatalogItem({
        id,
        displayName: stringValue(record.displayName),
        modelType: modelType === "text" || modelType === "image" ? modelType : undefined,
        supportedEndpointTypes: stringArray(record.supportedEndpointTypes),
        supportsImages: typeof record.supportsImages === "boolean" ? record.supportsImages : undefined,
        maxImages: nonNegativeInteger(record.maxImages),
    });
}

export function catalogModelMapping(
    item: Pick<ChannelModelCatalogItem, "id" | "modelType" | "supportedEndpointTypes">,
    options: { providerNameFallback?: boolean } = {},
): {
    capability?: ChannelModelProfile["capability"];
    protocol?: ModelProtocol;
    skipGeneration?: boolean;
} {
    const id = item.id.trim().toLowerCase();
    const endpoints = (item.supportedEndpointTypes || []).map((value) => value.trim().toLowerCase()).filter(Boolean);
    const imageContract = options.providerNameFallback ? beefAPIImageContract(id) : undefined;
    if (imageContract) return { capability: "image", protocol: imageContract.protocol };
    // 转写与语音端点不属于生成能力，不能因为目录里出现就变成可选的文本模型。
    if (endpoints.some((endpoint) => ["audio.transcriptions", "audio-transcriptions", "transcriptions", "audio.speech", "audio-speech"].includes(endpoint))) {
        return { skipGeneration: true };
    }
    if (options.providerNameFallback && (catalogIsTranscriptionName(id) || catalogIsSpeechOrMusic(id))) return { skipGeneration: true };
    return {};
}

export function catalogEndpointCapability(item: ChannelModelCatalogItem): ChannelModelProfile["capability"] | undefined {
    const endpoints = (item.supportedEndpointTypes || []).map(value => value.trim().toLowerCase());
    if (endpoints.includes("image-generation") || endpoints.includes("images.generations")) return "image";
    return catalogModelMapping(item).capability;
}

function catalogNameTokens(id: string) {
    return id
        .trim()
        .toLowerCase()
        .split(/[^a-z0-9]+/u)
        .filter(Boolean);
}

function catalogHasNameToken(id: string, tokens: string[]) {
    const parts = new Set(catalogNameTokens(id));
    return tokens.some((token) => parts.has(token));
}

function catalogIsTranscriptionName(id: string) {
    return catalogHasNameToken(id, ["asr", "stt", "whisper", "transcription", "transcriptions", "transcribe"]);
}

function catalogIsSpeechOrMusic(id: string) {
    if (catalogIsTranscriptionName(id)) return false;
    return catalogHasNameToken(id, ["speech", "tts", "music"]);
}

function isBeefAPICatalogChannel(channel: ModelChannel) {
    if (channel.id === "beefapi" || channel.credentialRef === "beefapi-enterprise") return true;
    try {
        return isBeefAPIEndpoint(channel.baseUrl || "");
    } catch {
        return false;
    }
}

export function mergeFetchedChannelModelProfiles(channel: ModelChannel, catalog: ChannelModelCatalogItem[]): ChannelModelProfile[] {
    const existingByModel = new Map((channel.modelProfiles || []).map((profile) => [profile.model, profile]));
    const next: ChannelModelProfile[] = [];
    for (const item of catalog) {
        const existing = existingByModel.get(item.id);
        const mapped = catalogModelMapping(item, { providerNameFallback: isBeefAPICatalogChannel(channel) });
        // 通用第三方渠道不猜协议（由插件或用户配置给出）；只有自有中转站的目录可以按端点类型定协议。
        const inferredProtocol = mapped.protocol || (isBeefAPICatalogChannel(channel)
            ? protocolForBeefAPICatalog(item.supportedEndpointTypes)
            : isBuiltinRelayChannel(channel)
              ? protocolForRelayCatalog(item.supportedEndpointTypes, mapped.capability || item.modelType)
              : protocolForModelCatalog(item.supportedEndpointTypes));
        // BeefAPI may advertise generic OpenAI endpoints without modelType.
        const inferredCapability = mapped.capability || modelProtocolCapability(inferredProtocol) || item.modelType;
        if (mapped.skipGeneration) {
            continue;
        }
        if (existing) {
            const protocol = inferredProtocol || existing.protocol;
            const capability = inferredCapability || existing.capability;
            const capabilityChanged = capability !== existing.capability;
            const patchCapabilityConfig = hasCatalogCapabilityConfig(item) && capability === "image";
            const capabilityConfig = patchCapabilityConfig
                ? catalogCapabilityConfig(item, protocol || channel.interfaceType, capabilityChanged ? undefined : existing.capabilityConfig)
                : capabilityChanged
                  ? undefined
                  : existing.capabilityConfig;
            next.push({
                ...existing,
                ...(item.displayName ? { displayName: item.displayName } : {}),
                capability,
                ...(protocol ? { protocol } : {}),
                ...(patchCapabilityConfig || capabilityChanged ? { capabilityConfig } : {}),
            });
            continue;
        }

        const capability = inferredCapability || modelProtocolCapability(channel.interfaceType);
        const protocol = inferredProtocol || protocolTemplateForNewCatalogModel(capability, channel.interfaceType);
        if (!protocol || !capability) continue;
        const capabilityConfig = capability === "image" ? catalogCapabilityConfig(item, protocol, undefined) : undefined;
        next.push({
            model: item.id,
            ...(item.displayName ? { displayName: item.displayName } : {}),
            capability,
            protocol,
            ...(capabilityConfig ? { capabilityConfig } : {}),
        });
    }
    return next;
}

function protocolTemplateForNewCatalogModel(capability: ChannelModelProfile["capability"] | undefined, channelProtocol: ModelProtocol | undefined): ModelProtocol | undefined {
    if (!capability) return channelProtocol;
    if (modelProtocolCapability(channelProtocol) === capability) return channelProtocol;
    const templates: Record<ChannelModelProfile["capability"], ModelProtocol> = { text: "chat-completion", image: "openai-image" };
    return templates[capability];
}

function hasCatalogCapabilityConfig(item: ChannelModelCatalogItem) {
    return item.supportsImages !== undefined || item.maxImages !== undefined;
}

function catalogCapabilityConfig(item: ChannelModelCatalogItem, protocol: ModelProtocol | undefined, existing: ModelCapabilityConfig | undefined): ModelCapabilityConfig {
    const fallback = defaultModelCapabilityConfig(protocol, item.id);
    const config = structuredClone(existing?.image ? existing : fallback);
    if (item.supportsImages === false) config.image!.references.maxImages = 0;
    else if (item.maxImages !== undefined) config.image!.references.maxImages = item.maxImages;
    return config;
}

function compactCatalogItem(item: ChannelModelCatalogItem): ChannelModelCatalogItem {
    return {
        id: item.id,
        ...(item.displayName ? { displayName: item.displayName } : {}),
        ...(item.modelType ? { modelType: item.modelType } : {}),
        ...(item.supportedEndpointTypes?.length ? { supportedEndpointTypes: item.supportedEndpointTypes } : {}),
        ...(item.supportsImages !== undefined ? { supportsImages: item.supportsImages } : {}),
        ...(item.maxImages !== undefined ? { maxImages: item.maxImages } : {}),
    };
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown) {
    return Array.isArray(value) ? Array.from(new Set(value.map(stringValue).filter(Boolean))) : [];
}

function nonNegativeInteger(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}
