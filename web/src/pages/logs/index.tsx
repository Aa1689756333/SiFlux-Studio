import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Switch } from "antd";
import { Copy, Download, RefreshCw } from "lucide-react";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { fetchAppLogMeta, fetchAppLogs, type AppLogEntry, type AppLogMeta } from "@/services/api/app-logs";

const LEVEL_LABEL: Record<AppLogEntry["level"], string> = { info: "信息", warn: "警告", error: "错误" };

function formatForReport(entries: AppLogEntry[], meta: AppLogMeta | null) {
    const header = meta
        ? [`版本：${meta.version || "未知"}`, `平台：${meta.platform}`, `程序目录：${meta.exeDir}`, ""]
        : [];
    const body = entries.map((entry) => `${entry.time} [${LEVEL_LABEL[entry.level]}] ${entry.message}`);
    return [...header, ...body].join("\n");
}

/** 日志页：用户遇到问题时把这里的内容原样交给开发者即可。 */
export default function LogsPage() {
    const { message } = App.useApp();
    const [entries, setEntries] = useState<AppLogEntry[]>([]);
    const [meta, setMeta] = useState<AppLogMeta | null>(null);
    const [loading, setLoading] = useState(false);
    const [onlyProblems, setOnlyProblems] = useState(true);
    const [autoRefresh, setAutoRefresh] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [logs, info] = await Promise.all([fetchAppLogs(300), fetchAppLogMeta().catch(() => null)]);
            setEntries(logs.entries);
            if (info) setMeta(info);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取日志失败");
        } finally {
            setLoading(false);
        }
    }, [message]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        if (!autoRefresh) return;
        const timer = window.setInterval(() => void load(), 5000);
        return () => window.clearInterval(timer);
    }, [autoRefresh, load]);

    const visible = useMemo(() => (onlyProblems ? entries.filter((entry) => entry.level !== "info") : entries), [entries, onlyProblems]);
    const problemCount = useMemo(() => entries.filter((entry) => entry.level !== "info").length, [entries]);

    const copyAll = async () => {
        try {
            await navigator.clipboard.writeText(formatForReport(visible.length ? visible : entries, meta));
            message.success("日志已复制，可直接粘贴给开发者");
        } catch {
            message.error("复制失败，请手动选中文本复制");
        }
    };

    const exportFile = () => {
        const blob = new Blob([formatForReport(visible.length ? visible : entries, meta)], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `siflux-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    };

    return (
        <WorkspacePage>
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
                <header className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h1 className="m-0 text-lg font-semibold">运行日志</h1>
                        <p className="mt-1 mb-0 text-sm text-foreground/55">
                            遇到问题时点「复制日志」，把内容发给开发者即可，不需要自己判断错误原因。
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="flex items-center gap-1.5 text-sm text-foreground/60">
                            只看异常
                            <Switch size="small" checked={onlyProblems} onChange={setOnlyProblems} />
                        </span>
                        <span className="flex items-center gap-1.5 text-sm text-foreground/60">
                            自动刷新
                            <Switch size="small" checked={autoRefresh} onChange={setAutoRefresh} />
                        </span>
                        <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>刷新</Button>
                        <Button icon={<Copy className="size-4" />} onClick={() => void copyAll()}>复制日志</Button>
                        <Button type="primary" icon={<Download className="size-4" />} onClick={exportFile}>导出文件</Button>
                    </div>
                </header>

                <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-border/60 px-4 py-3 text-xs text-foreground/55">
                    <span>版本：{meta?.version || "未知"}</span>
                    <span>平台：{meta?.platform || "-"}</span>
                    <span className="break-all">日志文件：{meta?.logFile || "-"}</span>
                    <span>异常条数：{problemCount}</span>
                </div>

                <div className="overflow-hidden rounded-xl border border-border/60">
                    {visible.length ? (
                        <ul className="m-0 divide-y divide-border/50 p-0">
                            {visible.map((entry, index) => (
                                <li key={`${entry.time}-${index}`} className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-3 px-4 py-2">
                                    <span className="whitespace-nowrap text-xs tabular-nums text-foreground/45">{entry.time}</span>
                                    <span
                                        className={`rounded-full px-2 py-0.5 text-[11px] ${
                                            entry.level === "error"
                                                ? "bg-red-500/12 text-red-600 dark:text-red-400"
                                                : entry.level === "warn"
                                                  ? "bg-amber-500/12 text-amber-600 dark:text-amber-400"
                                                  : "bg-foreground/[.06] text-foreground/55"
                                        }`}
                                    >
                                        {LEVEL_LABEL[entry.level]}
                                    </span>
                                    <span className="min-w-0 break-all font-mono text-xs leading-5 text-foreground/80">{entry.message}</span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="m-0 px-4 py-10 text-center text-sm text-foreground/50">
                            {onlyProblems ? "暂时没有异常记录，一切正常。" : "暂时没有日志。"}
                        </p>
                    )}
                </div>
            </div>
        </WorkspacePage>
    );
}