import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { AlertCircle, Clock3, Download, FileText, Image as ImageIcon, LoaderCircle, RefreshCw, Square } from "lucide-react";

import { GenerationFailureNotice } from "@/components/generation/generation-failure-notice";
import { generationDeliveryProgressView, generationTaskFetchingResult } from "@/lib/generation-delivery-progress";
import { explainGenerationError } from "@/lib/generation-error";
import { formatGenerationElapsed, generationProgressDisplay, generationTaskShowsProgress, isGenerationTaskSubmissionUncertain, trackGenerationProgressChange, type GenerationProgressRecord } from "@/lib/generation-task-display";
import { canvasRichTextHTML } from "@/lib/canvas/canvas-rich-text";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { buildLibTVImagePreviewUrl } from "@/lib/canvas/libtv-import";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { formatBytes } from "@/lib/image-utils";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import type { GenerationTask } from "@/services/api/task-center";
import { cacheResourceObjectUrl, getCachedResourceObjectUrl, peekCachedResourceObjectUrl } from "@/services/resource-blob-cache";
import { resolveImageUrl } from "@/services/image-storage";
import { recordDiagnosticEvent } from "@/services/diagnostics/client-diagnostics";
import { getActiveUserScopeEpoch, subscribeUserScope } from "@/lib/user-scope";
import { useGenerationDeliveryProgress } from "@/stores/use-generation-delivery-progress";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { useCanvasNodeActions } from "./canvas-node-action-context";
import { CanvasFileUploadContent } from "./canvas-file-upload-content";

export type CanvasNodeContentProps = {
    node: CanvasNodeData;
    theme: CanvasTheme;
    isEditingContent: boolean;
    textareaRef: RefObject<HTMLTextAreaElement | null>;
    isBatchRoot: boolean;
    batchCount: number;
    batchPreviewNodes?: CanvasNodeData[];
    batchExpanded: boolean;
    batchOpening: boolean;
    batchRecovering: boolean;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    onContentChange: (nodeId: string, content: string) => void;
    onStopEditing: () => void;
    mentionReferences: CanvasResourceReference[];
    onRetry?: (node: CanvasNodeData) => void;
    onReloadResource?: (node: CanvasNodeData) => void;
    onOpenTaskDetails?: (node: CanvasNodeData) => void;
    onCancelTask?: (node: CanvasNodeData) => void;
    onToggleBatch?: () => void;
    reduceMediaEffects?: boolean;
    scale?: number;
};

export function CanvasNodeContent(props: CanvasNodeContentProps) {
    if (props.node.metadata?.fileUpload) return <CanvasFileUploadContent node={props.node} theme={props.theme} reduceMotion={props.reduceMediaEffects} />;
    if (props.node.type === CanvasNodeType.Config && props.renderNodeContent) return props.renderNodeContent(props.node);
    if (props.isBatchRoot) return <ImageNodeContent {...props} />;
    if (props.node.metadata?.status === "loading") return <LoadingContent node={props.node} theme={props.theme} onOpenTaskDetails={props.onOpenTaskDetails} onCancelTask={props.onCancelTask} />;
    if (props.node.metadata?.status === "error") return <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} onReloadResource={props.onReloadResource} onOpenTaskDetails={props.onOpenTaskDetails} />;

    const Renderer = nodeContentRenderers[props.node.type];
    if (Renderer) return <Renderer {...props} />;
    if (props.node.metadata?.pluginData) return <PluginDataContent node={props.node} theme={props.theme} />;
    return <UnknownNodeContent theme={props.theme} />;
}

const nodeContentRenderers: Partial<Record<string, (props: CanvasNodeContentProps) => ReactNode>> = {
    [CanvasNodeType.Text]: TextContent,
    [CanvasNodeType.Image]: ImageNodeContent,
    [CanvasNodeType.Config]: EmptyImageContent,
    [CanvasNodeType.Frame]: UnknownNodeContent,
};

function PluginDataContent({ node, theme }: Pick<CanvasNodeContentProps, "node" | "theme">) {
    const data = node.metadata?.pluginData || {};
    const fields = Object.keys(data);
    return <div className="flex h-full w-full flex-col gap-3 overflow-auto p-4 pt-10 text-xs" style={{ color: theme.node.text }}>
        {fields.length ? fields.map((field) => <div key={field} className="flex flex-col gap-1">
            <span className="font-medium opacity-60">{field}</span>
            <span className="whitespace-pre-wrap break-words opacity-90">{formatPluginValue(data[field])}</span>
        </div>) : <span className="whitespace-pre-wrap break-words">{node.metadata?.content || "插件节点"}</span>}
    </div>;
}

function formatPluginValue(value: unknown) {
    if (value === undefined || value === null || value === "") return "未设置";
    return typeof value === "string" ? value : JSON.stringify(value);
}

function LoadingContent({ node, theme, onOpenTaskDetails, onCancelTask }: Pick<CanvasNodeContentProps, "node" | "theme" | "onOpenTaskDetails" | "onCancelTask">) {
    const taskId = node.metadata?.taskId;
    // Visual/audit fixtures intentionally run without a backend task row. Keep
    // their loading affordances identical to a real running task while
    // leaving production nodes gated by the persisted task id.
    const hasTaskIdentity = Boolean(taskId) || node.metadata?.fixture === "libtv-generating";
    const displayTask = {
        provider: node.metadata?.taskProvider,
        status: (node.metadata?.taskStatus || "running") as GenerationTask["status"],
        stage: node.metadata?.taskStage,
        officialStatus: node.metadata?.taskOfficialStatus,
        errorCode: node.metadata?.taskErrorCode,
    };
    const submissionUncertain = Boolean(taskId) && isGenerationTaskSubmissionUncertain(displayTask);
    const showsProgress = Boolean(taskId) && generationTaskShowsProgress(displayTask);
    const progress = showsProgress && typeof node.metadata?.taskProgress === "number" ? Math.max(0, Math.min(100, Math.round(node.metadata.taskProgress))) : null;
    const now = useSecondTick(hasTaskIdentity);
    const createdAt = node.metadata?.taskCreatedAt;
    const createdAtMs = createdAt ? new Date(createdAt).getTime() : Number.NaN;
    const elapsed = Number.isFinite(createdAtMs) ? `已用 ${formatGenerationElapsed(now - createdAtMs)}` : "刚刚开始";
    const progressKey = taskId || node.id;
    const progressRecord = progress !== null ? rememberProgressChange(progressKey, progress, now) : undefined;
    const generationView = generationProgressDisplay({
        status: displayTask.status,
        progress,
        progressChangedAt: progressRecord?.changedAt,
        now,
    });
    const deliveryProgress = useGenerationDeliveryProgress((state) => (taskId ? state.byTask[taskId] : undefined));
    const delivery = deliveryProgress ? generationDeliveryProgressView(deliveryProgress) : null;
    const fetchingResult = generationTaskFetchingResult(displayTask, Boolean(deliveryProgress));
    const progressView = delivery
        ? { percent: delivery.percent, bar: delivery.percent !== null ? "determinate" as const : "indeterminate" as const }
        : fetchingResult && displayTask.status === "running" ? { percent: null, bar: "indeterminate" as const } : generationView;
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2.5 px-5 text-center" style={{ background: theme.node.fill, color: theme.node.activeStroke }}>
            {submissionUncertain ? <AlertCircle className="size-10" /> : <div className="size-10 animate-spin rounded-full border-2" style={{ borderColor: theme.node.stroke, borderTopColor: theme.node.activeStroke }} />}
            <span className="text-[var(--fs-tiny)] font-semibold">{delivery?.title || (fetchingResult ? "正在取回结果" : "生成中")}</span>
            {hasTaskIdentity ? (
                <div className="flex w-full max-w-[210px] flex-col items-center gap-1.5">
                    {fetchingResult ? null : (
                        <div className="max-w-full truncate text-sm font-semibold tabular-nums" style={{ color: theme.node.text }}>
                            <Clock3 className="mr-1 inline size-3.5 align-[-2px]" />{elapsed}
                        </div>
                    )}
                    {progressView.percent !== null ? <div className="max-w-full truncate text-[var(--fs-label)] font-medium" style={{ color: theme.node.text }}>{progressView.percent}%</div> : null}
                    {progressView.bar === "determinate" && progressView.percent !== null ? (
                        <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: theme.node.stroke }}>
                            <div className="h-full rounded-full transition-[width]" style={{ width: `${progressView.percent}%`, background: theme.node.activeStroke }} />
                        </div>
                    ) : null}
                    {progressView.bar === "indeterminate" ? (
                        <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: theme.node.stroke }} role="progressbar" aria-label={fetchingResult ? "正在取回结果" : "仍在生成"}>
                            <div className="canvas-node-progress-indeterminate h-full rounded-full" style={{ background: theme.node.activeStroke }} />
                        </div>
                    ) : null}
                    {delivery?.detail ? <div className="max-w-full truncate text-[var(--fs-tiny)] tabular-nums" style={{ color: theme.node.muted }}>{delivery.detail}</div> : null}
                    <div className="mt-0.5 flex items-center gap-1.5">
                        <button type="button" className="inline-flex h-7 items-center gap-1 rounded-[var(--r-sm)] px-2 text-[var(--fs-tiny)] font-medium transition-colors" style={{ background: theme.toolbar.itemHover, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onOpenTaskDetails?.(node); }}><FileText className="size-3" />详情</button>
                        {onCancelTask && (displayTask.status === "queued" || displayTask.status === "running" || displayTask.status === "succeeded") ? (
                            <button type="button" className="inline-flex h-7 items-center gap-1 rounded-[var(--r-sm)] px-2 text-[var(--fs-tiny)] font-medium transition-colors" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onCancelTask(node); }} aria-label={displayTask.status === "succeeded" ? "停止取回结果" : "取消生成任务"}>
                                <Square className="size-3" />{displayTask.status === "succeeded" ? "停止取回" : "取消"}
                            </button>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function useSecondTick(active: boolean) {
    const [, setTick] = useState(0);
    useEffect(() => {
        if (!active) return;
        const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
        return () => window.clearInterval(timer);
    }, [active]);
    return Date.now();
}

// 上游百分比最后一次变化的时间，按任务记在内存里。节点滚出视口再回来
// 重新挂载时不会把「久未变化」清零；上限防止长会话里无限增长。
const progressChangeByTask = new Map<string, GenerationProgressRecord>();
const PROGRESS_CHANGE_LIMIT = 200;

function rememberProgressChange(key: string, progress: number, now: number) {
    const previous = progressChangeByTask.get(key);
    const next = trackGenerationProgressChange(previous, progress, now);
    if (next !== previous) {
        progressChangeByTask.delete(key);
        progressChangeByTask.set(key, next);
        if (progressChangeByTask.size > PROGRESS_CHANGE_LIMIT) {
            const oldest = progressChangeByTask.keys().next().value;
            if (oldest !== undefined) progressChangeByTask.delete(oldest);
        }
    }
    return next;
}

function ErrorContent({ node, theme, onRetry, onReloadResource, onOpenTaskDetails }: Pick<CanvasNodeContentProps, "node" | "theme" | "onRetry" | "onReloadResource" | "onOpenTaskDetails">) {
    const explanation = explainGenerationError(
        { code: node.metadata?.generationErrorCode || node.metadata?.taskErrorCode, message: node.metadata?.errorDetails || node.metadata?.generationErrorSummary },
        { taskId: node.metadata?.taskId, model: node.metadata?.model, createdAt: node.metadata?.taskCreatedAt, stage: node.metadata?.taskStage },
    );
    const errorDisplayTask = {
        provider: node.metadata?.taskProvider,
        status: (node.metadata?.taskStatus || "failed") as GenerationTask["status"],
        stage: node.metadata?.taskStage,
        officialStatus: node.metadata?.taskOfficialStatus,
        errorCode: node.metadata?.taskErrorCode || node.metadata?.generationErrorCode,
    };
    const submissionUncertain = isGenerationTaskSubmissionUncertain(errorDisplayTask) || explanation.uncertain;
    return (
        <div
            data-canvas-no-zoom
            data-canvas-wheel-scroll
            className="canvas-node-error-content flex max-w-[260px] flex-col items-center gap-3 overflow-y-auto px-3 py-2 text-center"
            style={{
                boxSizing: "border-box",
                width: `min(260px, calc(${Math.max(1, node.width)}px * var(--canvas-live-scale, 1)))`,
                maxHeight: `calc(${Math.max(1, node.height)}px * var(--canvas-live-scale, 1))`,
                transform: "scale(var(--canvas-live-inverse-scale, 1))",
                transformOrigin: "center center",
            }}
        >
            <div className="w-full" style={{ color: submissionUncertain ? theme.node.text : theme.accent.danger }}>
                <GenerationFailureNotice
                    compact
                    explanation={explanation}
                    context={{ taskId: node.metadata?.taskId, model: node.metadata?.model, createdAt: node.metadata?.taskCreatedAt, stage: node.metadata?.taskStage, providerRequestId: node.metadata?.taskProviderRequestId, failureDiagnostics: node.metadata?.taskFailureDiagnostics, errorSummary: node.metadata?.generationErrorSummary, completedAt: node.metadata?.taskCompletedAt, updatedAt: node.metadata?.taskUpdatedAt }}
                    onOpenDetails={node.metadata?.taskId && onOpenTaskDetails ? () => onOpenTaskDetails(node) : undefined}
                    onRetry={(submissionUncertain || explanation.uncertain || explanation.category === "download_failed") ? undefined : onRetry ? () => onRetry(node) : undefined}
                    retryLabel={node.metadata?.isBatchRoot ? "重新生成失败项" : "重新生成"}
                />
            </div>
            {node.metadata?.resourceReloadAvailable ? (
                <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1.5 rounded-[var(--r-md)] px-3 text-xs font-medium transition-colors"
                    style={{ background: theme.accent.primary, color: theme.accent.onPrimary }}
                    onClick={(event) => { event.stopPropagation(); onReloadResource?.(node); }}
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    <Download className="size-3.5" />
                    继续取回
                </button>
            ) : null}
        </div>
    );
}

function UnknownNodeContent({ theme }: Pick<CanvasNodeContentProps, "theme">) {
    return <div className="flex h-full w-full items-center justify-center text-sm" style={{ color: theme.node.placeholder }}>未知节点</div>;
}

function TextContent({ node, theme, isEditingContent, textareaRef, mentionReferences, onContentChange, onStopEditing }: CanvasNodeContentProps) {
    const fontSize = node.metadata?.fontSize || 14;
    const textStyle = { fontSize: `${fontSize}px`, lineHeight: `${Math.round(fontSize * 1.65)}px`, color: theme.node.text, boxSizing: "border-box" } as CSSProperties;
    const richTextHTML = useMemo(() => canvasRichTextHTML(node.metadata?.richText), [node.metadata?.richText]);

    return (
        <div className="flex h-full w-full flex-col overflow-hidden pt-10">
            {isEditingContent ? (
                <CanvasResourceMentionTextarea
                    ref={textareaRef}
                    className="thin-scrollbar m-0 block h-full w-full resize-none appearance-none overflow-y-auto whitespace-pre-wrap break-words border-none bg-transparent px-4 pb-4 pt-0 font-mono outline-none select-text"
                    style={textStyle}
                    value={node.metadata?.content || ""}
                    references={mentionReferences}
                    highlightLabels={false}
                    onChange={(value) => onContentChange(node.id, value)}
                    onBlur={onStopEditing}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") onStopEditing();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                />
            ) : richTextHTML ? (
                <div
                    className="thin-scrollbar block h-full w-full select-text overflow-y-auto break-words bg-transparent px-4 pb-4 font-mono [&_a]:underline [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:opacity-70 [&_code]:rounded [&_code]:bg-black/6 [&_code]:px-1 dark:[&_code]:bg-white/8 [&_h1]:my-2 [&_h1]:text-[1.55em] [&_h1]:font-semibold [&_h2]:my-2 [&_h2]:text-[1.3em] [&_h2]:font-semibold [&_h3]:my-1.5 [&_h3]:text-[1.12em] [&_h3]:font-semibold [&_hr]:my-3 [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-black/90 [&_pre]:p-2 [&_pre]:text-white [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
                    style={textStyle}
                    onWheel={(event) => event.stopPropagation()}
                    dangerouslySetInnerHTML={{ __html: richTextHTML }}
                />
            ) : node.metadata?.content ? (
                <div className="thin-scrollbar block h-full w-full select-text overflow-y-auto whitespace-pre-wrap break-words bg-transparent px-4 pb-4 pt-0 font-mono" style={textStyle} onWheel={(event) => event.stopPropagation()}>
                    {node.metadata.content}
                </div>
            ) : <EmptyTextNodeContent theme={theme} />}
        </div>
    );
}

function EmptyTextNodeContent({ theme }: Pick<CanvasNodeContentProps, "theme">) {
    return (
        <div className="pointer-events-none flex h-full w-full flex-col overflow-hidden px-6 pb-4 pt-5" style={{ color: theme.node.text }} aria-hidden>
            <div className="flex flex-1 items-center justify-center">
                <div className="canvas-node-empty-text-mark flex flex-col items-center gap-1.5 opacity-30">
                    {[0, 1, 2, 3].map((line) => <span key={line} className="h-1 w-14 rounded-full" style={{ background: theme.node.text }} />)}
                </div>
            </div>
            <div className="canvas-node-text-footer border-t pt-2" style={{ borderColor: theme.node.stroke }} />
        </div>
    );
}

function ImageNodeContent(props: CanvasNodeContentProps) {
    if (!props.node.metadata?.content && props.isBatchRoot) {
        const content = props.node.metadata?.status === "loading"
            ? <LoadingContent node={props.node} theme={props.theme} />
            : props.node.metadata?.status === "error"
                ? <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} onReloadResource={props.onReloadResource} />
                : <EmptyImageContent {...props} isBatchRoot={false} />;
        return <BatchFrame batchPreviewNodes={props.batchPreviewNodes} batchCount={props.batchCount} batchExpanded={props.batchExpanded} batchOpening={props.batchOpening} batchRecovering={props.batchRecovering} theme={props.theme} onToggleBatch={props.onToggleBatch}>{content}</BatchFrame>;
    }
    if (!props.node.metadata?.content) return <EmptyImageContent {...props} />;
    return <ImageContent scale={props.scale} batchPreviewNodes={props.batchPreviewNodes} node={props.node} theme={props.theme} isBatchRoot={props.isBatchRoot} batchCount={props.batchCount} batchExpanded={props.batchExpanded} batchOpening={props.batchOpening} batchRecovering={props.batchRecovering} onToggleBatch={props.onToggleBatch} />;
}

function EmptyImageContent({ node, theme, isBatchRoot, batchCount, batchPreviewNodes, batchExpanded, batchOpening, batchRecovering, onToggleBatch }: CanvasNodeContentProps) {
    const content = (
        <div className="flex h-full w-full flex-col items-center justify-center overflow-hidden" style={{ color: theme.node.muted }}>
            <ImageIcon className="canvas-node-empty-image-mark size-14 opacity-30" strokeWidth={1.35} aria-hidden />
            {node.metadata?.prompt?.trim() ? (
                <div className="max-w-[80%] text-center">
                    <div className="line-clamp-3 text-[var(--fs-tiny)] opacity-50">{node.metadata.prompt}</div>
                </div>
            ) : null}
        </div>
    );
    if (isBatchRoot) return <BatchFrame batchPreviewNodes={batchPreviewNodes} batchCount={batchCount} batchExpanded={batchExpanded} batchOpening={batchOpening} batchRecovering={batchRecovering} theme={theme} onToggleBatch={onToggleBatch}>{content}</BatchFrame>;
    return content;
}

function ImageContent({ node, theme, scale = 1, isBatchRoot, batchCount, batchPreviewNodes, batchExpanded, batchOpening, batchRecovering, onToggleBatch }: Pick<CanvasNodeContentProps, "node" | "theme" | "scale" | "isBatchRoot" | "batchCount" | "batchPreviewNodes" | "batchExpanded" | "batchOpening" | "batchRecovering" | "onToggleBatch">) {
    const imageContainerRef = useRef<HTMLDivElement>(null);
    const nearViewport = useNearViewport(imageContainerRef);
    const { url, loading, error, retry, fail } = useNodeResourceUrl(node, nearViewport);
    const importedFromLibTV = node.metadata?.importSource?.provider === "libtv";
    const { updateMediaNode } = useCanvasNodeActions();
    const measuredSizeRef = useRef<{ width: number; height: number } | null>(null);
    const compactStatus = node.width * scale < 140 || node.height * scale < 80;

    /**
     * 让节点跟随图片真实比例。
     *
     * 上传接口的 width/height 是可选的（services/api/resources.ts），拿不到时节点会落到
     * 默认的横向比例，竖图就被放进一个宽盒子、两侧留黑。这里在图片解码后量真实尺寸并校正。
     *
     * 判据是「用户有没有手动定过尺寸」，**不是**「有没有量过尺寸」——后者会让所有已经
     * 存过 naturalWidth 的旧节点永远得不到修正（第一版就是这么写的，所以没生效）。
     * 手动拉过（manualSize）或自由比例（freeResize）的节点只补记尺寸、不动宽高。
     */
    const fitToImage = (element: HTMLImageElement) => {
        // LibTV 已提供原图尺寸和节点尺寸；960px 缩略图不能反向覆盖这些数据。
        if (importedFromLibTV) return;
        const naturalWidth = element.naturalWidth;
        const naturalHeight = element.naturalHeight;
        if (!naturalWidth || !naturalHeight) return;
        if (measuredSizeRef.current?.width === naturalWidth && measuredSizeRef.current.height === naturalHeight) return;
        measuredSizeRef.current = { width: naturalWidth, height: naturalHeight };
        updateMediaNode?.(node.id, (current) => {
            const metadata = current.metadata;
            const needsMetadata = metadata?.naturalWidth !== naturalWidth || metadata?.naturalHeight !== naturalHeight;
            if (current.metadata?.freeResize || current.metadata?.manualSize) {
                return needsMetadata ? { ...current, metadata: { ...metadata, naturalWidth, naturalHeight } } : current;
            }
            const size = fitNodeSize(naturalWidth, naturalHeight);
            const needsResize = Math.abs(size.width - current.width) >= 1 || Math.abs(size.height - current.height) >= 1;
            if (!needsMetadata && !needsResize) return current;
            return {
                ...current,
                ...(needsResize ? size : {}),
                metadata: needsMetadata ? { ...metadata, naturalWidth, naturalHeight } : metadata,
            };
        });
    };

    return (
        <BatchFrame batchPreviewNodes={batchPreviewNodes} batchCount={isBatchRoot ? batchCount : 0} batchExpanded={batchExpanded} batchOpening={batchOpening} batchRecovering={batchRecovering} theme={theme} onToggleBatch={onToggleBatch}>
            <div ref={imageContainerRef} className="h-full w-full overflow-hidden rounded-[var(--node-radius)]">
                {error ? (
                    <div role="status" aria-label="图片加载失败" className="flex size-full items-center justify-center text-center text-xs" style={{ background: theme.node.fill, color: theme.node.text }}>
                        <div className="flex flex-col items-center gap-2" style={{ transform: "scale(var(--canvas-live-inverse-scale, 1))", transformOrigin: "center" }}>
                            {!compactStatus ? <span>图片加载失败</span> : null}
                            <button type="button" data-canvas-no-zoom aria-label="重新加载图片" title="重新加载图片" className={`inline-flex items-center justify-center gap-1.5 rounded border focus-visible:outline focus-visible:outline-2 ${compactStatus ? "size-7" : "px-3 py-1"}`} style={{ borderColor: theme.node.stroke, color: theme.node.text }} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); retry(); }}>
                                <RefreshCw className="size-4 shrink-0" aria-hidden />
                                {!compactStatus ? "重新加载" : null}
                            </button>
                        </div>
                    </div>
                ) : url ? <img src={url} alt={node.title} loading="lazy" decoding="async" draggable={false} onDragStart={(event) => event.preventDefault()} onError={fail} onLoad={(event) => fitToImage(event.currentTarget)} className={`pointer-events-none block h-full w-full select-none ${node.metadata?.freeResize ? "object-fill" : "object-contain"}`} /> : <div role="status" aria-label="正在加载图片" className="grid size-full place-items-center" style={{ background: theme.node.fill, color: theme.node.muted }}><span style={{ transform: "scale(var(--canvas-live-inverse-scale, 1))" }}>{loading ? <LoaderCircle className="size-5 animate-spin" /> : <ImageIcon className="size-5" />}</span></div>}
            </div>
        </BatchFrame>
    );
}

function useNodeResourceUrl(node: CanvasNodeData, eager: boolean) {
    const storageKey = node.metadata?.storageKey || "";
    const rawContent = node.metadata?.content || "";
    // `previewContent` is intentionally passive-only: thumbnail snapshots must
    // never be handed to interactive image operations as the playable asset.
    const fallback = node.metadata?.previewContent
        || (node.type === CanvasNodeType.Image && node.metadata?.importSource?.provider === "libtv" ? buildLibTVImagePreviewUrl(rawContent) : rawContent);
    const resourceId = resourceIdFromStorageKey(storageKey);
    const isRemoteResource = Boolean(resourceId);
    // 远程资源接口受登录/桌面令牌保护，原生 `<img>` 无法附带该令牌。
    // 重登后只能先通过 cacheResourceObjectUrl() 走鉴权下载，再挂载 Blob URL。
    const synchronousUrl = eager && isRemoteResource && node.type === CanvasNodeType.Image ? peekCachedResourceObjectUrl(storageKey) : "";
    // Inline data URLs are already local, but decoding thousands of them is
    // still expensive. Images must wait for the same viewport gate as remote
    // resources; otherwise DOM virtualization does not reduce image work.
    const isLazyVisual = node.type === CanvasNodeType.Image;
    const initialUrl = synchronousUrl || (isRemoteResource || isLazyVisual ? "" : fallback);
    const [url, setUrl] = useState(() => initialUrl);
    const [loading, setLoading] = useState(() => !initialUrl && isRemoteResource && eager);
    const [error, setError] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const reloadRequested = useRef(false);
    const [scopeEpoch, setScopeEpoch] = useState(getActiveUserScopeEpoch);
    useEffect(() => subscribeUserScope((epoch) => setScopeEpoch(epoch.generation)), []);
    const reportImageEvent = useCallback((code: "CANVAS_IMAGE_READ_FAILED" | "CANVAS_IMAGE_DECODE_FAILED" | "CANVAS_IMAGE_RELOAD") => {
        if (node.type !== CanvasNodeType.Image) return;
        const safeNodeId = /^[A-Za-z0-9._:-]{1,96}$/.test(node.id) ? node.id : "unknown";
        recordDiagnosticEvent({
            level: code === "CANVAS_IMAGE_RELOAD" ? "info" : "error",
            category: "runtime", code,
            message: `${code === "CANVAS_IMAGE_DECODE_FAILED" ? "画布图片解码失败" : code === "CANVAS_IMAGE_READ_FAILED" ? "画布图片读取失败" : "重新读取画布图片"} node=${safeNodeId}`,
            taskId: node.metadata?.taskId,
            route: resourceId && /^[A-Za-z0-9_-]{1,96}$/.test(resourceId) ? `/resources/${resourceId}/file` : undefined,
        });
    }, [node.id, node.type, node.metadata?.taskId, resourceId]);
    const fail = useCallback(() => { reportImageEvent("CANVAS_IMAGE_DECODE_FAILED"); setError(true); }, [reportImageEvent]);
    const retry = useCallback(() => { reportImageEvent("CANVAS_IMAGE_RELOAD"); reloadRequested.current = true; setError(false); setAttempt((current) => current + 1); }, [reportImageEvent]);

    useEffect(() => {
        let cancelled = false;
        setError(false);
        if (!isRemoteResource && isLazyVisual && storageKey) {
            if (!eager) {
                setUrl("");
                setLoading(false);
                return;
            }
            setLoading(true);
            void resolveImageUrl(storageKey, fallback)
                .then((resolved) => {
                    if (!cancelled) setUrl(resolved);
                })
                .catch(() => {
                    if (!cancelled) { setUrl(""); setError(true); reportImageEvent("CANVAS_IMAGE_READ_FAILED"); }
                })
                .finally(() => {
                    if (!cancelled) setLoading(false);
                });
            return () => { cancelled = true; };
        }
        if (!isRemoteResource) {
            setUrl(isLazyVisual && !eager ? "" : fallback);
            setLoading(false);
            return;
        }
        const reload = reloadRequested.current;
        reloadRequested.current = false;
        const cachedSync = reload ? "" : peekCachedResourceObjectUrl(storageKey);
        if (cachedSync) {
            setUrl(cachedSync);
            setLoading(false);
            return;
        }
        setUrl("");
        setLoading(eager);
        // 只有进入视口或被激活的节点才下载远程媒体；缓存层会复用已有 Blob URL 和 in-flight 请求。
        const resolve = eager ? cacheResourceObjectUrl(storageKey, reload) : getCachedResourceObjectUrl(storageKey);
        void resolve.then((cached) => {
            if (!cancelled && cached) setUrl(cached);
            if (!cancelled && eager && !cached) { setError(true); reportImageEvent("CANVAS_IMAGE_READ_FAILED"); }
            // Never hand a protected resource URL to a native <img> after a
            // cache miss. It cannot attach the auth header and would render
            // as a broken image after relogin.
        }).catch(() => {
            if (!cancelled && eager) { setUrl(synchronousUrl); setError(true); reportImageEvent("CANVAS_IMAGE_READ_FAILED"); }
        }).finally(() => {
            if (!cancelled) setLoading(false);
        });
        return () => { cancelled = true; };
    }, [eager, fallback, isLazyVisual, isRemoteResource, storageKey, attempt, scopeEpoch, reportImageEvent]);

    return { url, loading, error, retry, fail };
}

function useNearViewport(ref: RefObject<Element | null>) {
    const [nearViewport, setNearViewport] = useState(false);
    useEffect(() => {
        const element = ref.current;
        if (!element || typeof IntersectionObserver === "undefined") {
            setNearViewport(true);
            return;
        }
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                setNearViewport(true);
                observer.disconnect();
            }
        }, { rootMargin: "600px" });
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref]);
    return nearViewport;
}

export function CanvasNodeImageInfo({ node }: { node: CanvasNodeData }) {
    const width = Math.round(node.metadata?.naturalWidth || node.width);
    const height = Math.round(node.metadata?.naturalHeight || node.height);
    const size = formatBytes(node.metadata?.bytes || 0);
    return <span className="ml-auto max-w-full shrink-0 truncate rounded-[var(--r-sm)] bg-black/55 px-2 py-1 text-[var(--fs-label)] font-medium leading-none text-white backdrop-blur-sm">{width} x {height}{size ? ` · ${size}` : ""}</span>;
}

function BatchPreviewImage({ node }: { node: CanvasNodeData }) {
    const ref = useRef<HTMLDivElement>(null);
    const nearViewport = useNearViewport(ref);
    const { url } = useNodeResourceUrl(node, nearViewport);
    return <div ref={ref} className="h-full w-full overflow-hidden rounded-[inherit]">{url ? <img src={url} alt={`子图预览：${node.title}`} className="h-full w-full object-contain" draggable={false} /> : null}</div>;
}

function BatchFrame({ batchCount, batchPreviewNodes, batchExpanded, batchOpening, batchRecovering, theme, onToggleBatch, children }: { batchCount: number; batchPreviewNodes?: CanvasNodeData[]; batchExpanded: boolean; batchOpening: boolean; batchRecovering: boolean; theme: CanvasTheme; onToggleBatch?: () => void; children: ReactNode }) {
    const isBatchRoot = batchCount > 1;
    return (
        <div className="group/batch relative h-full w-full overflow-visible" onDoubleClick={isBatchRoot ? (event) => { event.stopPropagation(); onToggleBatch?.(); } : undefined}>
            {isBatchRoot ? (
                <div className="pointer-events-none absolute inset-0 overflow-visible">
                    {Array.from({ length: Math.min(batchCount - 1, 5) }).map((_, index) => (
                        <div
                            key={index}
                            className="absolute rounded-[var(--r-lg)] transition-all duration-300 group-hover/batch:translate-x-2"
                            style={{
                                inset: 0,
                                background: theme.node.panel,
                                boxShadow: `inset 0 0 0 1px ${theme.node.stroke}`,
                                opacity: batchExpanded && !batchOpening ? 0.34 : 1,
                                transform: batchOpening || batchRecovering ? `translate(${54 + index * 22}px, ${20 + index * 12}px) rotate(${8 + index * 5}deg) scale(.98)` : `translate(${34 + index * 18}px, ${14 + index * 10}px) rotate(${6 + index * 4}deg)`,
                                zIndex: -index - 1,
                            }}
                        >
                            {batchPreviewNodes?.[index] ? <BatchPreviewImage node={batchPreviewNodes[index]} /> : null}
                        </div>
                    ))}
                </div>
            ) : null}
            {children}
        </div>
    );
}
