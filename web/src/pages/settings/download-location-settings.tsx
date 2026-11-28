import { useEffect, useState } from "react";
import { App, Button, Input } from "antd";
import { FolderOpen } from "lucide-react";

import { fetchDownloadDirectory, saveDownloadDirectory } from "@/services/api/download-directory";

/** 图片下载位置：默认在安装目录下的 downloads，用户可改。 */
export function DownloadLocationSettings() {
    const { message } = App.useApp();
    const [directory, setDirectory] = useState("");
    const [fallback, setFallback] = useState("");
    const [draft, setDraft] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let active = true;
        void fetchDownloadDirectory()
            .then((state) => {
                if (!active) return;
                setDirectory(state.directory);
                setFallback(state.default);
                setDraft(state.directory);
            })
            .catch(() => undefined);
        return () => {
            active = false;
        };
    }, []);

    const save = async (next: string) => {
        setSaving(true);
        try {
            const saved = await saveDownloadDirectory(next.trim());
            setDirectory(saved.directory);
            setDraft(saved.directory);
            message.success("下载位置已更新");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存下载位置失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-2">
            <p className="m-0 text-sm">图片下载位置</p>
            <p className="m-0 break-all text-sm text-foreground/60">保存到：{directory || "正在读取…"}</p>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Input
                    className="min-w-0 flex-1"
                    aria-label="下载保存目录"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder={fallback || "例如 D:\\SiFlux\\downloads"}
                    disabled={saving}
                />
                <Button type="primary" loading={saving} disabled={!draft.trim() || draft.trim() === directory} onClick={() => void save(draft)}>
                    保存位置
                </Button>
                {fallback && directory !== fallback ? (
                    <Button icon={<FolderOpen className="size-4" />} loading={saving} onClick={() => void save("")}>
                        使用默认目录
                    </Button>
                ) : null}
            </div>
            <p className="m-0 text-xs text-foreground/45">默认保存到软件安装目录下的 downloads 文件夹。</p>
        </div>
    );
}