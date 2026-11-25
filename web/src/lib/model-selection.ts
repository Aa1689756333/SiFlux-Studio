import { defaultImageCapabilityConfig, modelCapabilityConfigFor, normalizeImageValue, STANDARD_IMAGE_SIZE_VALUES, type ImageCapabilityConfig } from "@/lib/model-capabilities";
import { imageSizePresets } from "@/lib/image-size-presets";
import { channelModelProfile, modelOptionName, resolveModelChannel, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

export type ModelInputSummary = {
    textCount: number;
    imageCount: number;
    characterCount: number;
};

export type ModelRequirements = {
    capability?: ModelCapability;
    input?: ModelInputSummary;
    imageSize?: string;
    options?: Record<string, unknown>;
};

export type DisplayModelGroup = {
    key: string;
    label: string;
    models: string[];
};

export type ModelReferenceLimits = {
    maxImages: number;
};

export function groupModelsByDisplayName(config: AiConfig, models: string[]): DisplayModelGroup[] {
    const groups = new Map<string, DisplayModelGroup>();
    models.forEach((model) => {
        const channel = resolveModelChannel(config, model);
        const label = configuredModelDisplayName(config, model);
        const key = `${channel.id}\u0000${label.toLocaleLowerCase()}`;
        const current = groups.get(key);
        if (current) current.models.push(model);
        else groups.set(key, { key, label, models: [model] });
    });
    return Array.from(groups.values())
        .map((group) => ({ ...group, models: [...group.models].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })) }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }));
}

export function configuredModelDisplayName(config: AiConfig, value: string) {
    const model = modelOptionName(value);
    const channel = resolveModelChannel(config, value);
    return channelModelProfile(channel, model)?.displayName?.trim() || model;
}

export function modelCompatibilityError(config: AiConfig, model: string, requirements?: ModelRequirements) {
    const capability = requirements?.capability;
    if (!capability) return "";
    const input = requirements?.input;
    const visualInputCount = input ? input.imageCount + input.characterCount : 0;
    const channel = resolveModelChannel(config, model);
    const logicalCost = channel.modelProfiles?.find((item) => item.model === modelOptionName(model));
    const logicalSpecs = logicalCost?.logicalCapabilityProfiles?.length ? logicalCost.logicalCapabilityProfiles : logicalCost?.logicalCapabilitySpec ? [logicalCost.logicalCapabilitySpec] : [];
    if (logicalSpecs.length) {
        const publicOptionNames = logicalCost?.logicalCapabilitySpec?.options || {};
        const logicalRequirements = {
            ...requirements,
            options: Object.fromEntries(Object.entries(requirements.options || {}).filter(([name]) => Boolean(publicOptionNames[name]))),
        };
        const errors = logicalSpecs.map((spec) => logicalModelCompatibilityError(spec, logicalRequirements, visualInputCount));
        return errors.some((error) => !error) ? "" : errors[0] || "当前输入不受支持";
    }

    if (capability !== "image") return "";

    const image = modelCapabilityConfigFor(config, model).image!;
    // 尺寸兼容不依赖输入摘要：无输入时（如画布重试/工具链）也要按尺寸过滤组内模型。
    if (requirements.imageSize && !image.size.allowCustom && !image.size.values.includes(requirements.imageSize)) return "不支持当前尺寸";
    if (!input) return "";
    if (visualInputCount > image.references.maxImages) return `最多支持 ${image.references.maxImages} 张参考图`;
    return "";
}

export function modelPromptLengthError(config: AiConfig, model: string, capability: ModelCapability, prompt: string) {
    const channel = resolveModelChannel(config, model);
    const configuredProfile = channel.modelProfiles?.find((item) => item.model === modelOptionName(model))?.capabilityConfig;
    if (!configuredProfile) return "";
    const profile = modelCapabilityConfigFor(config, model);
    const maxChars = capability === "text" ? profile.text?.references.promptMaxChars : profile.image?.references.promptMaxChars;
    if (!maxChars || maxChars <= 0) return "";
    const actualChars = Array.from(prompt).length;
    if (actualChars <= maxChars) return "";
    const label = capability === "text" ? "文本" : "图片";
    return `当前${label}模型提示词最多 ${maxChars} 个字符，完整提示词为 ${actualChars} 个字符。系统不会自动截断，请精简当前输入、连线内容或技能上下文后重试`;
}

export function modelRequestOptions(config: AiConfig, capability: ModelCapability) {
    return capability === "image" ? { size: config.size, quality: config.quality, transparentBackground: config.transparentBackground === "true", count: Number(config.count) } : {};
}

function logicalModelCompatibilityError(spec: NonNullable<NonNullable<AiConfig["channels"][number]["modelProfiles"]>[number]["logicalCapabilitySpec"]>, requirements: ModelRequirements, visualInputCount: number) {
    if (requirements.capability && spec.capability !== requirements.capability) return "不支持当前生成类型";
    const counts: Record<string, number> = {
        text: 0,
        image: visualInputCount,
    };
    for (const [kind, count] of Object.entries(counts)) {
        const constraint = spec.inputs?.[kind];
        if (!constraint && count > 0) return `不支持${kind}输入`;
        if (constraint && (count < constraint.min || count > constraint.max)) return `${kind}输入需为 ${constraint.min}-${constraint.max} 个`;
    }
    const options = {
        ...requirements.options,
        ...(requirements.capability === "image" && requirements.imageSize ? { size: requirements.imageSize } : {}),
    };
    for (const [name, value] of Object.entries(options)) {
        if (value === undefined || value === null || value === "") continue;
        const constraint = spec.options?.[name];
        if (!constraint || !logicalOptionMatches(name, constraint, value)) return logicalOptionError(name);
    }
    return "";
}

function logicalOptionMatches(_name: string, constraint: { values?: unknown[]; min?: number; max?: number; step?: number }, value: unknown) {
    if (constraint.values?.length) {
        const requested = normalizeLogicalOptionValue(value);
        return constraint.values.some((candidate) => normalizeLogicalOptionValue(candidate) === requested);
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return false;
    if (constraint.min !== undefined && numeric < constraint.min) return false;
    if (constraint.max !== undefined && numeric > constraint.max) return false;
    if (constraint.step !== undefined && constraint.min !== undefined) return Math.abs((numeric - constraint.min) / constraint.step - Math.round((numeric - constraint.min) / constraint.step)) < 1e-9;
    return true;
}

function normalizeLogicalOptionValue(value: unknown) {
    return String(value).trim().toLowerCase();
}

function logicalOptionError(name: string) {
    const label: Record<string, string> = {
        size: "尺寸",
        quality: "质量",
        transparentBackground: "透明背景",
        count: "输出数量",
    };
    return `不支持当前${label[name] || name}`;
}

export function compatibleModelInGroup(config: AiConfig, models: string[], requirements?: ModelRequirements, preferred?: string) {
    const compatible = models.filter((model) => !modelCompatibilityError(config, model, requirements));
    if (!compatible.length) return "";
    if (compatible.length === 1) return compatible[0];
    return compatible.sort((left, right) => (left === preferred ? -1 : right === preferred ? 1 : 0))[0];
}

export function resolveCompatibleModel(config: AiConfig, selected: string, requirements?: ModelRequirements) {
    if (!requirements?.capability) return selected;
    // Automatic resolution keeps the saved identity. Explicit menu selection
    // may choose the usable canonical entry and refresh its parameters.
    const options = selectableModelsByCapability(config, requirements.capability);
    if (!options.length) return selected;
    const selectedGroup = groupModelsByDisplayName(config, options).find((group) => group.models.includes(selected));
    if (!selectedGroup) return selected;
    return compatibleModelInGroup(config, selectedGroup.models, requirements, selected);
}

// 同显示名分组的模型族：尺寸/比例/分辨率选项取组内全部模型配置的并集，
// 让用户能看到并选择任意成员支持的能力，选中后由兼容路由落到具体模型。
// 质量、透明背景等其余能力取当前选中（路由后）模型的配置，与创作页面一致。
export function mergedImageCapabilityConfig(config: AiConfig, selected: string): ImageCapabilityConfig {
    const options = selectableModelsByCapability(config, "image");
    const group = options.length ? groupModelsByDisplayName(config, options).find((item) => item.models.includes(selected)) : undefined;
    const models = group?.models.length ? group.models : [selected];
    const selectedProfile = modelCapabilityConfigFor(config, selected).image;
    const profiles = models.map((model) => modelCapabilityConfigFor(config, model).image).filter((profile): profile is ImageCapabilityConfig => Boolean(profile));
    if (profiles.length <= 1) return selectedProfile || defaultImageCapabilityConfig();
    const concreteValues = Array.from(new Set(profiles.flatMap((profile) => profile.size.values).filter((value) => value !== "*")));
    const allowCustom = profiles.some((profile) => profile.size.allowCustom || profile.size.values.includes("*"));
    const values = concreteValues.length ? concreteValues : allowCustom ? [...STANDARD_IMAGE_SIZE_VALUES] : [];
    const base = selectedProfile || profiles[0];
    const presets = profiles.some((profile) => profile.size.presets) ? [...new Map(profiles.flatMap((profile) => imageSizePresets(profile)).map((preset) => [`${preset.tier}:${preset.ratio}:${preset.size}`, preset])).values()] : undefined;
    return { ...base, size: { ...base.size, values, allowCustom, presets } };
}

// 切换模型后初始化图片参数为该模型能力默认值，避免旧参数在目标模型族不兼容导致无法切换。
export function defaultImageParamsForModel(config: AiConfig, model: string): Pick<AiConfig, "size" | "quality" | "transparentBackground"> {
    const image = modelCapabilityConfigFor(config, model).image;
    if (!image) return { size: "1:1", quality: "auto", transparentBackground: "false" };
    const sizeValues = image.size.values.filter((value) => value !== "*");
    const sizeDefault = image.size.default !== "*" && image.size.default ? image.size.default : sizeValues[0] || "1:1";
    return {
        size: sizeDefault,
        quality: image.quality.default || "auto",
        transparentBackground: String(image.transparentBackground.default ?? false),
    };
}

export type ModelGenerationDefaults = Pick<AiConfig, "size" | "quality" | "transparentBackground" | "count">;

export function resolveModelGenerationDefaults(
    config: AiConfig,
    model: string,
    capability: ModelCapability | undefined,
    explicit: Partial<ModelGenerationDefaults> = {},
    fallback: Partial<ModelGenerationDefaults> = {},
): Partial<ModelGenerationDefaults> {
    if (capability !== "image") return {};
    const channel = resolveModelChannel(config, model);
    const profile = channel.modelProfiles?.find((item) => item.model === modelOptionName(model));
    const isManagedModel = Boolean(profile?.logicalModelId || profile?.logicalCapabilitySpec);
    // A channel model capability profile is an explicit per-model contract too.
    // The persisted global values are legacy defaults and must not override a
    // model's configured ratio on a new canvas node.
    const hasModelCapabilityProfile = Boolean(profile?.capabilityConfig);
    const source = (key: keyof ModelGenerationDefaults) => explicit[key] ?? (isManagedModel || hasModelCapabilityProfile ? undefined : fallback[key]);
    const capabilityProfile = modelCapabilityConfigFor(config, model);
    if (!capabilityProfile.image) return {};
    return normalizeImageValue(capabilityProfile.image, {
        size: source("size"),
        quality: source("quality"),
        count: source("count"),
        transparentBackground: source("transparentBackground"),
    });
}

export function maxModelInputCapacity(config: AiConfig, capability: ModelCapability, kind: "image") {
    const options = selectableModelsByCapability(config, capability);
    if (!options.length) return null;
    return options.reduce((maximum, model) => {
        const profile = modelCapabilityConfigFor(config, model);
        // 文本模型只在支持视觉输入时声明参考图上限；图片模型的上限来自自身能力配置。
        const value = capability === "image" ? profile.image!.references.maxImages : profile.text!.references.maxImages;
        return Math.max(maximum, value);
    }, 0);
}

export function modelGroupReferenceLimits(config: AiConfig, selected: string, capability: ModelCapability, requirements?: ModelRequirements): ModelReferenceLimits | undefined {
    if (capability !== "image") return undefined;
    const options = selectableModelsByCapability(config, capability);
    const selectedGroup = groupModelsByDisplayName(config, options).find((group) => group.models.includes(selected));
    const groupModels = selectedGroup?.models || (selected ? [selected] : []);
    if (!groupModels.length) return undefined;
    const compatibleModels = requirements ? groupModels.filter((model) => !modelCompatibilityError(config, model, requirements)) : groupModels;
    const models = compatibleModels.length ? compatibleModels : groupModels;
    return models.reduce<ModelReferenceLimits>(
        (limits, model) => ({ maxImages: Math.max(limits.maxImages, modelCapabilityConfigFor(config, model).image!.references.maxImages) }),
        { maxImages: 0 },
    );
}
