import { Bot, Image } from "lucide-react";
import { Button, Select } from "antd";
import { useEffect, useRef } from "react";

import {
    compareModelNames,
    filterModelsByCapability,
    isBuiltinBeefAPIChannel,
    modelDisplayName,
    resolveModelChannel,
    type AiConfig,
    type ModelCapability,
} from "@/stores/use-config-store";
import { workspaceCapabilities } from "@/services/workspace-mode";

import { recordModelPickerChange, recordModelPickerOpenChange, recordModelPickerPress, watchModelPickerBlockers, type ModelPickerSnapshot } from "./model-settings-diagnostics";

export type DefaultModelKey = "imageModel" | "textModel" | "assistantModel";

type CapabilityRow = {
    kind: "capability";
    id: string;
    capability: ModelCapability;
    modelKey: DefaultModelKey;
    title: string;
    icon: typeof Image;
};


const rows: CapabilityRow[] = [
    { kind: "capability", id: "image", capability: "image", modelKey: "imageModel", title: "默认生图模型", icon: Image },
    { kind: "capability", id: "assistant", capability: "text", modelKey: "assistantModel", title: "Agent 模型", icon: Bot },
];

export function ModelDefaultGrid({ config, onChange, onOpenChannels }: { config: AiConfig; onChange: (key: DefaultModelKey, model: string) => void; onOpenChannels?: () => void }) {
    const localMode = workspaceCapabilities().local;
    const rootRef = useRef<HTMLDivElement>(null);
    useEffect(() => (rootRef.current ? watchModelPickerBlockers(rootRef.current) : undefined), []);
    // Agent 模型始终落到一个可用的对话模型：未指定或旧值失效时自动改选第一个。
    useEffect(() => {
        const available = filterModelsByCapability(config.models, "text", config.channels);
        if (!available.length) return;
        if (config.assistantModel && available.includes(config.assistantModel)) return;
        onChange("assistantModel", available[0]);
    }, [config.assistantModel, config.models, config.channels, onChange]);
    const buildStartedAt = performance.now();
    return (
        <div ref={rootRef} className="model-default-settings">
            {rows.map((row) => {
                const models = filterModelsByCapability(config.models, row.capability, config.channels);
                const configured = config[row.modelKey] || "";
                const selected = configured;
                const groups = models.map((model) => ({ key: model, models: [model] }));
                const options = groups.map((group) => {
                    const model = group.models.includes(selected) ? selected : group.models[0];
                    const label = modelDisplayName(config, model);
                    const modelChannel = resolveModelChannel(config, model);
                    const channel = isBuiltinBeefAPIChannel(modelChannel) ? "BeefTV" : modelChannel.name || "未命名渠道";
                    return { value: model, label, searchLabel: `${label} ${channel}`, channel };
                }).sort((a, b) => compareModelNames(a.label, b.label));
                // Agent 行始终自动落一个可用模型；其他行保留失效提示。
                const autoPick = row.id === "assistant";
                const unavailable = autoPick ? false : Boolean(configured && !options.some((option) => option.value === configured));
                const value = autoPick
                    ? (options.some((option) => option.value === configured) ? configured : options[0]?.value)
                    : configured ? (unavailable ? undefined : configured) : options[0]?.value;
                const Icon = row.icon;
                const snapshot: ModelPickerSnapshot = { pickerId: row.id, title: row.title, optionCount: options.length, hasValue: value !== undefined && value !== "", unavailable, disabled: !options.length, buildMs: performance.now() - buildStartedAt };
                return (
                    <section key={row.id} className="model-default-setting-row" aria-labelledby={`default-${row.id}-title`}>
                        <div className="model-default-setting-label">
                            <Icon className="size-4 shrink-0 text-foreground/50" />
                            <h3 id={`default-${row.id}-title`}>{row.title}</h3>
                        </div>
                        <div className="model-default-setting-control" onPointerDownCapture={(event) => {
                            if (event.target instanceof Element && event.target.closest(".model-default-select")) recordModelPickerPress(snapshot, { x: event.clientX, y: event.clientY });
                        }}>
                            <Select
                                aria-label={row.title}
                                className="model-default-select"
                                value={value}
                                options={options}
                                placeholder={unavailable ? "已选模型不可用，请重新选择" : options.length ? "选择模型" : "暂无可用模型"}
                                disabled={!options.length}
                                showSearch={{ optionFilterProp: "searchLabel" }}
                                listHeight={256}
                                popupMatchSelectWidth
                                classNames={{ popup: { root: `model-default-select-popup model-default-select-popup-${row.id}` } }}
                                optionRender={(option) => (
                                    <div className="model-default-select-option">
                                        <span>{option.data.label}</span>
                                        {option.data.channel ? <span className="model-default-select-channel">{option.data.channel}</span> : null}
                                    </div>
                                )}
                                onOpenChange={(open) => recordModelPickerOpenChange(snapshot, open)}
                                onChange={(model) => {
                                    recordModelPickerChange(snapshot);
                                    onChange(row.modelKey, model);
                                }}
                            />
                            {!options.length && localMode && onOpenChannels ? <Button type="link" size="small" onClick={onOpenChannels}>添加模型渠道</Button> : null}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}
