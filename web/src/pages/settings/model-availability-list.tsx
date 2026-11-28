import { useMemo } from "react";

import { filterModelsByCapability, modelDisplayName, modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";

type Row = {
    model: string;
    name: string;
    description: string;
    tags: string[];
    price: string;
    usage: string[];
};

type Catalog = AiConfig["channels"][number]["relayCatalog"];

// 四列固定宽度，表头与每行共用同一套栅格，保证上下对齐。
const ROW_GRID = "grid grid-cols-[minmax(0,1fr)_112px_232px_72px] items-center gap-3 px-3 py-1.5";

// 价格变量到中文标签，顺序即展示顺序。
const UNIT_LABELS: [string, string][] = [
    ["p", "输入"],
    ["c", "输出"],
    ["cr", "缓存读取"],
    ["cc", "缓存写入"],
    ["img", "图片输入"],
    ["img_cr", "图片缓存输入"],
    ["img_o", "图片输出"],
    ["audio", "音频输入"],
    ["audio_o", "音频输出"],
];

function formatUnit(value: number) {
    if (value < 0.01) return Number(value.toFixed(4)).toString();
    return Number(value.toFixed(2)).toString();
}

function priceText(catalog: Catalog, key: string) {
    const entry = catalog?.prices?.[key];
    if (!entry) return "";
    // 固定单次价格（图片模型常见）。
    if (entry.fixedPrice && entry.fixedPrice > 0) return `$${entry.fixedPrice} / 次`;
    if (entry.quotaType === 1 && entry.price > 0) return `$${entry.price} / 次`;
    // 计费表达式里的单价就是站点实际计费价格。
    const units = entry.unitPrices || {};
    const parts = UNIT_LABELS.filter(([name]) => (units[name] ?? 0) > 0).map(([name, label]) => `${label} $${formatUnit(units[name])}`);
    if (parts.length) return parts.join(" · ");
    const input = entry.inputPrice ?? 0;
    const output = entry.outputPrice ?? 0;
    if (input > 0 || output > 0) return `输入 $${formatUnit(input)} · 输出 $${formatUnit(output)}`;
    return "";
}

function buildRows(models: string[], config: AiConfig, usageLabel: (model: string) => string | null): Row[] {
    return models
        .map((model) => {
            const channel = resolveModelChannel(config, model);
            const catalog = channel?.relayCatalog;
            // 目录里的键是服务端原始模型名，先去掉渠道前缀再查。
            const key = modelOptionName(model);
            const entry = catalog?.prices?.[key];
            const meta = catalog?.metas?.[key];
            const tags = [entry?.tags?.trim() || "", ...(meta?.tags || [])].filter(Boolean);
            const description = meta?.description?.trim() || entry?.description?.trim() || entry?.vendor?.trim() || "";
            const usage = usageLabel(model);
            return {
                model,
                name: modelDisplayName(config, model),
                description,
                tags: Array.from(new Set(tags)),
                price: priceText(catalog, key),
                usage: usage ? [usage] : [],
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
}

/** 设置页的可用模型清单：模型 / 标签 / 价格 / 用途 分列展示。 */
export function ModelAvailabilityList({ config }: { config: AiConfig }) {
    const groups = useMemo(() => {
        const all = Array.isArray(config.models) ? config.models : [];
        const imageModels = filterModelsByCapability(all, "image", config.channels);
        const textModels = filterModelsByCapability(all, "text", config.channels);
        const imageSet = new Set(imageModels);
        const usageLabel = (model: string) => {
            if (config.imageModel === model) return "默认生图";
            if (config.assistantModel === model) return "Agent";
            return null;
        };
        return [
            { key: "image", title: "生图模型", rows: buildRows(imageModels, config, usageLabel) },
            {
                key: "text",
                title: "文本模型",
                // 同时具备两种能力的模型只列在生图组，避免重复。
                rows: buildRows(textModels.filter((model) => !imageSet.has(model)), config, usageLabel),
            },
        ].filter((group) => group.rows.length > 0 || group.key === "image");
    }, [config]);

    const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
    if (!total) {
        return <p className="m-0 text-sm text-foreground/55">还没有可用模型，请先在上面的服务里点「拉取模型」。</p>;
    }

    return (
        <div className="space-y-3">
            {groups.map((group) => (
                <div key={group.key}>
                    <div className="mb-1.5 flex items-baseline gap-2">
                        <h4 className="m-0 text-xs font-medium text-foreground/70">{group.title}</h4>
                        <span className="text-xs text-foreground/40">{group.rows.length}</span>
                    </div>
                    {group.rows.length ? (
                        <div className="overflow-hidden rounded-xl border border-border/60">
                            <div className={ROW_GRID + " border-b border-border/60 bg-foreground/[.03] py-1.5 text-xs text-foreground/50"}>
                                <span>模型</span>
                                <span>标签</span>
                                <span title="按每百万 token 计价；标「/ 次」的为单次计价">价格（$/1M token）</span>
                                <span className="text-right">用途</span>
                            </div>
                            <ul className="m-0 divide-y divide-border/50 p-0">
                                {group.rows.map((row) => (
                                    <li key={row.model} className={ROW_GRID}>
                                        <div className="min-w-0">
                                            <div className="truncate text-sm leading-5 text-foreground">{row.name}</div>
                                            {row.description ? <div className="truncate text-[11px] leading-4 text-foreground/45">{row.description}</div> : null}
                                        </div>
                                        <div className="flex min-w-0 flex-wrap gap-1 text-[11px]">
                                            {row.tags.map((tag) => (
                                                <span key={tag} className="max-w-full truncate rounded-full bg-foreground/[.06] px-2 py-0.5 text-foreground/60">{tag}</span>
                                            ))}
                                        </div>
                                        <span className="text-[11px] leading-4 tabular-nums text-foreground/65">{row.price || "—"}</span>
                                        <span className="flex justify-end gap-1 text-[11px]">
                                            {row.usage.map((label) => (
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
