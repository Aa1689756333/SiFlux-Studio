import { useMemo } from "react";

import { filterModelsByCapability, modelDisplayName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";

/** 设置页的可用模型清单：列出当前渠道下所有模型及其能力和默认归属。 */
export function ModelAvailabilityList({ config }: { config: AiConfig }) {
    const rows = useMemo(() => {
        const imageModels = new Set(filterModelsByCapability(config.models, "image", config.channels));
        const textModels = new Set(filterModelsByCapability(config.models, "text", config.channels));
        return (Array.isArray(config.models) ? config.models : []).map((model) => {
            const isImage = imageModels.has(model);
            const isText = textModels.has(model);
            const channel = resolveModelChannel(config, model);
            return {
                model,
                name: modelDisplayName(config, model),
                channel: channel?.name || "未命名渠道",
                capability: isImage && isText ? "生图 · 对话" : isImage ? "生图" : isText ? "对话" : "未标注",
                isImage,
                isText,
            };
        });
    }, [config]);

    if (!rows.length) {
        return <p className="m-0 text-sm text-foreground/55">还没有可用模型，请先在「服务」里拉取模型列表。</p>;
    }

    return (
        <div className="overflow-hidden rounded-xl border border-border/60">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-border/60 bg-foreground/[.03] px-4 py-2 text-xs text-foreground/50">
                <span>模型</span>
                <span>能力</span>
                <span className="text-right">用途</span>
            </div>
            <ul className="m-0 divide-y divide-border/50 p-0">
                {rows.map((row) => (
                    <li key={row.model} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-2.5">
                        <div className="min-w-0">
                            <div className="truncate text-sm text-foreground">{row.name}</div>
                            <div className="truncate text-xs text-foreground/45">{row.channel}</div>
                        </div>
                        <span className="rounded-full border border-border/60 px-2 py-0.5 text-xs text-foreground/60">{row.capability}</span>
                        <span className="flex justify-end gap-1 text-xs">
                            {config.imageModel === row.model ? <span className="rounded-full bg-primary/12 px-2 py-0.5 text-primary">默认生图</span> : null}
                            {config.assistantModel === row.model ? <span className="rounded-full bg-primary/12 px-2 py-0.5 text-primary">Agent</span> : null}
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}