import type { ModelChannel } from "@/stores/use-config-store";

export type ModelProtocol = string;
export type ProtocolCapability = "text" | "image";
export type ModelProtocolWorkflow = { id: string; label: string; providerId: string; capability: ProtocolCapability; parameters: Array<{ name: string; type: string; required?: boolean; description?: string; values?: string[]; mapping?: string }>; defaults?: Record<string, string | number | boolean> };
export type ModelProtocolDefinition = { value: ModelProtocol; label: string; vendor?: string; capability: ProtocolCapability; create: string; contentType: string; poll?: string; media: string; enabled?: boolean; baseUrl?: string; workflows?: ModelProtocolWorkflow[] };

export function isSupportedProtocolCapability(value: unknown): value is ProtocolCapability {
    return value === "text" || value === "image";
}

export function protocolGroups(protocols: ModelProtocolDefinition[]) {
    return (["text", "image"] as const).map((capability) => ({ label: { text: "文本", image: "图片" }[capability], options: protocols.filter((item) => item.capability === capability && item.enabled !== false).map((item) => ({ label: `${item.label} · ${item.create.replace(/^POST /, "")}`, value: item.value })) }));
}
export function modelProtocolDefinition(value: string | undefined, definitions: ModelProtocolDefinition[] = []) { return definitions.find((item) => item.value === value && isSupportedProtocolCapability(item.capability)); }
export function modelProtocolLabel(value: string | undefined, definitions: ModelProtocolDefinition[] = []) { return modelProtocolDefinition(value, definitions)?.label || (value ? value : "未安装协议"); }

const BUILTIN_PROTOCOL_CAPABILITIES: Record<ModelProtocol, ProtocolCapability> = {
    "chat-completion": "text",
    "openai-response": "text",
    responses: "text",
    "claude-api": "text",
    "gemini-generate-content": "text",
    "openai-image": "image",
    "gemini-image": "image",
    "grok-image": "image",
    "volcengine-ark-image": "image",
    "volcengine-ark-agent-plan-image": "image",
    "volcengine-jimeng-image": "image",
};
export function modelProtocolCapability(value: string | undefined, definitions: ModelProtocolDefinition[] = []) {
    const definition = modelProtocolDefinition(value, definitions);
    if (definition) return definition.capability;
    return value ? BUILTIN_PROTOCOL_CAPABILITIES[value] : undefined;
}
export function isVolcengineArkImageProtocol(protocol?: string) {
    return protocol === "volcengine-ark-image" || protocol === "volcengine-ark-agent-plan-image";
}
export function protocolForModelCatalog(_endpointTypes: string[] = []): ModelProtocol | undefined {
    return undefined;
}

const RELAY_CATALOG_TEXT_PROTOCOLS: Record<string, ModelProtocol> = {
    openai: "chat-completion",
    "chat.completions": "chat-completion",
    "chat-completions": "chat-completion",
    "openai-response": "openai-response",
    "openai-response-compact": "openai-response",
    responses: "openai-response",
    anthropic: "claude-api",
    messages: "claude-api",
};

export function protocolForRelayCatalog(endpointTypes: string[] = [], capability?: ProtocolCapability): ModelProtocol | undefined {
    if (capability && capability !== "text") return undefined;
    for (const value of endpointTypes) {
        const protocol = RELAY_CATALOG_TEXT_PROTOCOLS[value.trim().toLowerCase()];
        if (protocol) return protocol;
    }
    return undefined;
}
export function protocolForBeefAPICatalog(endpointTypes: string[] = []): ModelProtocol | undefined {
    const endpoints = endpointTypes.map((value) => value.trim().toLowerCase());
    const mappings: Array<[string, string[]]> = [
        ["openai-image", ["image-generation", "images", "images.generations"]],
        ["openai-response", ["openai-response", "openai-response-compact", "responses"]],
        ["claude-api", ["anthropic", "messages"]],
        ["gemini-generate-content", ["gemini"]],
        ["chat-completion", ["chat.completions", "chat-completions"]],
    ];
    return mappings.find(([, aliases]) => aliases.some((alias) => endpoints.includes(alias)))?.[0];
}
export function modelProtocolSummary(value: string | undefined, definitions: ModelProtocolDefinition[] = []) { const protocol = modelProtocolDefinition(value, definitions); return protocol ? [protocol.create, protocol.contentType, protocol.poll, protocol.media].filter(Boolean).join(" · ") : "当前协议未安装或尚未选择。"; }

// 旧目录中的退场协议不能在失去能力标签后被重新当作文本模型。
export function isUnsupportedModelProtocol(value: unknown) {
    if (typeof value !== "string") return false;
    const protocol = value.trim().toLowerCase();
    return /^(?:newapi(?:-channel-[12])?|gemini-veo|full-video)$/.test(protocol) || /(?:^|[-_.])(?:video|videos|audio)(?:$|[-_.])/.test(protocol);
}
export function isUnsupportedGenerationModel(model: string) {
    const name = model.toLowerCase().split("::").pop() || "";
    return /(?:^|[^a-z0-9])(?:video|audio|tts|speech|voice|music|sound|asr|stt|whisper|transcription|transcriptions|transcribe|seedance|sora|veo|kling|hailuo|pika|runway|cogvideo|hunyuanvideo|animatediff|ltxvideo|wan)(?:$|[^a-z0-9])/.test(name)
        || /^(?:grok-imagine-video|sd-native-full-|原生不卡人脸)/.test(name);
}
export function normalizeModelProtocol(value: unknown): ModelProtocol | undefined {
    const protocol = typeof value === "string" && value.trim() ? value.trim() : undefined;
    if (isUnsupportedModelProtocol(protocol)) return undefined;
    return protocol === "google-gemini-generate-content" ? "gemini-generate-content" : protocol;
}

const STANDARD_PROTOCOLS: Record<ProtocolCapability, ModelProtocol[]> = {
    text: ["chat-completion", "openai-response"],
    image: ["openai-image"],
};
const FALLBACK_PROTOCOLS: Record<ProtocolCapability, ModelProtocol> = {
    text: "chat-completion",
    image: "openai-image",
};

export function inferProtocolCapabilityFromModel(model: string): ProtocolCapability {
    const lower = model.toLowerCase();
    if (["seedream", "gpt-image", "image", "dall-e", "dalle", "flux", "imagen", "banana", "midjourney", "sdxl", "stable-diffusion", "ideogram", "recraft"].some((token) => lower.includes(token))) return "image";
    return "text";
}

export function defaultProtocolForCapability(capability: ProtocolCapability, availableProtocols: ModelProtocolDefinition[] = []): ModelProtocol {
    for (const id of STANDARD_PROTOCOLS[capability]) {
        if (!availableProtocols.length || availableProtocols.some((item) => item.value === id && item.enabled !== false)) return id;
    }
    const matched = availableProtocols.find((item) => item.capability === capability && item.enabled !== false);
    return matched?.value || FALLBACK_PROTOCOLS[capability];
}
export function defaultProtocolForModel(model: string, availableProtocols: ModelProtocolDefinition[] = []): ModelProtocol {
    return defaultProtocolForCapability(inferProtocolCapabilityFromModel(model), availableProtocols);
}
export function usesOpenAICompatibleProtocolDefault(apiFormat?: string) {
    return apiFormat !== "gemini" && apiFormat !== "claude";
}

type ChannelModelProfile = NonNullable<ModelChannel["modelProfiles"]>[number];
export function ensureModelProfilesWithUiDefaults(
    models: string[],
    profiles: Array<Omit<ChannelModelProfile, "capability"> & { capability?: ProtocolCapability }> | undefined,
    availableProtocols: ModelProtocolDefinition[] = [],
    apiFormat?: string,
): ChannelModelProfile[] {
    const byModel = new Map((profiles || []).filter((item) => models.includes(item.model)).map((item) => [item.model, item]));
    return models.filter((model) => !isUnsupportedGenerationModel(model)).flatMap((model) => {
        const current = byModel.get(model);
        if (current?.capability && !isSupportedProtocolCapability(current.capability) || isUnsupportedModelProtocol(current?.protocol)) return [];
        const capability = current?.capability || modelProtocolCapability(current?.protocol, availableProtocols) || inferProtocolCapabilityFromModel(model);
        const protocol = current?.protocol || (usesOpenAICompatibleProtocolDefault(apiFormat) ? defaultProtocolForCapability(capability, availableProtocols) : undefined);
        return [{ ...current, model, capability, protocol }];
    });
}
