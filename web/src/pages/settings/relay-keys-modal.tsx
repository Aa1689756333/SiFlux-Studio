import { useCallback, useEffect, useState } from "react";
import { App, Button, Input, Modal } from "antd";

import { CopyOutlined } from "@ant-design/icons";

import { fetchRelayKeys, updateRelayKey, type RelayKeyEntry } from "@/services/api/relay-auth";

/** 服务详情：展示每个分组的密钥，可修改。 */
export function RelayKeysModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { message } = App.useApp();
    const [keys, setKeys] = useState<RelayKeyEntry[]>([]);
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState("");
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchRelayKeys();
            setKeys(data.keys);
            setDrafts({});
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取密钥失败");
        } finally {
            setLoading(false);
        }
    }, [message]);

    useEffect(() => {
        if (open) void load();
    }, [open, load]);

    const save = async (group: string) => {
        const key = (drafts[group] ?? "").trim();
        if (!key) return;
        setSaving(group);
        try {
            await updateRelayKey(group, key);
            message.success(`${group} 的密钥已更新`);
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        } finally {
            setSaving("");
        }
    };

    return (
        <Modal open={open} title="SiFlux 服务详情" onCancel={onClose} footer={null} width={720}>
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <p className="m-0 text-sm text-foreground/60">每个分组各有一把密钥，用于调用该分组的模型。</p>
                    <Button size="small" loading={loading} onClick={() => void load()}>刷新</Button>
                </div>
                {keys.length ? (
                    <ul className="m-0 divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60 p-0">
                        {keys.map((entry) => (
                            <li key={entry.group} className="space-y-2 px-4 py-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-sm font-medium">{entry.group}</span>
                                    <span className="text-xs text-foreground/45">{entry.modelCount} 个模型</span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Input.Password
                                        className="min-w-0 flex-1"
                                        aria-label={`${entry.group} 密钥`}
                                        value={drafts[entry.group] ?? entry.key}
                                        onChange={(event) => setDrafts((prev) => ({ ...prev, [entry.group]: event.target.value }))}
                                        placeholder="填写该分组的密钥"
                                    />
                                    <Button
                                        icon={<CopyOutlined />}
                                        onClick={async () => {
                                            try {
                                                await navigator.clipboard.writeText(drafts[entry.group] ?? entry.key);
                                                message.success("密钥已复制");
                                            } catch {
                                                message.error("复制失败");
                                            }
                                        }}
                                    >
                                        复制
                                    </Button>
                                    <Button
                                        type="primary"
                                        loading={saving === entry.group}
                                        disabled={(drafts[entry.group] ?? entry.key) === entry.key}
                                        onClick={() => void save(entry.group)}
                                    >
                                        保存
                                    </Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="m-0 text-sm text-foreground/55">还没有分组密钥，重新登录一次会自动创建。</p>
                )}
                <p className="m-0 text-xs text-foreground/45">密钥保存在本机，修改后立即生效。</p>
            </div>
        </Modal>
    );
}