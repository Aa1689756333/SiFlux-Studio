import { Button, Select } from "antd";
import { X } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { resourceStorageKey } from "@/services/api/resources";
import { cacheResourceObjectUrl, peekCachedResourceObjectUrl } from "@/services/resource-blob-cache";
import { getActiveUserScope, getActiveUserScopeEpoch, subscribeUserScope } from "@/lib/user-scope";
import { captureUserScope, userScopeMatches, assertUserScope } from "@/lib/user-scope-guard";
import { ASSISTANT_ATTACHMENT_PURPOSES, assistantAttachmentPurposes } from "@/services/assistant-attachments";
import type { AssistantAttachment } from "@/services/api/agent-assistant";

function AttachmentPreview({ attachment }: { attachment: AssistantAttachment }) {
    const accountIdentity = useSyncExternalStore(subscribeUserScope, () => JSON.stringify([getActiveUserScope(), getActiveUserScopeEpoch()]), () => "");
    const expected = useMemo(() => captureUserScope(), [accountIdentity]);
    const storageKey = resourceStorageKey(attachment.resourceId);
    const identity = `${accountIdentity}:${attachment.resourceId}`;
    const [retry, setRetry] = useState(0);
    const [preview, setPreview] = useState<{ identity: string; url: string; error: boolean } | null>(null);
    useEffect(() => {
        let cancelled = false;
        setPreview(null);
        const load = async () => {
            assertUserScope(expected);
            return cacheResourceObjectUrl(storageKey);
        };
        void load().then(url => {
            if (!cancelled && userScopeMatches(expected)) setPreview({ identity, url, error: !url });
        }).catch(() => {
            if (!cancelled && userScopeMatches(expected)) setPreview({ identity, url: "", error: true });
        });
        return () => { cancelled = true; };
    }, [expected, identity, retry, storageKey]);
    const current = preview?.identity === identity ? preview : null;
    const url = current?.url || peekCachedResourceObjectUrl(storageKey);
    if (current?.error) return <span className="canvas-assistant-meta" role="status">预览暂时无法显示<Button size="small" onClick={() => setRetry(value => value + 1)}>重读预览</Button></span>;
    if (!url) return <span className="canvas-assistant-meta" role="status">正在读取预览…</span>;
    return <img src={url} alt={attachment.name} loading="lazy" onError={() => setPreview({ identity, url: "", error: true })} />;
}

export function CanvasAssistantAttachments({ attachments, onChange, onRemove }: {
    attachments: AssistantAttachment[];
    onChange?: (index: number, attachment: AssistantAttachment) => void;
    onRemove?: (index: number) => void;
}) {
    return <div className="canvas-assistant-attachments">{attachments.map((attachment, index) =>
        <div className="canvas-assistant-attachment" key={`${attachment.resourceId}:${index}`}>
            <div className="canvas-assistant-attachment-heading"><span title={attachment.name}>{attachment.name}</span>
                {onRemove ? <Button type="text" size="small" aria-label={`移除 ${attachment.name}`} icon={<X size={14} />} onClick={() => onRemove(index)} /> : null}</div>
            <AttachmentPreview attachment={attachment} />
            <span className="canvas-assistant-meta">{attachment.bytes > 0 ? `${(attachment.bytes / 1024).toFixed(0)} KB` : "已保存素材"}</span>
            {onChange ? <Select size="small" aria-label={`${attachment.name} 的用途`} value={attachment.purpose} options={assistantAttachmentPurposes()}
                labelRender={({ value }) => ASSISTANT_ATTACHMENT_PURPOSES.find(item => item.value === value)?.label || value}
                onChange={purpose => onChange(index, { ...attachment, purpose })} /> : <span className="canvas-assistant-meta">{ASSISTANT_ATTACHMENT_PURPOSES.find(item => item.value === attachment.purpose)?.label || "仅分析"}</span>}
        </div>)}</div>;
}