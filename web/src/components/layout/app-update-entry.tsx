import { useState } from "react";
import { Button } from "antd";
import { ArrowUpCircle } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";
import { APP_VERSION } from "@/components/layout/app-changelog-modal";
import { useDesktopUpdate } from "@/hooks/use-desktop-update";
import {
    desktopUpdateDetailLabel,
    desktopUpdateProgressPercent,
    isNewerDesktopVersion,
    userFacingDesktopUpdateError,
} from "@/services/desktop-update";
import { cn } from "@/lib/utils";

/** 版本号入口：启动后台检查，有更新时在版本号旁显示提示点，点开可看更新说明并立即更新。 */
export function AppUpdateEntry({ collapsed }: { collapsed: boolean }) {
    const updater = useDesktopUpdate();
    const { state, actionBusy } = updater;
    const [open, setOpen] = useState(false);
    const installed = state.currentVersion || APP_VERSION;
    const latest = state.latestVersion;
    const available = Boolean(latest && isNewerDesktopVersion(latest, state.currentVersion || APP_VERSION));
    const busy = actionBusy || state.status === "downloading" || state.status === "installing";
    const progress = desktopUpdateProgressPercent(state);
    const errorText = state.status === "error" ? userFacingDesktopUpdateError(state.error) : "";

    const handleUpdate = async () => {
        if (updater.canForceInstall) {
            await updater.forceInstall();
            return;
        }
        await updater.downloadAndInstall();
    };

    return (
        <>
            <button
                type="button"
                className={cn("flex h-8 items-center gap-1.5 rounded-[var(--r-md)] px-2 text-[var(--fs-micro)] text-foreground/45 transition-colors hover:bg-surface-hover hover:text-foreground", collapsed && "justify-center px-0")}
                onClick={() => setOpen(true)}
                title={available ? `有新版本 ${latest}` : "查看版本与更新"}
                aria-label={available ? `有新版本 ${latest}，查看更新` : `当前版本 ${installed}`}
            >
                {collapsed ? (
                    <ArrowUpCircle className="size-4" aria-hidden />
                ) : (
                    <>
                        <span className="tabular-nums">{installed}</span>
                        {available ? <span className="size-1.5 rounded-full bg-primary" aria-hidden /> : null}
                    </>
                )}
            </button>

            <AppModal
                open={open}
                title={available ? `发现新版本 ${latest}` : "版本与更新"}
                onCancel={() => setOpen(false)}
                width={480}
                footer={
                    available
                        ? [
                              <Button key="later" onClick={() => setOpen(false)} disabled={busy}>
                                  稍后
                              </Button>,
                              <Button key="now" type="primary" loading={busy} onClick={() => void handleUpdate()}>
                                  立即更新
                              </Button>,
                          ]
                        : [
                              <Button key="close" type="primary" onClick={() => setOpen(false)}>
                                  关闭
                              </Button>,
                          ]
                }
            >
                <div className="space-y-4 text-sm leading-6">
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 px-4 py-3">
                        <div>
                            <div className="text-xs text-foreground/50">当前版本</div>
                            <div className="text-base font-semibold tabular-nums">{installed}</div>
                        </div>
                        {available ? (
                            <div className="text-right">
                                <div className="text-xs text-foreground/50">新版本</div>
                                <div className="text-base font-semibold text-primary tabular-nums">{latest}</div>
                            </div>
                        ) : null}
                    </div>

                    {busy ? (
                        <div className="rounded-xl border border-border/60 px-4 py-3" role="status" aria-live="polite">
                            <div className="text-sm font-medium">
                                {state.status === "installing" ? "正在安装更新" : "正在下载更新"}
                                {progress ? ` ${progress}%` : ""}
                            </div>
                            <div className="mt-1 text-xs text-foreground/55">{desktopUpdateDetailLabel(state)}</div>
                        </div>
                    ) : null}

                    {errorText ? (
                        <div className="rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3 text-xs text-red-600 dark:text-red-400">
                            {errorText}
                        </div>
                    ) : null}

                    {available ? (
                        <div>
                            <div className="mb-1.5 text-xs text-foreground/50">更新内容</div>
                            <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border/60 px-4 py-3 text-foreground/75">
                                {state.releaseNotes?.trim() || "本次更新包含功能改进与问题修复。"}
                            </div>
                        </div>
                    ) : (
                        <p className="m-0 text-foreground/65">已是最新版本，无需更新。</p>
                    )}
                </div>
            </AppModal>
        </>
    );
}