import { type ModelProtocol, type ModelProtocolWorkflow } from "@/lib/model-protocols";
import { beefAPIImageContract } from "@/lib/beefapi-image-contracts";
import type { ImageResolutionOption, ImageResolutionTier } from "@/lib/image-resolution-tiers";

export type ModelCapabilityConfig = {
    version: number;
    text?: TextCapabilityConfig;
    image?: ImageCapabilityConfig;
};

export type TextCapabilityConfig = {
    /** Whether the upstream text endpoint accepts SSE streaming responses. */
    streaming?: boolean;
    /** Whether the model exposes a user-selectable reasoning/thinking mode. */
    thinking?: boolean;
    references: {
        promptMaxChars: number;
        maxImages: number;
        maxImageBytes: number;
    };
};

export type ImageSizeParameter = "none" | "size" | "aspect_ratio";

export type ImageCapabilityConfig = {
    references: {
        promptMaxChars: number;
        maxImages: number;
        maxImageBytes: number;
        maskSupported: boolean;
    };
    size: {
        parameter: ImageSizeParameter;
        values: string[];
        default: string;
        allowCustom: boolean;
        presets?: ImageResolutionOption[];
    };
    quality: {
        supported: boolean;
        values: string[];
        default: string;
    };
    transparentBackground: { supported: boolean; default: boolean };
    responseFormat: { supported: boolean };
    outputFormat: { supported: boolean };
    maxOutputs: number;
};

// 旧版本的“允许自定义”可能只保存了 `*`，前台需要用这组标准值恢复可选项。
export const STANDARD_IMAGE_SIZE_VALUES = ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "21:9", "9:16", "1024x1024", "1536x1024", "1024x1536"] as const;

export function normalizeCapabilityString(value: unknown) {
    // Persisted channel capability profiles may contain null/undefined or
    // numeric values from older versions. Never let a malformed profile crash
    // canvas rendering through an unguarded `.trim()` call.
    const normalized = String(value ?? "").trim();
    return normalized.startsWith("string:") ? normalized.slice("string:".length) : normalized;
}

function normalizeCapabilityStrings(values: unknown[]) {
    return Array.from(new Set(values.map(normalizeCapabilityString)));
}

export function normalizeModelCapabilityConfig(config: ModelCapabilityConfig): ModelCapabilityConfig {
    return {
        version: config.version,
        text: config.text ? {
            streaming: config.text.streaming !== false,
            thinking: config.text.thinking,
            references: { promptMaxChars: config.text.references.promptMaxChars, maxImages: config.text.references.maxImages, maxImageBytes: config.text.references.maxImageBytes },
        } : undefined,
        image: config.image
            ? {
                  ...config.image,
                  size: {
                      ...config.image.size,
                      values: normalizeCapabilityStrings(config.image.size.values),
                      default: normalizeCapabilityString(config.image.size.default),
                  },
                  quality: {
                      ...config.image.quality,
                      values: normalizeCapabilityStrings(config.image.quality.values),
                      default: normalizeCapabilityString(config.image.quality.default),
                  },
              }
            : undefined,
    };
}

// Keep explicit pixel presets for each resolution tier so the settings panel can
// switch between 1K, 2K and 4K without silently converting the requested ratio.
const defaultImageSizes = [
    "auto",
    "1:1",
    "3:2",
    "2:3",
    "4:3",
    "3:4",
    "16:9",
    "21:9",
    "9:16",
    "1024x1024",
    "1360x1024",
    "1024x1360",
    "1536x1024",
    "1024x1536",
    "1024x1280",
    "1280x1024",
    "2048x878",
    "1824x1024",
    "1024x1824",
    "2048x2048",
    "2304x1728",
    "1728x2304",
    "2496x1664",
    "1664x2496",
    "1792x2240",
    "2240x1792",
    "3136x1344",
    "2752x1536",
    "1536x2752",
    "2880x2880",
    "3264x2448",
    "2448x3264",
    "3504x2336",
    "2336x3504",
    "2560x3200",
    "3200x2560",
    "3808x1632",
    "3840x2160",
    "2160x3840",
];

export function defaultImageCapabilityConfig(protocol?: ModelProtocol, model = ""): ImageCapabilityConfig {
    const image: ImageCapabilityConfig = {
        references: { promptMaxChars: 32000, maxImages: 16, maxImageBytes: 30 * 1024 * 1024, maskSupported: true },
        size: { parameter: "size", values: [...defaultImageSizes], default: "1:1", allowCustom: true },
        quality: { supported: true, values: ["auto", "low", "medium", "high"], default: "auto" },
        transparentBackground: { supported: true, default: false },
        responseFormat: { supported: true },
        outputFormat: { supported: true },
        maxOutputs: 15,
    };
    const contract = protocol === "openai-image" ? beefAPIImageContract(model) : undefined;
    if (contract) {
        return {
            references: { promptMaxChars: contract.promptMaxChars, maxImages: contract.maxImages, maxImageBytes: contract.maxImageBytes, maskSupported: false },
            size: { parameter: "size", values: Object.keys(contract.sizes), default: "1:1", allowCustom: true },
            quality: { supported: false, values: [], default: "auto" },
            transparentBackground: { supported: false, default: false },
            responseFormat: { supported: false }, outputFormat: { supported: false }, maxOutputs: 1,
        };
    }
    if (protocol === "grok-image") {
        image.references.maxImages = 1;
        image.references.maskSupported = false;
        // grok2api / xAI Imagine：size→aspect_ratio，quality→resolution(1k/2k)。
        image.size = {
            parameter: "aspect_ratio",
            values: ["1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2"],
            default: "1:1",
            allowCustom: false,
        };
        image.quality = { supported: true, values: ["1k", "2k"], default: "2k" };
        image.transparentBackground = { supported: false, default: false };
        image.responseFormat = { supported: true };
        image.outputFormat = { supported: false };
        image.maxOutputs = 1;
    } else if (protocol === "volcengine-ark-image" || protocol === "volcengine-ark-agent-plan-image") {
        image.references.maskSupported = false;
        image.quality.supported = false;
        image.transparentBackground.supported = false;
        image.responseFormat.supported = false;
        image.outputFormat.supported = false;
    }
    if (protocol === "volcengine-jimeng-image") {
        image.references.maxImages = 14;
        image.references.maskSupported = false;
        image.quality.supported = false;
        image.transparentBackground.supported = false;
        image.responseFormat.supported = false;
        image.outputFormat.supported = false;
    }
    if (protocol === "gemini-image") {
        image.references.maskSupported = false;
        // Gemini Images uses imageConfig.aspectRatio, not the OpenAI-style pixel size field.
        image.size = {
            parameter: "aspect_ratio",
            values: ["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"],
            default: "1:1",
            allowCustom: false,
        };
        image.transparentBackground = { supported: false, default: false };
        image.responseFormat = { supported: false };
        image.outputFormat = { supported: false };
        image.maxOutputs = 4;
    }
    if (protocol === "agnes-image") {
        // Agnes 图像：size 必填，取 1K/2K/3K/4K 档位或 WxH 精确尺寸，画面比例走独立的 ratio 字段；
        // 参考图放 extra_body.image，支持多图合成，但没有蒙版端点。
        image.references.maxImages = 9;
        image.references.maskSupported = false;
        image.size = {
            parameter: "aspect_ratio",
            values: ["1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"],
            default: "1:1",
            allowCustom: false,
        };
        // 官方档位是 1K/2K/3K/4K，统一层只提供 1k/2k/4k 三档；3K 保留在协议映射里但不在界面露出。
        image.quality = { supported: true, values: ["1k", "2k", "4k"], default: "2k" };
        image.transparentBackground = { supported: false, default: false };
        // 顶层 response_format 是官方明确的错误写法，输出格式只能在 extra_body 内声明。
        image.responseFormat = { supported: false };
        image.outputFormat = { supported: false };
        // 该端点不接受 n，单次请求固定返回一张图片。
        image.maxOutputs = 1;
    }
    if (
        protocol !== "grok-image" &&
        String(model ?? "")
            .trim()
            .toLowerCase()
            .startsWith("grok-imagine-image")
    ) {
        image.references.maxImages = 0;
        image.references.maskSupported = false;
        image.size = {
            parameter: "aspect_ratio",
            values: ["1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2"],
            default: "1:1",
            allowCustom: false,
        };
        image.quality = { supported: true, values: ["1k", "2k"], default: "2k" };
        image.transparentBackground = { supported: false, default: false };
        image.responseFormat = { supported: true };
        image.outputFormat = { supported: false };
        image.maxOutputs = 1;
    }
    return image;
}

export function defaultModelCapabilityConfig(protocol?: ModelProtocol, model = ""): ModelCapabilityConfig {
    return {
        version: 1,
        text: { streaming: true, references: { promptMaxChars: 32000, maxImages: 0, maxImageBytes: 0 } },
        image: defaultImageCapabilityConfig(protocol, model),
    };
}

export function pluginWorkflowCapabilityConfig(protocol: ModelProtocol, workflow: ModelProtocolWorkflow): ModelCapabilityConfig | undefined {
    if (workflow.capability !== "image") return undefined;
    const fallback = defaultModelCapabilityConfig(protocol, workflow.id);
    const fields: WorkflowFieldLike[] = workflow.parameters.map((parameter) => ({
        fieldName: parameter.name, source: parameter.mapping, fieldType: parameter.type,
        options: parameter.values, defaultValue: workflow.defaults?.[parameter.name],
    }));
    return { ...fallback, image: workflowImageCapabilityConfig(fields, fallback.image!) };
}

export function modelCapabilityConfigFor(
    config: { channels: Array<{ id: string; models: string[]; baseUrl?: string; interfaceType?: ModelProtocol; modelProfiles?: Array<{ model: string; capabilityConfig?: ModelCapabilityConfig; protocol?: ModelProtocol }> }> },
    model: string,
) {
    const separator = model.indexOf("::");
    const channelId = separator >= 0 ? model.slice(0, separator) : "";
    const modelName = separator >= 0 ? model.slice(separator + 2) : model;
    const channel = config.channels.find((item) => item.id === channelId) || config.channels.find((item) => item.models.includes(modelName));
    const profile = channel?.modelProfiles?.find((item) => item.model === modelName && item.capabilityConfig && !Array.isArray(item.capabilityConfig)) || channel?.modelProfiles?.find((item) => item.model === modelName);
    const protocol = profile?.protocol || channel?.interfaceType;
    const fallback = defaultModelCapabilityConfig(protocol, modelName);
    if (!profile?.capabilityConfig) return fallback;
    const capabilityConfig = normalizeModelCapabilityConfig(profile.capabilityConfig);
    const text = capabilityConfig.text ? { ...fallback.text!, ...capabilityConfig.text, references: { ...fallback.text!.references, ...capabilityConfig.text.references } } : fallback.text;
    const configuredImage = capabilityConfig.image;
    const image = configuredImage
        ? (() => {
              const configuredSize = configuredImage.size;
              const configuredValues = configuredSize?.values?.map(normalizeCapabilityString);
              const allowCustom = Boolean(configuredSize?.allowCustom || configuredValues?.includes("*"));
              const concreteValues = configuredValues?.filter((value) => value !== "*") || [];
              const values = !configuredValues ? fallback.image!.size.values : concreteValues.length || !allowCustom ? concreteValues : [...STANDARD_IMAGE_SIZE_VALUES];
              const configuredDefault = configuredSize?.default ? normalizeCapabilityString(configuredSize.default) : undefined;
              const defaultValue = configuredDefault && configuredDefault !== "*" && values.includes(configuredDefault) ? configuredDefault : values.find((value) => value !== "*") || fallback.image!.size.default;
              return {
                  ...fallback.image!,
                  ...configuredImage,
                  size: {
                      ...fallback.image!.size,
                      ...configuredSize,
                      values,
                      default: defaultValue,
                      allowCustom,
                  },
              };
          })()
        : fallback.image;
    return { version: capabilityConfig.version || fallback.version, text, image };
}

export type WorkflowFieldLike = {
    nodeId?: string;
    classType?: string;
    fieldName?: string;
    label?: string;
    role?: string;
    safeToOverride?: boolean;
    optionsSource?: string;
    enabled?: boolean;
    source?: string;
    sourceFromUpstream?: boolean;
    randomEnabled?: boolean;
    fieldType?: string;
    options?: unknown[];
    fieldValue?: unknown;
    value?: unknown;
    default?: unknown;
    defaultValue?: unknown;
    min?: unknown;
    max?: unknown;
    step?: unknown;
};

export type WorkflowFieldNumberBounds = { min?: number; max?: number; step?: number };

export function workflowFieldKey(field: WorkflowFieldLike) {
    return `field:${String(field.nodeId || "").trim()}:${String(field.fieldName || "").trim()}`;
}

export function workflowFieldRandomKey(field: WorkflowFieldLike) {
    return `random:${String(field.nodeId || "").trim()}:${String(field.fieldName || "").trim()}`;
}

export function workflowFieldSource(field: WorkflowFieldLike) {
    return String(field.source || "")
        .trim()
        .replace(/[\s_-]/g, "")
        .toLowerCase();
}

export function workflowParameterFields(fields: readonly WorkflowFieldLike[]) {
    return fields.filter((field) => {
        const source = workflowFieldSource(field);
        const fieldType = String(field.fieldType || "")
            .trim()
            .toUpperCase();
        if (!field.fieldName || !field.nodeId || field.enabled === false || !workflowFieldSafeToOverride(field)) return false;
        if (["prompt", "text", "positiveprompt", "positive", "referenceimage", "image", "referencevideo", "video", "referenceaudio", "audio", "mask"].includes(source)) return false;
        if (["IMAGE", "VIDEO", "AUDIO"].includes(fieldType)) return false;
        return true;
    });
}

export function workflowFieldSafeToOverride(field: WorkflowFieldLike) {
    if (field.safeToOverride === false) return false;
    const classType = String(field.classType || "")
        .trim()
        .toLowerCase();
    const fieldName = String(field.fieldName || "")
        .trim()
        .toLowerCase();
    if (classType === "int" && fieldName === "value") return false;
    return classType !== "imageresize+" || !["width", "height", "multiple_of"].includes(fieldName);
}

export function workflowFieldRole(field: WorkflowFieldLike) {
    if (["prompt", "media", "business", "internal"].includes(String(field.role || ""))) return String(field.role);
    const source = workflowFieldSource(field);
    const fieldType = String(field.fieldType || "")
        .trim()
        .toUpperCase();
    if (["prompt", "text", "positiveprompt", "positive"].includes(source)) return "prompt";
    if (["referenceimage", "image", "referencevideo", "video", "referenceaudio", "audio", "mask"].includes(source) || ["IMAGE", "VIDEO", "AUDIO"].includes(fieldType)) return "media";
    if (!workflowFieldSafeToOverride(field)) return "internal";
    const key = normalizeWorkflowFieldKey(String(field.fieldName || ""));
    if (
        [
            "aspectratio",
            "ratio",
            "quality",
            "resolution",
            "seed",
            "noiseseed",
            "steps",
            "step",
            "sigmapoints",
            "cfg",
            "cfgscale",
            "guidance",
            "guidancescale",
            "sampler",
            "samplername",
            "scheduler",
            "count",
            "batch",
            "batchsize",
            "negativeprompt",
            "systemprompt",
        ].includes(key)
    )
        return "business";
    return field.classType ? "internal" : "business";
}

/** 读取工作流字段声明的连续数值范围；兼容 RunningHub 将范围包在 options/range 中的返回格式。 */
export function workflowFieldNumberBounds(field: WorkflowFieldLike | undefined): WorkflowFieldNumberBounds {
    if (!field) return {};
    const sources: Record<string, unknown>[] = [field as unknown as Record<string, unknown>];
    const options = Array.isArray(field.options) ? field.options : [];
    options.forEach((option) => {
        if (!option || typeof option !== "object" || Array.isArray(option)) return;
        const item = option as Record<string, unknown>;
        const nested = item.range;
        if (nested && typeof nested === "object" && !Array.isArray(nested)) sources.push(nested as Record<string, unknown>);
        if (["min", "max", "step", "minValue", "maxValue", "stepValue"].some((key) => item[key] !== undefined)) sources.push(item);
    });
    const read = (keys: string[]) => {
        for (const source of sources) {
            for (const key of keys) {
                const raw = source[key];
                if (raw === undefined || raw === null || String(raw).trim() === "") continue;
                const value = Number(raw);
                if (Number.isFinite(value)) return value;
            }
        }
        return undefined;
    };
    return { min: read(["min", "minValue", "min_value"]), max: read(["max", "maxValue", "max_value"]), step: read(["step", "stepValue", "step_value"]) };
}

/** 只有真正的枚举项才作为下拉选项；范围对象交给 InputNumber。 */
export function workflowFieldChoiceValues(field: WorkflowFieldLike | undefined) {
    const bounds = workflowFieldNumberBounds(field);
    if (bounds.min !== undefined && bounds.max !== undefined && bounds.step !== undefined) return [];
    const protocolOptions = workflowFieldChoiceValuesFromProtocol(field);
    if (protocolOptions.length) return protocolOptions;
    const options = Array.isArray(field?.options) ? field.options : [];
    return options.filter((option) => !workflowFieldOptionIsRange(option));
}

/** ComfyUI 的枚举按完整字符串校验；旧画布中的比例简写只能映射到唯一同前缀原值。 */
export function workflowFieldSubmissionValue(field: WorkflowFieldLike, value: unknown) {
    const choices = workflowFieldSubmissionChoices(field);
    const submitted = workflowFieldOptionValue(value);
    if (!choices.length || choices.some((choice) => workflowFieldOptionValue(choice) === submitted)) return value;
    const ratio = workflowRatioPrefix(submitted);
    if (!ratio) return value;
    const matches = choices.filter((choice) => workflowRatioPrefix(workflowFieldOptionValue(choice)) === ratio);
    return matches.length === 1 ? workflowFieldOptionValue(matches[0]) : value;
}

const resolutionSelectorAspectRatioOptions = ["1:1 (Square)", "2:3 (Portrait Photo)", "3:2 (Photo)", "3:4 (Portrait Standard)", "4:3 (Standard)", "9:16 (Portrait Widescreen)", "16:9 (Widescreen)", "21:9 (Ultrawide)"];

function workflowFieldSubmissionChoices(field: WorkflowFieldLike) {
    const classType = normalizeWorkflowFieldKey(String(field.classType || ""));
    const fieldName = normalizeWorkflowFieldKey(String(field.fieldName || ""));
    // RunningHub 的 API JSON 只有当前值，没有 ComfyUI object_info。该节点的真实枚举
    // 来自节点类型合同，不能使用通用比例模板冒充上游 options。
    if (classType === "resolutionselector" && fieldName === "aspectratio") return resolutionSelectorAspectRatioOptions;
    return workflowFieldChoiceValues(field);
}

function workflowRatioPrefix(value: string) {
    const match = value.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)(?:\s|\(|$)/);
    return match ? `${match[1]}:${match[2]}` : "";
}

const workflowKnownOptions: Record<string, string[]> = {
    aspectratio: ["1:1", "16:9", "9:16", "4:3", "3:4", "4:5", "5:4", "3:2", "2:3", "21:9", "9:21"],
    ratio: ["1:1", "16:9", "9:16", "4:3", "3:4", "4:5", "5:4", "3:2", "2:3", "21:9", "9:21"],
    resolution: ["512", "768", "1024", "1280", "1536", "2048", "1k", "2k", "4k"],
    size: ["512", "768", "1024", "1280", "1536", "2048"],
    sampler: ["euler", "euler_ancestral", "heun", "dpm_2", "dpm_2_ancestral", "lms", "dpmpp_2m", "dpmpp_sde", "ddim", "uni_pc"],
    samplername: ["euler", "euler_ancestral", "heun", "dpm_2", "dpm_2_ancestral", "lms", "dpmpp_2m", "dpmpp_sde", "ddim", "uni_pc"],
    scheduler: ["normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform", "beta"],
};

export function workflowFieldPresetOptions(field: WorkflowFieldLike | undefined) {
    if (!field) return [];
    const fieldType = String(field.fieldType || "")
        .trim()
        .toUpperCase();
    if (["NUMBER", "FLOAT", "INTEGER", "INT", "SLIDER", "BOOLEAN", "BOOL", "IMAGE", "VIDEO", "AUDIO"].includes(fieldType)) return [];
    const classType = normalizeWorkflowFieldKey(String(field.classType || ""));
    const key = normalizeWorkflowFieldKey(String(field.fieldName || ""));
    if (classType === "resolutionselector" && key === "aspectratio") return resolutionSelectorAspectRatioOptions;
    return workflowKnownOptions[key] || [];
}

export function workflowFieldConfigurationError(field: WorkflowFieldLike) {
    const bounds = workflowFieldNumberBounds(field);
    if (bounds.min !== undefined && bounds.max !== undefined && bounds.min > bounds.max) return "最小值不能大于最大值";
    if (bounds.step !== undefined && bounds.step <= 0) return "步长必须大于 0";
    return "";
}

export function workflowFieldValueError(field: WorkflowFieldLike, value: unknown) {
    const configurationError = workflowFieldConfigurationError(field);
    if (configurationError) return configurationError;
    const fieldType = String(field.fieldType || "")
        .trim()
        .toUpperCase();
    const bounds = workflowFieldNumberBounds(field);
    const numeric = ["NUMBER", "FLOAT", "INTEGER", "INT", "SLIDER"].includes(fieldType) || bounds.min !== undefined || bounds.max !== undefined || bounds.step !== undefined;
    if (numeric) {
        if (value === undefined || value === null || String(value).trim() === "" || !Number.isFinite(Number(value))) return "请输入有效数字";
        const parsed = Number(value);
        if ((bounds.min !== undefined && parsed < bounds.min) || (bounds.max !== undefined && parsed > bounds.max)) return "数值超出允许范围";
        if (bounds.step !== undefined) {
            const start = bounds.min ?? 0;
            const steps = (parsed - start) / bounds.step;
            if (Math.abs(steps - Math.round(steps)) > 1e-7) return "数值不符合步长";
        }
    }
    const options = workflowFieldChoiceValues(field).map(workflowFieldOptionValue);
    if (options.length && !options.includes(workflowFieldOptionValue(value))) return "当前值不在允许选项中";
    return "";
}

export function workflowImageCapabilityConfig(fields: readonly WorkflowFieldLike[], fallback = defaultModelCapabilityConfig().image!): ImageCapabilityConfig {
    const ratioField = fields.find((field) => workflowFieldMatches(field, "aspectratio"));
    const sizeField = fields.find((field) => workflowFieldMatches(field, "size"));
    const qualityField = fields.find((field) => workflowFieldMatches(field, "quality"));
    const ratioOptions = workflowFieldChoiceValues(ratioField).map(workflowFieldOptionValue).filter(Boolean);
    const ratioDefault = workflowFieldDefaultValue(ratioField);
    const sizeOptions = workflowFieldChoiceValues(sizeField).map(workflowFieldOptionValue).filter(Boolean);
    const sizeDefault = workflowFieldDefaultValue(sizeField);
    const qualityOptions = workflowFieldChoiceValues(qualityField).map(workflowFieldOptionValue).filter(Boolean);
    return {
        ...fallback,
        size: ratioField
            ? { parameter: "aspect_ratio", values: ratioOptions.length ? ratioOptions : ratioDefault ? [ratioDefault] : [], default: ratioDefault || ratioOptions[0] || "auto", allowCustom: false }
            : sizeField
              ? { parameter: "size", values: sizeOptions.length ? sizeOptions : sizeDefault ? [sizeDefault] : [], default: sizeDefault || sizeOptions[0] || "auto", allowCustom: false }
              : { ...fallback.size, values: [], default: "auto", allowCustom: false },
        quality: qualityField ? { supported: qualityOptions.length > 0, values: qualityOptions, default: workflowFieldDefaultValue(qualityField) || qualityOptions[0] || "auto" } : { supported: false, values: [], default: "auto" },
        transparentBackground: { supported: false, default: false },
        maxOutputs: 1,
    };
}

/** 读取工作流当前选择的比例/尺寸；字段没有语义名时仅识别纯尺寸枚举。 */
export function workflowOutputSizeValue(fields: readonly WorkflowFieldLike[], values: Readonly<Record<string, unknown>>) {
    const field =
        fields.find((item) => workflowFieldMatches(item, "aspectratio")) ||
        fields.find((item) => workflowFieldMatches(item, "size")) ||
        fields.find((item) => {
            const options = workflowFieldChoiceValues(item).map(workflowFieldOptionValue).filter(Boolean);
            return options.length > 1 && options.every(workflowOutputSizeLike);
        });
    const value = workflowFieldCurrentValue(field, values);
    const submitted = !field || value === undefined ? "" : workflowFieldOptionValue(workflowFieldSubmissionValue(field, value));
    return submitted || workflowDefaultSize(fields, values);
}

/** 从工作流同一节点的 width/height 字段读取默认输出尺寸。 */
export function workflowDefaultSize(fields: readonly WorkflowFieldLike[], values: Readonly<Record<string, unknown>> = {}) {
    const candidates = fields.filter((field) => workflowDimensionFieldMatches(field, "width") || workflowDimensionFieldMatches(field, "height"));
    const groups = Array.from(new Set(candidates.map((field) => String(field.nodeId || "").trim()).filter(Boolean)));
    const orderedGroups = groups.sort((left, right) => {
        const leftResize = candidates.some(
            (field) =>
                String(field.nodeId || "").trim() === left &&
                String(field.label || "")
                    .toLowerCase()
                    .includes("imageresize"),
        );
        const rightResize = candidates.some(
            (field) =>
                String(field.nodeId || "").trim() === right &&
                String(field.label || "")
                    .toLowerCase()
                    .includes("imageresize"),
        );
        return Number(leftResize) - Number(rightResize);
    });
    for (const nodeId of orderedGroups) {
        const nodeFields = candidates.filter((field) => String(field.nodeId || "").trim() === nodeId);
        const width = nodeFields.find((field) => workflowDimensionFieldMatches(field, "width"));
        const height = nodeFields.find((field) => workflowDimensionFieldMatches(field, "height"));
        const widthValue = workflowNumber(workflowFieldCurrentValue(width, values));
        const heightValue = workflowNumber(workflowFieldCurrentValue(height, values));
        if (widthValue !== undefined && widthValue > 0 && heightValue !== undefined && heightValue > 0) return `${Math.round(widthValue)}x${Math.round(heightValue)}`;
    }
    return "";
}

export function workflowFieldsFromJson(value: Record<string, unknown> | undefined) {
    if (!value || typeof value !== "object") return [] as WorkflowFieldLike[];
    const fields: WorkflowFieldLike[] = [];
    Object.entries(value).forEach(([nodeId, rawNode]) => {
        if (!rawNode || typeof rawNode !== "object" || Array.isArray(rawNode)) return;
        const node = rawNode as Record<string, unknown>;
        const classType = String(node.class_type || node.type || "").trim();
        const inputs = node.inputs;
        if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) return;
        Object.entries(inputs as Record<string, unknown>).forEach(([fieldName, fieldValue]) => {
            if (Array.isArray(fieldValue)) return;
            const fieldType = typeof fieldValue === "number" ? "NUMBER" : typeof fieldValue === "boolean" ? "BOOLEAN" : "TEXT";
            const candidate = { nodeId, classType, fieldName, fieldValue, fieldType };
            const safeToOverride = workflowFieldSafeToOverride(candidate);
            const role = workflowFieldRole(candidate);
            fields.push({ ...candidate, safeToOverride, role, enabled: safeToOverride && role !== "internal" });
        });
    });
    return fields;
}

function workflowFieldMatches(field: WorkflowFieldLike, source: string) {
    const keys = [field.source, field.fieldName, field.label].map((value) => normalizeWorkflowFieldKey(String(value || ""))).filter(Boolean);
    if (source === "size") {
        return keys.some((key) => ["size", "imagesize", "imageresolution", "resolution"].includes(key));
    }
    if (source === "quality") {
        return workflowFieldSource(field) === "quality" || keys.some((key) => ["quality", "imagequality"].includes(key) || key.includes("清晰度"));
    }
    return keys.some((key) => ["aspectratio", "ratio", "imageaspectratio", "imageratio"].includes(key));
}

function workflowDimensionFieldMatches(field: WorkflowFieldLike, dimension: "width" | "height") {
    const keys = [field.source, field.fieldName, field.label].map((value) => normalizeWorkflowFieldKey(String(value || ""))).filter(Boolean);
    return keys.some((key) => key === dimension || key.endsWith(dimension) || key.includes(`${dimension}pixels`));
}

function normalizeWorkflowFieldKey(value: string) {
    return String(value)
        .toLowerCase()
        .replace(/[\s_-]/g, "");
}

function workflowFieldOptionValues(options: unknown[] | undefined) {
    if (!Array.isArray(options)) return [] as string[];
    return options
        .filter((option) => !workflowFieldOptionIsRange(option))
        .map(workflowFieldOptionValue)
        .filter(Boolean);
}

function workflowFieldChoiceValuesFromProtocol(field: WorkflowFieldLike | undefined) {
    const explicit = workflowFieldOptionValues(field?.options);
    if (explicit.length) return explicit;
    const classType = normalizeWorkflowFieldKey(String(field?.classType || ""));
    const fieldName = normalizeWorkflowFieldKey(String(field?.fieldName || ""));
    // RunningHub 对该节点有固定枚举，但 getJsonApiFormat 可能只返回默认值；
    // 只有节点类型和字段名同时匹配时才补齐，避免把所有工作流比例强制成同一套选项。
    if (classType === "resolutionselector" && fieldName === "aspectratio") return resolutionSelectorAspectRatioOptions;
    return [] as string[];
}

function workflowFieldOptionIsRange(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const item = value as Record<string, unknown>;
    const nested = item.range;
    return [item, nested && typeof nested === "object" && !Array.isArray(nested) ? (nested as Record<string, unknown>) : undefined].some(
        (candidate) => candidate && ["min", "max", "step", "minValue", "maxValue", "stepValue"].some((key) => candidate[key] !== undefined),
    );
}

function workflowFieldOptionValue(value: unknown): string {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        const item = value as Record<string, unknown>;
        for (const key of ["value", "id", "key", "name", "label"]) {
            if (item[key] !== undefined && item[key] !== null && String(item[key]).trim()) return String(item[key]).trim();
        }
    }
    return value === undefined || value === null ? "" : String(value).trim();
}

function workflowOutputSizeLike(value: string) {
    return /^\d+(?:\.\d+)?(?:x|:)\d+(?:\.\d+)?(?:-|$)/i.test(value.trim());
}

function workflowFieldDefaultValue(field: WorkflowFieldLike | undefined) {
    if (!field) return "";
    return workflowFieldOptionValue(field.fieldValue ?? field.defaultValue ?? field.value ?? field.default);
}

/**
 * 读取画布当前的工作流字段值。新版本按 nodeId + fieldName 保存；旧画布曾按
 * source 语义键保存，比例字段必须兼容读取，否则会静默回退到工作流默认的 1:1。
 */
export function workflowFieldCurrentValue(field: WorkflowFieldLike | undefined, values: Readonly<Record<string, unknown>>) {
    if (!field) return undefined;
    for (const key of [workflowFieldKey(field), ...workflowFieldLegacyKeys(field)]) {
        if (Object.prototype.hasOwnProperty.call(values, key)) return values[key];
    }
    // 旧画布和新工作流 schema 可能分别使用 aspectRatio / aspect_ratio，
    // 字段语义相同但存储键不同。读取时按节点号和规范化字段名兼容，
    // 避免找不到用户已选值后回退到工作流或全局默认比例。
    const nodeKey = normalizeWorkflowParameterPart(field.nodeId);
    const fieldKeys = [field.fieldName, field.source, field.label].map((value) => normalizeWorkflowParameterPart(value)).filter(Boolean);
    if (nodeKey && fieldKeys.length) {
        for (const [key, value] of Object.entries(values)) {
            const match = key.match(/^field:([^:]+):(.+)$/i);
            if (!match) continue;
            if (normalizeWorkflowParameterPart(match[1]) === nodeKey && fieldKeys.includes(normalizeWorkflowParameterPart(match[2]))) return value;
        }
    }
    return field.fieldValue ?? field.defaultValue ?? field.value ?? field.default;
}

export function workflowFieldHasStoredValue(field: WorkflowFieldLike | undefined, values: Readonly<Record<string, unknown>>) {
    if (!field) return false;
    if ([workflowFieldKey(field), ...workflowFieldLegacyKeys(field)].some((key) => Object.prototype.hasOwnProperty.call(values, key))) return true;
    const nodeKey = normalizeWorkflowParameterPart(field.nodeId);
    const fieldKeys = [field.fieldName, field.source, field.label].map((value) => normalizeWorkflowParameterPart(value)).filter(Boolean);
    if (!nodeKey || !fieldKeys.length) return false;
    return Object.keys(values).some((key) => {
        const match = key.match(/^field:([^:]+):(.+)$/i);
        return Boolean(match && normalizeWorkflowParameterPart(match[1]) === nodeKey && fieldKeys.includes(normalizeWorkflowParameterPart(match[2])));
    });
}

function normalizeWorkflowParameterPart(value: unknown) {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\s_-]/g, "");
}

function workflowFieldLegacyKeys(field: WorkflowFieldLike) {
    const keys = [field.source, field.fieldName, field.label].map((value) => normalizeWorkflowFieldKey(String(value || ""))).filter(Boolean);
    if (keys.some((key) => ["aspectratio", "ratio", "imageaspectratio", "imageratio"].includes(key))) {
        return ["source:aspectRatio", "source:aspect_ratio", "source:ratio"];
    }
    if (keys.some((key) => ["size", "imagesize", "imageresolution"].includes(key))) return ["source:size"];
    if (keys.some((key) => ["quality", "imagequality"].includes(key))) return ["source:quality"];
    if (keys.some((key) => ["count", "batch", "batchsize"].includes(key))) return ["source:count", "source:batch"];
    return [] as string[];
}

function workflowNumber(value: unknown) {
    if (value === undefined || value === null || String(value).trim() === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeImageValue(profile: ImageCapabilityConfig, value: { size?: string; quality?: string; count?: string; transparentBackground?: string }) {
    const size = normalizeImageSizeSetting(profile, value.size);
    const requestedQuality = String(value.quality || "")
        .trim()
        .toLowerCase();
    // 比例协议的固定分辨率预设没有独立 quality 字段时，UI 仍需把当前比例对应的
    // 预设档位带入请求。仅在 quality 未声明支持时启用，避免与 auto/low/medium/high
    // 这组真实图片质量语义混用。
    const presetTier = !profile.quality.supported ? imagePresetTierForSelection(profile, size) : undefined;
    const quality = profile.quality.supported
        ? requestedQuality === "auto" || requestedQuality === "any"
            ? "auto"
            : value.quality && profile.quality.values.includes(value.quality)
              ? value.quality
              : profile.quality.default || "auto"
        : requestedQuality === "1k" || requestedQuality === "2k" || requestedQuality === "4k"
          ? requestedQuality
          : presetTier || profile.quality.default || "auto";
    const count = String(Math.max(1, Math.min(profile.maxOutputs, Math.floor(Math.abs(Number(value.count)) || 1))));
    const transparentBackground = profile.transparentBackground.supported && value.transparentBackground === "true" ? "true" : "false";
    return { size, quality, count, transparentBackground };
}

function imagePresetTierForSelection(profile: ImageCapabilityConfig, size: string): ImageResolutionTier | undefined {
    if (profile.size.parameter !== "aspect_ratio" || !size || size === "auto") return undefined;
    return profile.size.presets?.find((preset) => preset.ratio === size)?.tier;
}

export function normalizeImageSizeSetting(profile: ImageCapabilityConfig, value?: string) {
    if (profile.size.parameter === "none") return "auto";
    const candidate = value?.trim() || profile.size.default;
    if (profile.size.allowCustom || profile.size.values.includes(candidate)) return candidate;
    return profile.size.default || profile.size.values[0] || "auto";
}

export function imageSizeRequest(profile: ImageCapabilityConfig, value?: string) {
    const parameter = profile.size.parameter;
    if (parameter === "none") return undefined;
    const normalized = normalizeImageSizeSetting(profile, value);
    if (!normalized || normalized === "auto") return undefined;
    return { parameter, value: normalized };
}

