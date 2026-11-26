import { ImageSizePresetsEditor } from "./image-size-presets-editor";
import { imageSizeConfigWithPresets, imageSizePresets } from "@/lib/image-size-presets";
import { InputNumber, Select } from "antd";
import { Switch } from "@/components/ui/base/switch";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import type { ReactNode } from "react";

import { defaultImageCapabilityConfig, defaultModelCapabilityConfig, normalizeModelCapabilityConfig, type ImageCapabilityConfig, type ModelCapabilityConfig, type TextCapabilityConfig } from "@/lib/model-capabilities";
import type { ModelProtocol } from "@/lib/model-protocols";
function ImageSizeHelp() {
    return <p className="text-[var(--fs-label)] leading-relaxed text-foreground/60">按分辨率配置支持的比例，尺寸自动换算。size 发送像素，aspect_ratio 发送比例；独立分辨率由模型协议适配。实际输出尺寸以上游为准。</p>;
}

type Props = {
    value?: ModelCapabilityConfig;
    onChange?: (value: ModelCapabilityConfig) => void;
    protocol?: ModelProtocol;
    capability?: "text" | "image";
    model?: string;
    disabled?: boolean;
    section?: "all" | "protocol" | "references";
};

export function ModelCapabilityEditor({ value, onChange, protocol, capability = "image", model = "", disabled = false, section = "all" }: Props) {
    return capability === "text"
        ? <TextCapabilityEditor value={value} onChange={onChange} protocol={protocol} disabled={disabled} section={section} />
        : <ImageCapabilityEditor value={value} onChange={onChange} protocol={protocol} model={model} disabled={disabled} section={section} />;
}

function TextCapabilityEditor({ value, onChange, protocol, disabled, section }: Pick<Props, "value" | "onChange" | "protocol" | "disabled" | "section">) {
    const profile = value?.text || defaultModelCapabilityConfig(protocol).text!;
    const update = (patch: Partial<TextCapabilityConfig>) => {
        onChange?.({ version: 1, text: { ...profile, ...patch } });
    };
    const updateReferences = (patch: Partial<TextCapabilityConfig["references"]>) => {
        update({ references: { ...profile.references, ...patch } });
    };

    if (section === "protocol") {
        return (
            <div className="admin-capability-editor space-y-3 rounded-md bg-muted/20 p-3">
                <CapabilityGroup title="输出方式" description="控制向上游文本模型请求的响应方式。">
                    <ParameterField label="SSE 流式输出" description="启用后发送 stream=true，并实时推送文本增量；关闭时等待完整 JSON 响应。" supported={profile.streaming !== false} disabled={Boolean(disabled)} onChange={(streaming) => update({ streaming })} />
                </CapabilityGroup>
            </div>
        );
    }

    if (section === "references") {
        return (
            <div className="admin-capability-reference-editor">
                <div className="admin-capability-reference-grid is-two">
                    <ReferenceCard title="图片引用" description="文本模型可接收的图片范围">
                        <NumberField label="最大参考图片数" value={profile.references.maxImages} min={0} max={100} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ maxImages: next || 0 })} />
                        <NumberField label="单张图片上限 MB" value={bytesToMB(profile.references.maxImageBytes)} min={0} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ maxImageBytes: mbToBytes(next) })} />
                    </ReferenceCard>
                    <ReferenceCard title="通用限制" description="所有文本请求共用的基础约束">
                        <NumberField label="提示词最大字符数" value={profile.references.promptMaxChars} min={1} max={1_000_000} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ promptMaxChars: next || 1 })} />
                    </ReferenceCard>
                </div>
            </div>
        );
    }

    return (
        <div className="admin-capability-editor space-y-3 rounded-md bg-muted/20 p-3">
            <div>
                <div className="text-sm font-medium">文本理解能力</div>
                <div className="mt-0.5 text-[var(--fs-tiny)] text-foreground/48">用于 Agent 的文本推理与图片理解；图片输入需服务商明确支持并在此配置。</div>
            </div>
            <CapabilityGroup title="图片" description="文本模型可接收的图片参考范围">
                <div className="grid gap-3 sm:grid-cols-2">
                    <NumberField label="最大参考图片数" value={profile.references.maxImages} min={0} max={100} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ maxImages: next || 0 })} />
                    <NumberField label="单张图片上限 MB" value={bytesToMB(profile.references.maxImageBytes)} min={0} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ maxImageBytes: mbToBytes(next) })} />
                </div>
            </CapabilityGroup>
            <CapabilityGroup title="通用限制" description="所有文本请求共用的基础约束">
                <NumberField label="提示词最大字符数" value={profile.references.promptMaxChars} min={1} max={1_000_000} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ promptMaxChars: next || 1 })} />
            </CapabilityGroup>
        </div>
    );
}

function ImageCapabilityEditor({ value, onChange, protocol, model, disabled, section }: Required<Pick<Props, "model" | "disabled">> & Pick<Props, "value" | "onChange" | "protocol" | "section">) {
    const profile = normalizeModelCapabilityConfig(value || { version: 1, image: defaultImageCapabilityConfig(protocol, model) }).image!;
    const update = (patch: Partial<ImageCapabilityConfig>) => onChange?.({ version: 1, image: { ...profile, ...patch } });
    const updateReferences = (patch: Partial<ImageCapabilityConfig["references"]>) => update({ references: { ...profile.references, ...patch } });
    const updateSize = (patch: Partial<ImageCapabilityConfig["size"]>) => update({ size: { ...profile.size, ...patch } });
    const updateQuality = (patch: Partial<ImageCapabilityConfig["quality"]>) => update({ quality: { ...profile.quality, ...patch } });

    if (section === "references") {
        return (
            <div className="admin-capability-reference-editor">
                <div className="admin-capability-reference-grid is-two">
                    <ReferenceCard title="图片引用" description="参考图、文件大小与蒙版能力">
                        <NumberField label="最大参考图" value={profile.references.maxImages} min={0} disabled={disabled} onChange={(maxImages) => updateReferences({ maxImages: maxImages || 0 })} />
                        <NumberField label="单图上限 MB" value={bytesToMB(profile.references.maxImageBytes)} min={0} disabled={disabled} onChange={(maxImageBytes) => updateReferences({ maxImageBytes: mbToBytes(maxImageBytes) })} />
                        <ParameterField label="蒙版编辑" description="允许图片编辑接口提交 mask" supported={profile.references.maskSupported} disabled={disabled} onChange={(maskSupported) => updateReferences({ maskSupported })} />
                    </ReferenceCard>
                    <ReferenceCard title="通用限制" description="所有图片请求共用的基础约束">
                        <NumberField label="提示词最大字符数" value={profile.references.promptMaxChars} min={1} disabled={disabled} onChange={(promptMaxChars) => updateReferences({ promptMaxChars: promptMaxChars || 1 })} />
                    </ReferenceCard>
                </div>
            </div>
        );
    }

    if (section === "protocol") {
        return (
            <div className="admin-capability-protocol-editor admin-image-protocol-editor">
                <div className="admin-capability-protocol-grid admin-image-protocol-grid">
                    <ProtocolParameterCard step="01" title="尺寸参数" description="按分辨率配置可用画幅，直接点选或输入比例" className="admin-image-size-card">
                        <div className="admin-image-size-intro">
                            <SegmentedControl
                                block
                                disabled={disabled}
                                value={profile.size.parameter}
                                options={[
                                    { label: "不发送", value: "none" },
                                    { label: "size", value: "size" },
                                    { label: "aspect_ratio", value: "aspect_ratio" },
                                ]}
                                onChange={(value) => {
                                    const parameter = value as ImageCapabilityConfig["size"]["parameter"];
                                    updateSize(
                                        parameter === "none"
                                            ? { parameter, values: [], presets: undefined, default: "auto", allowCustom: false }
                                            : imageSizeConfigWithPresets({ ...profile, size: { ...profile.size, parameter } }, imageSizePresets(profile)),
                                    );
                                }}
                            />
                            <ImageSizeHelp />
                        </div>
                        {profile.size.parameter !== "none" ? (
                            <>
                                <ImageSizePresetsEditor profile={profile} disabled={disabled} onChange={updateSize} />
                                <ParameterField label="允许自定义" description="允许支持值之外的尺寸" supported={profile.size.allowCustom} disabled={disabled} onChange={(allowCustom) => updateSize({ allowCustom })} />
                            </>
                        ) : null}
                    </ProtocolParameterCard>
                    <ProtocolParameterCard step="02" title="输出数量" description="设置单次生成图片数量">
                        <NumberField label="单次生成张数" value={profile.maxOutputs} min={1} disabled={disabled} onChange={(maxOutputs) => update({ maxOutputs: maxOutputs || 1 })} />
                    </ProtocolParameterCard>
                    <ProtocolParameterCard step="03" title="可选参数" description="控制质量、背景与响应格式">
                        <ParameterField label="图片质量" description="发送 quality 参数" supported={profile.quality.supported} disabled={disabled} onChange={(supported) => updateQuality({ supported })} />
                        {profile.quality.supported ? (
                            <div className="admin-capability-spec-grid">
                                <Field label="质量支持值">
                                    <Select
                                        mode="tags"
                                        className="admin-capability-tags w-full"
                                        disabled={disabled}
                                        value={profile.quality.values}
                                        tokenSeparators={[","]}
                                        placeholder="例如 auto, low, medium, high, 1k, 2k, 4k"
                                        onChange={(values) => updateQuality({ values, default: values.includes(profile.quality.default) ? profile.quality.default : values[0] || "auto" })}
                                    />
                                </Field>
                                <Field label="默认质量">
                                    <Select
                                        className="w-full"
                                        disabled={disabled}
                                        value={profile.quality.default}
                                        options={profile.quality.values.map((item) => ({ label: item, value: item }))}
                                        onChange={(defaultValue) => updateQuality({ default: defaultValue })}
                                    />
                                </Field>
                            </div>
                        ) : null}
                        <BooleanField label="透明背景" value={profile.transparentBackground} disabled={disabled} onChange={(transparentBackground) => update({ transparentBackground })} />
                        <ParameterField label="response_format" description="发送 b64_json 响应格式" supported={profile.responseFormat.supported} disabled={disabled} onChange={(supported) => update({ responseFormat: { supported } })} />
                        <ParameterField label="output_format" description="发送 PNG 输出格式" supported={profile.outputFormat.supported} disabled={disabled} onChange={(supported) => update({ outputFormat: { supported } })} />
                    </ProtocolParameterCard>
                </div>
            </div>
        );
    }

    return (
        <div className="admin-capability-editor space-y-3 rounded-md bg-muted/10 p-3">
            <div className="admin-capability-editor-heading flex flex-wrap items-start justify-between gap-2">
                <div>
                    <div className="text-sm font-medium">图片能力参数</div>
                    <div className="mt-0.5 text-[var(--fs-tiny)] text-foreground/48">生成界面和后端请求都会按此处裁剪参数</div>
                </div>
                <span className="text-[var(--fs-tiny)] text-foreground/40">当前模型独立生效</span>
            </div>

            <CapabilityGroup title="图片" description="参考图、蒙版与图片输入约束">
                <div className="grid gap-3 sm:grid-cols-2">
                    <NumberField label="最大参考图" value={profile.references.maxImages} min={0} disabled={disabled} onChange={(maxImages) => updateReferences({ maxImages: maxImages || 0 })} />
                    <NumberField label="单图上限 MB" value={bytesToMB(profile.references.maxImageBytes)} min={0} disabled={disabled} onChange={(maxImageBytes) => updateReferences({ maxImageBytes: mbToBytes(maxImageBytes) })} />
                </div>
                <ParameterField label="蒙版编辑" description="允许调用图片编辑接口并提交 mask" supported={profile.references.maskSupported} disabled={disabled} onChange={(maskSupported) => updateReferences({ maskSupported })} />
            </CapabilityGroup>

            <CapabilityGroup title="输出规格" description="单次生成数量、尺寸参数与默认值">
                <CapabilityBlock title="生成数量">
                    <NumberField label="单次生成张数" value={profile.maxOutputs} min={1} disabled={disabled} onChange={(maxOutputs) => update({ maxOutputs: maxOutputs || 1 })} />
                </CapabilityBlock>
                <CapabilityBlock title="尺寸参数">
                    <ImageSizeHelp />
                    <SegmentedControl
                        block
                        disabled={disabled}
                        value={profile.size.parameter}
                        options={[
                            { label: "不发送", value: "none" },
                            { label: "size", value: "size" },
                            { label: "aspect_ratio", value: "aspect_ratio" },
                        ]}
                        onChange={(value) => {
                            const parameter = value as ImageCapabilityConfig["size"]["parameter"];
                            updateSize(
                                parameter === "none" ? { parameter, values: [], presets: undefined, default: "auto", allowCustom: false } : imageSizeConfigWithPresets({ ...profile, size: { ...profile.size, parameter } }, imageSizePresets(profile)),
                            );
                        }}
                    />
                    {profile.size.parameter !== "none" ? (
                        <>
                            <ImageSizePresetsEditor profile={profile} disabled={disabled} onChange={updateSize} />
                            <ParameterField label="允许自定义" description="允许用户输入支持值之外的尺寸" supported={profile.size.allowCustom} disabled={disabled} onChange={(allowCustom) => updateSize({ allowCustom })} />
                        </>
                    ) : null}
                </CapabilityBlock>
            </CapabilityGroup>

            <CapabilityGroup title="可选参数" description="质量、背景与响应格式等非必填能力">
                <ParameterField label="图片质量" description="发送 quality 参数" supported={profile.quality.supported} disabled={disabled} onChange={(supported) => updateQuality({ supported })} />
                {profile.quality.supported ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="质量支持值">
                            <Select
                                mode="tags"
                                className="admin-capability-tags w-full"
                                disabled={disabled}
                                value={profile.quality.values}
                                tokenSeparators={[","]}
                                placeholder="例如 auto, low, medium, high, 1k, 2k, 4k"
                                onChange={(values) => updateQuality({ values, default: values.includes(profile.quality.default) ? profile.quality.default : values[0] || "auto" })}
                            />
                        </Field>
                        <Field label="默认质量">
                            <Select
                                className="w-full"
                                disabled={disabled}
                                value={profile.quality.default}
                                options={profile.quality.values.map((item) => ({ label: item, value: item }))}
                                onChange={(defaultValue) => updateQuality({ default: defaultValue })}
                            />
                        </Field>
                    </div>
                ) : null}
                <BooleanField label="透明背景" value={profile.transparentBackground} disabled={disabled} onChange={(transparentBackground) => update({ transparentBackground })} />
                <div className="grid gap-3 sm:grid-cols-2">
                    <ParameterField label="response_format" description="发送 b64_json 响应格式" supported={profile.responseFormat.supported} disabled={disabled} onChange={(supported) => update({ responseFormat: { supported } })} />
                    <ParameterField label="output_format" description="发送 PNG 输出格式" supported={profile.outputFormat.supported} disabled={disabled} onChange={(supported) => update({ outputFormat: { supported } })} />
                </div>
            </CapabilityGroup>

            <CapabilityGroup title="通用限制" description="所有图片请求共用的基础约束">
                <NumberField label="提示词最大字符数" value={profile.references.promptMaxChars} min={1} disabled={disabled} onChange={(promptMaxChars) => updateReferences({ promptMaxChars: promptMaxChars || 1 })} />
            </CapabilityGroup>
        </div>
    );
}

function CapabilityGroup({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
    return (
        <details open className="admin-capability-group rounded-lg bg-muted/10 p-3">
            <summary className="cursor-pointer list-none pr-5">
                <span className="admin-capability-group-title block text-xs font-semibold text-foreground/70">{title}</span>
                {description ? <span className="admin-capability-group-description mt-0.5 block text-[var(--fs-tiny)] font-normal text-foreground/45">{description}</span> : null}
            </summary>
            <div className="mt-3 space-y-2">{children}</div>
        </details>
    );
}

function CapabilityBlock({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="admin-capability-block">
            <div className="admin-capability-block-title">{title}</div>
            <div className="space-y-2">{children}</div>
        </section>
    );
}

function ReferenceCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
    return (
        <section className="admin-capability-reference-card">
            <header className="admin-capability-reference-card-heading">
                <h3>{title}</h3>
                <p>{description}</p>
            </header>
            <div className="admin-capability-reference-fields">{children}</div>
        </section>
    );
}

function ProtocolParameterCard({ step, title, description, children, className = "" }: { step: string; title: string; description: string; children: ReactNode; className?: string }) {
    return (
        <section className={`admin-capability-protocol-card ${className}`}>
            <header className="admin-capability-protocol-card-heading">
                <span>{step}</span>
                <div>
                    <h3>{title}</h3>
                    <p>{description}</p>
                </div>
            </header>
            <div className="admin-capability-protocol-fields">{children}</div>
        </section>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="block min-w-0">
            <span className="mb-1 block text-[var(--fs-tiny)] text-foreground/48">{label}</span>
            {children}
        </label>
    );
}

function NumberField({ label, value, min, max, disabled, onChange }: { label: string; value?: number; min: number; max?: number; disabled: boolean; onChange: (value: number | null) => void }) {
    return (
        <label className="admin-capability-number-field block min-w-0">
            <span className="admin-capability-field-label mb-1.5 block text-xs text-foreground/62">{label}</span>
            <InputNumber className="w-full" disabled={disabled} min={min} max={max} precision={0} value={value} onChange={onChange} />
        </label>
    );
}

function BooleanField({ label, value, disabled, onChange }: { label: string; value: { supported: boolean; default: boolean }; disabled: boolean; onChange: (value: { supported: boolean; default: boolean }) => void }) {
    return (
        <div className="admin-capability-boolean-field flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2.5">
            <div className="min-w-0">
                <div className="text-xs font-medium">{label}</div>
                <div className="text-[var(--fs-tiny)] text-foreground/45">可发送参数与默认值</div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
                <label className="grid justify-items-center gap-1 text-[var(--fs-tiny)] text-foreground/45">
                    <span>支持</span>
                    <Switch aria-label={`${label}支持`} size="sm" disabled={disabled} checked={value.supported} onChange={(supported) => onChange({ ...value, supported })} />
                </label>
                <label className="grid justify-items-center gap-1 text-[var(--fs-tiny)] text-foreground/45">
                    <span>默认</span>
                    <Switch aria-label={`${label}默认值`} size="sm" disabled={disabled || !value.supported} checked={value.default} onChange={(defaultValue) => onChange({ ...value, default: defaultValue })} />
                </label>
            </div>
        </div>
    );
}

function ParameterField({ label, description, supported, disabled, onChange }: { label: string; description: string; supported: boolean; disabled: boolean; onChange: (supported: boolean) => void }) {
    return (
        <div className="admin-capability-parameter-field flex min-h-12 items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2.5">
            <div className="min-w-0">
                <div className="break-all text-xs font-medium">{label}</div>
                <div className="mt-0.5 text-[var(--fs-tiny)] leading-5 text-foreground/45">{description}</div>
            </div>
            <label className="grid shrink-0 justify-items-center gap-1 text-[var(--fs-tiny)] text-foreground/45">
                <span>支持</span>
                <Switch aria-label={`${label}支持`} size="sm" disabled={disabled} checked={supported} onChange={onChange} />
            </label>
        </div>
    );
}

function bytesToMB(value: number) {
    return value ? Math.round((value / (1024 * 1024)) * 10) / 10 : 0;
}

function mbToBytes(value: number | null) {
    return Math.max(0, Math.round(Number(value || 0) * 1024 * 1024));
}

