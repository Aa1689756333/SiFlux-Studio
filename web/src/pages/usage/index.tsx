import { useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router";

import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { useGenerationUsage } from "@/hooks/use-generation-usage";
import { useRelayUsage } from "@/hooks/use-relay-usage";
import {
    formatRelayLogCache,
    formatRelayLogCost,
    formatRelayMoney,
    formatRelayPercent,
    formatRelayQuota,
    formatUsageDay,
    usageModelLabel,
    hasRealRelayMeter,
    heatmapLevel,
    heatmapMonthLabels,
    relayHeatmapWeeks,
    relayLogTypeLabel,
    relayOverviewInsights,
    relaySuccessRate,
    summarizeRelayLogs,
    type RelayDayMeter,
} from "@/lib/relay-usage";
import { IMAGE_ONLY_RELEASE } from "@/lib/release-flags";
import { summarizeUsageJobs, usageCreatedAtInRange, usageJobsInRange, type UsageKindSummary, type UsageRange } from "@/lib/usage-stats";

import "./usage.css";

const RANGES: { id: UsageRange; label: string }[] = [
    { id: "today", label: "今天" },
    { id: "7d", label: "近 7 天" },
    { id: "30d", label: "近 30 天" },
    { id: "90d", label: "近 90 天" },
    { id: "1y", label: "近一年" },
    { id: "all", label: "全部" },
];
const LOG_PAGE_SIZE = 50;

function emptySummary(): UsageKindSummary {
    return { jobs: 0, succeeded: 0, failed: 0, running: 0, outputs: 0 };
}

function UsageHeatmap({ logs, money }: { logs: Parameters<typeof relayHeatmapWeeks>[0]; money: (quota: number) => string }) {
    const [mode, setMode] = useState<"tokens" | "cost">("tokens");
    const weeks = useMemo(() => relayHeatmapWeeks(logs), [logs]);
    const months = useMemo(() => heatmapMonthLabels(weeks), [weeks]);
    const max = Math.max(1, ...weeks.flat().map((cell) => (mode === "cost" ? cell.quota : cell.tokens)));
    const monthAt = (week: number) => months.find((item) => item.week === week)?.label ?? "";
    const titleFor = (cell: RelayDayMeter) => `${cell.day}：${cell.requests} 次 · ${formatRelayQuota(cell.tokens)} token · ${money(cell.quota)}`;
    return (
        <section className="siflux-usage-panel">
            <header className="siflux-usage-panel-heading">
                <h2>每日活动</h2>
                <div className="siflux-usage-heatmap-modes" role="tablist" aria-label="热力图指标">
                    <button type="button" role="tab" aria-selected={mode === "tokens"} className={mode === "tokens" ? "is-active" : undefined} onClick={() => setMode("tokens")}>Token</button>
                    <button type="button" role="tab" aria-selected={mode === "cost"} className={mode === "cost" ? "is-active" : undefined} onClick={() => setMode("cost")}>成本</button>
                </div>
            </header>
            <div className="siflux-usage-heatmap" style={{ "--weeks": weeks.length } as CSSProperties}>
                <div className="siflux-usage-heatmap-months">
                    {weeks.map((_, index) => <span key={index}>{monthAt(index)}</span>)}
                </div>
                <div className="siflux-usage-heatmap-grid">
                    {weeks.flatMap((week, weekIndex) => week.map((cell, dayIndex) => {
                        const value = mode === "cost" ? cell.quota : cell.tokens;
                        return <span key={`${weekIndex}-${dayIndex}`} className={`siflux-usage-heat is-l${heatmapLevel(value, max)}`} title={titleFor(cell)} />;
                    }))}
                </div>
            </div>
        </section>
    );
}

function KindBlock({ title, to, summary, unit }: { title: string; to: string; summary: UsageKindSummary; unit: string }) {
    return (
        <section className="siflux-usage-kind">
            <header>
                <h2>{title}</h2>
                <Link to={to}>打开页面</Link>
            </header>
            <dl>
                <div><dt>产出</dt><dd>{summary.outputs} {unit}</dd></div>
                <div><dt>成功</dt><dd>{summary.succeeded}</dd></div>
                <div><dt>失败</dt><dd>{summary.failed}</dd></div>
                <div><dt>进行中</dt><dd>{summary.running}</dd></div>
            </dl>
        </section>
    );
}

export default function UsagePage() {
    const [range, setRange] = useState<UsageRange>("today");
    const [logPage, setLogPage] = useState(1);
    const generation = useGenerationUsage();
    const relay = useRelayUsage();
    const logs = relay.data?.logs ?? [];
    const rangedLogs = useMemo(() => logs.filter((row) => usageCreatedAtInRange(row.createdAt, range)), [logs, range]);
    const summary = useMemo(() => summarizeRelayLogs(rangedLogs), [rangedLogs]);
    const insights = useMemo(() => relayOverviewInsights(rangedLogs), [rangedLogs]);
    const successRate = relaySuccessRate(summary);
    const logPages = Math.max(1, Math.ceil(logs.length / LOG_PAGE_SIZE));
    const pageLogs = logs.slice((logPage - 1) * LOG_PAGE_SIZE, logPage * LOG_PAGE_SIZE);

    const snapshot = generation.data;
    const image = useMemo(() => summarizeUsageJobs(usageJobsInRange(snapshot?.image ?? [], range)), [range, snapshot]);
    const video = useMemo(() => summarizeUsageJobs(usageJobsInRange(snapshot?.video ?? [], range)), [range, snapshot]);
    const audio = useMemo(() => summarizeUsageJobs(usageJobsInRange(snapshot?.audio ?? [], range)), [range, snapshot]);
    const showRelay = hasRealRelayMeter(relay.data);
    const pricing = relay.data?.pricing ?? null;
    const money = (quota: number, alreadyUsd = false) => formatRelayMoney(quota, pricing, alreadyUsd);
    const description = relay.isPending
        ? "正在读取用量…"
        : showRelay
            ? "Token 与扣费优先读中转站调用记录；没有记录时再按价表估算。"
            : "还没有生成记录。生成后会按站点价表统计费用。";

    return (
        <WorkspacePage className="siflux-usage-page">
            <PageHeader title="用量统计" description={description} />
            <div className="siflux-usage-toolbar" role="tablist" aria-label="统计时间范围">
                {RANGES.map((item) => (
                    <button key={item.id} type="button" role="tab" aria-selected={range === item.id} className={range === item.id ? "is-active" : undefined} onClick={() => setRange(item.id)}>{item.label}</button>
                ))}
            </div>

            <section className="siflux-usage-hero" aria-label="用量概览">
                <article>
                    <small>费用</small>
                    <strong>{relay.isPending ? "…" : money(summary.quota)}</strong>
                </article>
                <article>
                    <small>请求</small>
                    <strong>{relay.isPending ? "…" : formatRelayQuota(summary.requests)}</strong>
                    <em>{successRate == null ? "暂无请求" : `成功率 ${(successRate * 100).toFixed(1)}%`}</em>
                </article>
                <article>
                    <small>Token</small>
                    <strong>{relay.isPending ? "…" : formatRelayQuota(insights.tokens)}</strong>
                    <em>输入 {formatRelayQuota(summary.promptTokens)} · 输出 {formatRelayQuota(summary.completionTokens)}</em>
                </article>
                <article>
                    <small>缓存命中率</small>
                    <strong>{relay.isPending ? "…" : formatRelayPercent(insights.cacheHitRate)}</strong>
                    <em>缓存 {formatRelayQuota(summary.cacheTokens)}</em>
                </article>
                <article>
                    <small>活跃天数</small>
                    <strong>{relay.isPending ? "…" : formatRelayQuota(insights.activeDays)}</strong>
                    <em>{insights.activeDays ? `最长连续 ${formatRelayQuota(insights.longestStreak)} 天` : "最长连续活跃天数"}</em>
                </article>
                <article>
                    <small>高峰日</small>
                    <strong>{relay.isPending ? "…" : (insights.peakDay ? `${formatRelayQuota(insights.peakTokens)} token` : "—")}</strong>
                    <em>{insights.peakDay ? formatUsageDay(insights.peakDay) : "暂无数据"}</em>
                </article>
                <article>
                    <small>用量最高模型</small>
                    <strong title={insights.topModel || undefined}>{relay.isPending ? "…" : (insights.topModel || "—")}</strong>
                    <em>{insights.topModel ? `${formatRelayQuota(insights.topModelTokens)} token` : "暂无数据"}</em>
                </article>
                <article>
                    <small>日均 Token</small>
                    <strong>{relay.isPending ? "…" : formatRelayQuota(Math.round(insights.dailyAvgTokens))}</strong>
                </article>
            </section>

            <div className="siflux-usage-kinds">
                <KindBlock title="图片生成" to="/generate/image" summary={generation.isPending ? emptySummary() : image} unit="张" />
                {!IMAGE_ONLY_RELEASE ? <KindBlock title="视频生成" to="/generate/video" summary={generation.isPending ? emptySummary() : video} unit="条" /> : null}
                {!IMAGE_ONLY_RELEASE ? <KindBlock title="音频生成" to="/generate/audio" summary={generation.isPending ? emptySummary() : audio} unit="条" /> : null}
            </div>

            <UsageHeatmap logs={logs} money={money} />

            <section className="siflux-usage-panel">
                <header className="siflux-usage-panel-heading">
                    <h2>调用记录</h2>
                    <p>
                        {relay.isPending ? "正在读取…" : `共 ${logs.length} 条`}
                    </p>
                </header>
                {pageLogs.length ? (
                    <>
                        <div className="siflux-usage-table-wrap">
                            <table className="siflux-usage-table">
                                <thead>
                                    <tr>
                                        <th>时间</th>
                                        <th className="siflux-usage-col-model">模型</th>
                                        <th>令牌</th>
                                        <th>类型</th>
                                        <th>输入</th>
                                        <th>输出</th>
                                        <th>缓存</th>
                                        <th>费用</th>
                                        <th>耗时</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageLogs.map((row) => (
                                        <tr key={row.id} title={row.content || undefined}>
                                            <td>{new Date(row.createdAt).toLocaleString("zh-CN")}</td>
                                            <td className="siflux-usage-col-model">{usageModelLabel(row.model)}</td>
                                            <td>{row.tokenName || "—"}</td>
                                            <td>{relayLogTypeLabel(row.type)}</td>
                                            <td>{formatRelayQuota(row.promptTokens)}</td>
                                            <td>{formatRelayQuota(row.completionTokens)}</td>
                                            <td>{formatRelayLogCache(row)}</td>
                                            <td>{formatRelayLogCost(row, pricing)}</td>
                                            <td>{row.durationSec ? `${row.durationSec}s` : "—"}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="siflux-usage-pager">
                            <button type="button" disabled={logPage <= 1} onClick={() => setLogPage((page) => page - 1)}>上一页</button>
                            <span>{logPage} / {logPages}</span>
                            <button type="button" disabled={logPage >= logPages} onClick={() => setLogPage((page) => page + 1)}>下一页</button>
                        </div>
                    </>
                ) : relay.isPending ? null : <p className="siflux-usage-empty">这个时间范围内没有调用记录。</p>}
            </section>
        </WorkspacePage>
    );
}
