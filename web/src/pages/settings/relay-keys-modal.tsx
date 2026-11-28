import { useCallback, useEffect, useState } from "react";
import { App, Button, Input, Modal } from "antd";

import { fetchRelayKeys, updateRelayKey, type RelayKeyEntry } from "@/services/api/relay-auth";

/** 服务详情：紧凑展示每个分组的密钥，可直接修改。 */
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
        <Modal open={open} title="SiFlux 服务详情" onCancel={onClose} footer={null} width={620}>
            <div className="flex items-center justify-between pb-2 text-xs text-foreground/50">
                <span>每个分组一把密钥，用于调用该分组的模型。</span>
                <Button size="small" type="text" loading={loading} onClick={() => void load()} className="text-xs">
                    刷新
                </Button>
            </div>
            {keys.length ? (
                <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-border/60">
                    {keys.map((entry) => (
                        <div
                            key={entry.group}
                            className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_auto] items-center gap-2 border-b border-border/40 px-3 py-1.5 last:border-b-0"
                        >
                            <div className="min-w-0">
                                <div className="truncate text-sm leading-5">{entry.group}</div>
                                <div className="text-[11px] leading-4 text-foreground/40">{entry.modelCount} 个模型</div>
                            </div>
                            <Input.Password
                                size="small"
                                aria-label={`${entry.group} 密钥`}
                                value={drafts[entry.group] ?? entry.key}
                                onChange={(event) => setDrafts((prev) => ({ ...prev, [entry.group]: event.target.value }))}
                                placeholder="填写该分组的密钥"
                            />
                            <Button
                                size="small"
                                type="primary"
                                loading={saving === entry.group}
                                disabled={(drafts[entry.group] ?? entry.key) === entry.key}
                                onClick={() => void save(entry.group)}
                            >
                                保存
                            </Button>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="m-0 py-6 text-center text-sm text-foreground/55">还没有分组密钥，重新登录一次会自动创建。</p>
            )}
        </Modal>
    );
}