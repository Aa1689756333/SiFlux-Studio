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
    { kind: "capability", id: "assistant", capability: "image", modelKey: "assistantModel", title: "Agent 模型", icon: Bot },
];

export function ModelDefaultGrid({ config, onChange, onOpenChannels }: { config: AiConfig; onChange: (key: DefaultModelKey, model: string) => void; onOpenChannels?: () => void }) {
    const localMode = workspaceCapabilities().local;
    const rootRef = useRef<HTMLDivElement>(null);
    useEffect(() => (rootRef.current ? watchModelPickerBlockers(rootRef.current) : undefined), []);
    const buildStartedAt = performance.now();
    return (
        <div ref={rootRef} className="model-default-settings">
            {rows.map((row) => {
                // Agent 未单独指定时跟随默认生图模型，界面始终显示一个具体模型。
                const models = filterModelsByCapability(config.models, row.capability, config.channels);
                const selected = config[row.modelKey] || (row.modelKey === "assistantModel" ? config.imageModel || models[0] || "" : "");
                const groups = models.map((model) => ({ key: model, models: [model] }));
                const options = groups.map((group) => {
                    const model = group.models.includes(selected) ? selected : group.models[0];
                    const label = modelDisplayName(config, model);
                    const modelChannel = resolveModelChannel(config, model);
                    const channel = isBuiltinBeefAPIChannel(modelChannel) ? "BeefTV" : modelChannel.name || "未命名渠道";
                    return { value: model, label, searchLabel: `${label} ${channel}`, channel };
                }).sort((a, b) => compareModelNames(a.label, b.label));
                const unavailable = Boolean(selected && !options.some((option) => option.value === selected));
                const value = unavailable ? undefined : options.some((option) => option.value === selected) ? selected : undefined;
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
