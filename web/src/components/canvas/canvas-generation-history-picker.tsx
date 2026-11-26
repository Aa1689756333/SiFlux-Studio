import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { App, Button, Spin } from "antd";
import { Image as ImageIcon } from "lucide-react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import {
    awaitCanvasGenerationHistoryDetailIfValid,
    canvasGenerationHistorySelectStillValid,
    insertableCanvasGenerationHistoryTasks,
    type CanvasGenerationHistorySelectGate,
} from "@/lib/canvas/canvas-generation-history";
import { captureUserScopeEpoch, getActiveUserScope, getActiveUserScopeEpoch, subscribeUserScope } from "@/lib/user-scope";
import { ownedResourceIdFromMediaRef, resourceIdFromStorageKey, resourceStorageKey } from "@/services/api/resources";
import { listGenerationTasks, queryGenerationTask, type GenerationTask } from "@/services/api/task-center";
import "@/styles/assets-reference-baseline.css";

type CanvasGenerationHistoryPickerProps = {
    open: boolean;
    projectId: string;
    onClose: () => void;
    onSelect: (task: GenerationTask) => void;
};

export function CanvasGenerationHistoryPicker({ open, projectId, onClose, onSelect }: CanvasGenerationHistoryPickerProps) {
    const { message } = App.useApp();
    const [selectingId, setSelectingId] = useState("");
    const selectionRequest = useRef<AbortController | null>(null);
    const selectionEpoch = useRef(0);
    const openRef = useRef(open);
    const projectIdRef = useRef(projectId);
    const mountedRef = useRef(true);
    const onSelectRef = useRef(onSelect);
    openRef.current = open;
    projectIdRef.current = projectId;
    onSelectRef.current = onSelect;
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);
    const scope = useSyncExternalStore(subscribeUserScope, () => `${getActiveUserScope()}:${getActiveUserScopeEpoch()}`, () => "");
    const cancelSelection = () => {
        selectionEpoch.current += 1;
        selectionRequest.current?.abort();
        selectionRequest.current = null;
    };
    useEffect(() => () => cancelSelection(), [open, projectId, scope]);
    const query = useQuery({
        queryKey: ["canvas-generation-history", scope, projectId],
        queryFn: ({ signal }) => listGenerationTasks(100, { projectId, activeOnly: false }, undefined, signal),
        enabled: open && Boolean(projectId.trim()),
        staleTime: 15_000,
        refetchInterval: open ? 5000 : false,
    });
    const tasks = useMemo(
        () => insertableCanvasGenerationHistoryTasks(query.data || [], { projectId }),
        [projectId, query.data],
    );
    useEffect(() => {
        setSelectingId("");
    }, [open, projectId, scope]);
    const groups = [...new Set(tasks.map(historyTaskDay))];

    const liveSelectGate = (): CanvasGenerationHistorySelectGate => ({
        open: openRef.current,
        projectId: projectIdRef.current,
        epoch: captureUserScopeEpoch(),
        mounted: mountedRef.current,
        selectionEpoch: selectionEpoch.current,
    });

    const selectSummary = async (task: GenerationTask) => {
        if (selectionRequest.current || !task.id?.trim() || !projectId.trim()) return;
        const captured = liveSelectGate();
        if (!canvasGenerationHistorySelectStillValid(captured, captured)) return;
        const request = new AbortController();
        selectionRequest.current = request;
        setSelectingId(task.id);
        try {
            const resolved = await awaitCanvasGenerationHistoryDetailIfValid({
                detail: queryGenerationTask(task.id, { signal: request.signal }),
                captured,
                live: liveSelectGate,
                expectedId: task.id,
            });
            if (!resolved) return;
            onSelectRef.current(resolved);
        } catch (error) {
            if (!canvasGenerationHistorySelectStillValid(captured, liveSelectGate())) return;
            message.error(error instanceof Error ? error.message : "生成结果无法插入画布");
        } finally {
            if (selectionRequest.current === request) { selectionRequest.current = null; setSelectingId(""); }
        }
    };

    return (
        <AppModal open={open} destroyOnHidden centered title="生成历史" footer={null} onCancel={() => { cancelSelection(); setSelectingId(""); onClose(); }} width={760}>
            <div className="mt-4 min-h-48 max-h-[min(560px,65vh)] overflow-y-auto pr-1">
                {query.isLoading ? <div className="grid min-h-40 place-items-center"><Spin /></div> : tasks.length ? (
                    groups.map(date => <section key={date} className="generation-history-group">
                        <h2>{date}</h2>
                        <div className="generation-history-grid" style={{ gridTemplateColumns: "repeat(auto-fill, 142px)", maxWidth: "100%" }}>
                            {tasks.filter(task => historyTaskDay(task) === date).map(task => <HistoryTaskCard key={`${scope}:${projectId}:${task.id}`} task={task} selecting={selectingId === task.id} onSelect={() => void selectSummary(task)} />)}
                        </div>
                    </section>)
                ) : (
                    <div className="flex min-h-24 flex-col items-center justify-center gap-2 text-sm text-foreground/55">
                        {query.isError ? <>生成历史暂时无法读取<Button type="text" onClick={() => void query.refetch()}>重试</Button></> : "暂无生成结果"}
                    </div>
                )}
            </div>
        </AppModal>
    );
}

export function HistoryTaskCard({ task, selecting, onSelect }: { task: GenerationTask; selecting: boolean; onSelect: () => void }) {
    const preview = generationHistoryPreviewImageSrc(task);
    const storageKey = generationHistoryPreviewStorageKey(task);
    const iconFallback = <div className="grid size-full place-items-center text-foreground/45"><ImageIcon className="size-7" /></div>;
    return (
        <article className="generation-history-card group" title={task.prompt} aria-label={`添加图片到画布：${task.prompt.slice(0, 40)}`} aria-busy={selecting} aria-disabled={selecting} role="button" tabIndex={0} onClick={() => { if (!selecting) onSelect(); }} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); if (!selecting) onSelect(); } }}>
            <div className="generation-history-thumb">
                {storageKey ? (
                    <CachedResourceImage storageKey={storageKey} alt="生成结果预览" loading="lazy" className="size-full object-cover" fallback={iconFallback} loadingFallback={iconFallback} />
                ) : preview ? (
                    <img src={preview} alt="生成结果预览" loading="lazy" className="size-full object-cover" />
                ) : iconFallback}
                <span className="generation-history-badge" style={{ position: "absolute", top: 6, left: 6, padding: "1px 5px", border: "1px solid rgba(255,255,255,.32)", borderRadius: 4, background: "rgba(30,30,30,.55)", color: "rgba(255,255,255,.78)", fontSize: 10, lineHeight: "16px" }}>AI生成</span>
                {selecting ? <div className="absolute inset-0 grid place-items-center bg-black/30"><Spin size="small" /></div> : null}
            </div>
        </article>
    );
}

function historyTaskDay(task: GenerationTask) {
    const date = new Date(task.completedAt || task.createdAt);
    return Number.isNaN(date.getTime()) ? "日期未知" : date.toLocaleDateString("sv-SE");
}

export function generationHistoryPreviewImageSrc(task: GenerationTask) {
    const inline = inlineImagePreviewSrc(task.previewPosterUrl || task.previewUrl || previewFromResult(task));
    if (generationHistoryPreviewStorageKey(task) && !inline.startsWith("data:image/")) return "";
    return inline;
}

export function generationHistoryPreviewStorageKey(task: GenerationTask) {
    return imagePreviewStorageKey(task);
}

function inlineImagePreviewSrc(value: string) {
    if (!value || ownedResourceIdFromMediaRef(undefined, value)) return "";
    return isImagePreviewSrc(value) ? value : "";
}

function imagePreviewStorageKey(task: GenerationTask) {
    const preview = task.previewPosterUrl || task.previewUrl || previewFromResult(task);
    if (!task.resultJson) {
        const resourceId = ownedResourceIdFromMediaRef(undefined, preview);
        return resourceId ? resourceStorageKey(resourceId) : "";
    }
    try {
        const result = JSON.parse(task.resultJson) as { images?: Array<{ storageKey?: string; dataUrl?: string; url?: string }> };
        const image = result.images?.[0];
        const resourceId = resourceIdFromStorageKey(image?.storageKey) || ownedResourceIdFromMediaRef(image?.storageKey, image?.dataUrl || image?.url || preview);
        return resourceId ? resourceStorageKey(resourceId) : "";
    } catch {
        const resourceId = ownedResourceIdFromMediaRef(undefined, preview);
        return resourceId ? resourceStorageKey(resourceId) : "";
    }
}

function isImagePreviewSrc(value: string) {
    if (!value) return false;
    const lower = value.toLowerCase();
    if (lower.startsWith("data:")) return lower.startsWith("data:image/");
    return true;
}

function previewFromResult(task: GenerationTask) {
    if (!task.resultJson) return "";
    try {
        const result = JSON.parse(task.resultJson) as { images?: Array<{ dataUrl?: string; url?: string }> };
        return result.images?.[0]?.dataUrl || result.images?.[0]?.url || "";
    } catch {
        return "";
    }
}
