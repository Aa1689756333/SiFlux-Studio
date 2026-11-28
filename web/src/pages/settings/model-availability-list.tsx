import { useMemo } from "react";

import { filterModelsByCapability, modelDisplayName, modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";

type Row = {
    model: string;
    name: string;
    meta: string;
    price: string;
    labels: string[];
};

function priceText(catalog: AiConfig["channels"][number]["relayCatalog"], model: string) {
    const entry = catalog?.prices?.[model];
    if (!entry) return "";
    // fixed(...) 是固定的单次价格，最直观。
    if (entry.fixedPrice && entry.fixedPrice > 0) return `$${entry.fixedPrice} / 次`;
    if (entry.quotaType === 1 && entry.price > 0) return `$${entry.price} / 次`;
    if (!entry.ratio) return "";
    return `${Number(entry.ratio.toFixed(2))}x 倍率`;
}

function groupText(catalog: AiConfig["channels"][number]["relayCatalog"], model: string) {
    const groups = catalog?.groups?.[model];
    if (!groups?.length) return "";
    return groups.length === 1 ? groups[0] : `${groups[0]} +${groups.length - 1}`;
}

function buildRows(models: string[], config: AiConfig, extraLabel: (model: string) => string | null): Row[] {
    return models
        .map((model) => {
            const extra = extraLabel(model);
            const channel = resolveModelChannel(config, model);
            const catalog = channel?.relayCatalog;
            // 目录里的键是服务端原始模型名，先去掉渠道前缀再查。
            const catalogKey = modelOptionName(model);
            const price = priceText(catalog, catalogKey);
            const group = groupText(catalog, catalogKey);
            const meta = catalog?.metas?.[catalogKey];
            const priceEntry = catalog?.prices?.[catalogKey];
            const vendor = priceEntry?.vendor?.trim() || "";
            const ownTags = priceEntry?.tags?.trim() || "";
            // 站点公开接口没有模型描述时用厂商名占位，避免显示服务名。
            const description = meta?.description?.trim() || priceEntry?.description?.trim() || vendor || "";
            const tagLabels = [...(ownTags ? [ownTags] : []), ...(meta?.tags || []), ...(group ? [group] : [])];
            return {
                model,
                name: modelDisplayName(config, model),
                meta: description,
                price,
                labels: [...(extra ? [extra] : []), ...tagLabels],
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
}

/** 设置页的可用模型清单：按生图 / 文本分组，组内按名称排序。 */
export function ModelAvailabilityList({ config }: { config: AiConfig }) {
    const groups = useMemo(() => {
        const all = Array.isArray(config.models) ? config.models : [];
        const imageModels = filterModelsByCapability(all, "image", config.channels);
        const textModels = filterModelsByCapability(all, "text", config.channels);
        const imageSet = new Set(imageModels);
        const textSet = new Set(textModels);
        const labelOf = (model: string) => {
            if (config.imageModel === model) return "默认生图";
            if (config.assistantModel === model) return "Agent";
            return null;
        };
        return [
            { key: "image", title: "生图模型", rows: buildRows(imageModels, config, labelOf) },
            {
                key: "text",
                title: "文本模型",
                // 同时具备两种能力的模型只列在生图组，避免重复。
                rows: buildRows(textModels.filter((model) => !imageSet.has(model)), config, labelOf),
            },
        ].filter((group) => group.rows.length > 0 || group.key === "image");
        void textSet;
    }, [config]);

    const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
    if (!total) {
        return <p className="m-0 text-sm text-foreground/55">还没有可用模型，请先在上面的服务里点「拉取模型」。</p>;
    }

    return (
        <div className="space-y-3">
            {groups.map((group) => (
                <div key={group.key}>
                    <div className="mb-2 flex items-baseline gap-2">
                        <h4 className="m-0 text-xs font-medium text-foreground/70">{group.title}</h4>
                        <span className="text-xs text-foreground/40">{group.rows.length}</span>
                    </div>
                    {group.rows.length ? (
                        <div className="overflow-hidden rounded-xl border border-border/60">
                            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 bg-foreground/[.03] px-3 py-1.5 text-xs text-foreground/50">
                                <span>模型</span>
                                <span className="text-right">用途</span>
                            </div>
                            <ul className="m-0 divide-y divide-border/50 p-0">
                                {group.rows.map((row) => (
                                    <li key={row.model} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-1.5">
                                        <div className="min-w-0">
                                            <div className="truncate text-sm leading-5 text-foreground">{row.name}</div>
                                            <div className="truncate text-[11px] leading-4 text-foreground/45">{row.meta}</div>
                                        </div>
                                        <span className="flex flex-wrap justify-end gap-1 text-[11px]">
                                            {row.price ? <span className="rounded-full bg-foreground/[.06] px-2 py-0.5 tabular-nums text-foreground/70">{row.price}</span> : null}
                                            {row.labels.map((label) => (
                                                <span key={label} className="rounded-full bg-primary/12 px-2 py-0.5 text-primary">{label}</span>
                                            ))}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : (
                        <p className="m-0 text-xs text-foreground/45">当前服务没有这类模型。</p>
                    )}
                </div>
            ))}
        </div>
    );
}
