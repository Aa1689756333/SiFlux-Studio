import { useEffect, useState } from "react";
import { App, Button, Input } from "antd";
import { FolderOpen } from "lucide-react";
import { getDesktopAppBinding, type DesktopStorageUsage } from "@/services/desktop-runtime";
import { flushModelConfig, getModelConfigPersistenceState } from "@/services/model-config-repository";
import { fetchDownloadDirectory, saveDownloadDirectory } from "@/services/api/download-directory";
import { saveRemoteUserDataNow } from "@/services/local-workspace-sync";

const size = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

export function StorageSettingsPane() {
    const { message, modal } = App.useApp();
    const binding = getDesktopAppBinding();
    const [usage, setUsage] = useState<DesktopStorageUsage>();
    const [target, setTarget] = useState("");
    const [busy, setBusy] = useState(false);
    const [downloadDir, setDownloadDir] = useState("");
    const [defaultDownloadDir, setDefaultDownloadDir] = useState("");
    const [downloadDraft, setDownloadDraft] = useState("");
    const [savingDownloadDir, setSavingDownloadDir] = useState(false);
    useEffect(() => {
        let active = true;
        void fetchDownloadDirectory()
            .then((state) => {
                if (!active) return;
                setDownloadDir(state.directory);
                setDefaultDownloadDir(state.default);
                setDownloadDraft(state.directory);
            })
            .catch(() => undefined);
        return () => { active = false; };
    }, []);
    const saveDownloadDir = async (directory: string) => {
        setSavingDownloadDir(true);
        try {
            const saved = await saveDownloadDirectory(directory);
            setDownloadDir(saved.directory);
            setDownloadDraft(saved.directory);
            message.success("下载位置已更新");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存下载位置失败");
        } finally {
            setSavingDownloadDir(false);
        }
    };
    const [error, setError] = useState("");
    const [cleanupInterrupted, setCleanupInterrupted] = useState(false);
    const [errorSummary, ...errorDetails] = error.split("\n\n");
    useEffect(() => {
        let active = true;
        void binding
            ?.StorageSettings?.()
            .then((value) => {
                if (active) setUsage(value);
            })
            .catch(() => {
                if (active) setError("存储信息暂时无法读取，请重试");
            });
        return () => {
            active = false;
        };
    }, [binding]);
    if (!binding?.StorageSettings || !binding.MigrateStorage) return null;
    const choose = async () => {
        try {
            const path = await binding.ChooseStorageDirectory?.();
            if (path) setTarget(path);
        } catch (error) {
            message.error(error instanceof Error ? error.message : String(error));
        }
    };
    const migrate = async () => {
        setBusy(true);
        setError("");
        try {
            await Promise.all([flushModelConfig(), saveRemoteUserDataNow()]);
            const state = getModelConfigPersistenceState();
            if (state.dirty || state.status === "error") throw new Error("模型配置尚未保存，请先解决保存错误再迁移");
            await binding.MigrateStorage!(target.trim());
            window.location.reload();
        } catch (error) {
            setError(error instanceof Error ? error.message : String(error));
            setBusy(false);
        }
    };
    const cleanup = () =>
        modal.confirm({
            title: "清理原目录",
            centered: true,
            okText: "确认并清理",
            cancelText: "取消",
            content: (
                <p className="break-words">
                    请先确认当前项目、素材和模型配置可以正常使用。清理 {usage?.previousDir} 可释放约 {size(usage?.previousBytes || 0)}；清理后无法从此目录恢复。
                </p>
            ),
            onOk: async () => {
                setBusy(true);
                setError("");
                try {
                    setUsage(await binding.CleanupPreviousStorage!());
                    setCleanupInterrupted(false);
                    message.success("原目录已清理");
                } catch (error) {
                    setCleanupInterrupted(true);
                    setError(error instanceof Error ? error.message : String(error));
                    // Cleanup may have removed durable copies while leaving busy scratch.
                    try {
                        setUsage(await binding.StorageSettings!());
                    } catch {
                        /* Keep the last known usage. */
                    }
                } finally {
                    setBusy(false);
                }
            },
        });
    return (
        <section className="settings-section storage-settings-block space-y-4" aria-label="本地存储">
            <div className="settings-pane-header">
                <div className="min-w-0">
                    <h2>本地存储</h2>
                </div>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 text-sm">
                <div className="min-w-0 break-all">当前目录：{usage?.dataDir || "正在读取…"}</div>
                {usage ? (
                    <p className="shrink-0 text-foreground/60">
                        数据占用 {size(usage.usedBytes)} · 磁盘剩余 {size(usage.freeBytes)}
                    </p>
                ) : null}
            </div>
            <label className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="shrink-0 text-sm">新存储目录：</span>
                <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                    <Input className="min-w-0 flex-1" aria-label="新存储目录" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="例如 D:\SiFlux" disabled={busy} />
                    <Button icon={<FolderOpen className="size-4" />} onClick={choose} disabled={busy}>
                        选择文件夹
                    </Button>
                </div>
            </label>
            <p className="text-sm leading-6 text-foreground/60">请选择空文件夹。迁移期间请暂停操作；完成后会重新载入。原目录会保留，请确认项目和素材完整后再清理。</p>
            {error ? (
                <div role="alert" className="text-sm text-destructive break-words">
                    <p>{errorSummary}</p>
                    {errorDetails.length > 0 ? (
                        <details className="mt-2">
                            <summary className="cursor-pointer">错误详情</summary>
                            <p className="mt-2 break-all whitespace-pre-wrap">{errorDetails.join("\n\n")}</p>
                        </details>
                    ) : null}
                </div>
            ) : null}
            <Button type="primary" onClick={migrate} loading={busy} disabled={!usage || !target.trim() || target.trim() === usage.dataDir}>
                {busy ? "正在迁移并校验文件…" : "迁移旧数据并使用新目录"}
            </Button>
            {usage?.previousDir && binding.CleanupPreviousStorage ? (
                <div className="space-y-2 border-t border-border pt-4">
                    <p className="text-sm break-all">待清理的原目录：{usage.previousDir}。</p>
                    {cleanupInterrupted ? <p className="text-sm">清理未完成，原目录可能已部分清理。请保留当前存储目录。</p> : null}
                    <Button danger disabled={busy} onClick={cleanup}>
                        清理原目录，释放磁盘空间
                    </Button>
                </div>
            ) : null}
            <div className="space-y-2 border-t border-border pt-4" aria-label="下载保存位置">
                <p className="m-0 text-sm">图片下载位置</p>
                <p className="m-0 break-all text-sm text-foreground/60">保存到：{downloadDir || "正在读取…"}</p>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Input className="min-w-0 flex-1" aria-label="下载保存目录" value={downloadDraft} onChange={(event) => setDownloadDraft(event.target.value)} placeholder={defaultDownloadDir || "例如 D:\\SiFlux\\downloads"} disabled={savingDownloadDir} />
                    <Button type="primary" loading={savingDownloadDir} disabled={!downloadDraft.trim() || downloadDraft.trim() === downloadDir} onClick={() => void saveDownloadDir(downloadDraft.trim())}>保存位置</Button>
                    {defaultDownloadDir && downloadDir !== defaultDownloadDir ? (
                        <Button onClick={() => void saveDownloadDir(defaultDownloadDir)} disabled={savingDownloadDir}>恢复默认</Button>
                    ) : null}
                </div>
                <p className="m-0 text-xs text-foreground/45">默认保存到软件安装目录下的 downloads 文件夹，留空保存即恢复默认。</p>
                <Button icon={<FolderOpen className="size-4" />} onClick={() => void saveDownloadDir("")} disabled={savingDownloadDir}>使用默认目录</Button>
            </div>
        </section>
    );
}
