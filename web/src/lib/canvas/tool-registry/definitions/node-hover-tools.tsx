import { Copy, Download, FolderPlus, Image as ImageIcon, Info, Lock, Maximize2, Minus, Plus, RefreshCw, Settings2, Trash2, Unlock, Upload } from "lucide-react";

import { explainGenerationError } from "@/lib/generation-error";
import { registerToolbarTools, type ToolContext, type ToolDefinition } from "@/lib/canvas/tool-registry";
import { canOpenCanvasNodePromptPanel } from "@/lib/canvas/canvas-node-semantics";
import { CanvasNodeType } from "@/types/canvas";

function isImage(ctx: ToolContext) { return ctx.node?.type === CanvasNodeType.Image; }
function isText(ctx: ToolContext) { return ctx.node?.type === CanvasNodeType.Text; }
function isConfig(ctx: ToolContext) { return ctx.node?.type === CanvasNodeType.Config; }
function hasImage(ctx: ToolContext) { return isImage(ctx) && Boolean(ctx.nodeMetadata?.content || ctx.nodeMetadata?.storageKey || ctx.nodeMetadata?.previewContent); }
function isImageBatchRoot(ctx: ToolContext) { return isImage(ctx) && Boolean(ctx.nodeMetadata?.isBatchRoot && ctx.nodeMetadata.batchChildIds?.length); }
function canRetry(ctx: ToolContext) {
    if (!isImage(ctx) || ctx.nodeMetadata?.fileUpload) return false;
    const explanation = explainGenerationError(
        { code: ctx.nodeMetadata?.generationErrorCode || ctx.nodeMetadata?.taskErrorCode, message: ctx.nodeMetadata?.errorDetails },
        { taskId: ctx.nodeMetadata?.taskId, model: ctx.nodeMetadata?.model, createdAt: ctx.nodeMetadata?.taskCreatedAt, stage: ctx.nodeMetadata?.taskStage },
    );
    const blocked = explanation.uncertain || explanation.category === "download_failed";
    const batchHasFailures = isImageBatchRoot(ctx) && (ctx.nodeMetadata?.batchFailedCount || (ctx.nodeMetadata?.status === "error" ? 1 : 0)) > 0;
    return (ctx.nodeMetadata?.status === "error" || (batchHasFailures && ctx.nodeMetadata?.status !== "loading")) && !blocked;
}

export const nodeHoverToolbarTools: ToolDefinition[] = [
    {
        id: "info", toolbar: "node-hover", category: "node-state", label: "查看节点信息", displayLabel: "节点信息", icon: <Info className="size-3.5" />,
        defaultVisible: true, defaultOrder: 10, nodeToolbar: { group: "more", order: 10, section: "节点管理" },
        run: (ctx) => ctx.handlers.onNodeInfo(ctx.node!),
    },
    {
        id: "duplicate", toolbar: "node-hover", category: "node-state", label: "创建副本", icon: <Copy className="size-3.5" />,
        defaultVisible: true, defaultOrder: 15, nodeToolbar: { group: "more", order: 20, section: "节点管理" },
        run: (ctx) => ctx.handlers.onNodeDuplicate(ctx.node!),
    },
    {
        id: "delete", toolbar: "node-hover", category: "danger", label: "移除节点", icon: <Trash2 className="size-3.5" />,
        defaultVisible: true, defaultOrder: 20, nodeToolbar: { group: "more", order: 1000, section: "危险操作" }, danger: true,
        run: (ctx) => ctx.handlers.onNodeDelete(ctx.node!),
    },
    {
        id: "retry", toolbar: "node-hover", category: "node-state", label: (ctx) => isImageBatchRoot(ctx) ? "重试批次中的失败图片" : "重新生成", displayLabel: (ctx) => isImageBatchRoot(ctx) ? "重试失败项" : "重试", icon: <RefreshCw className="size-3.5" />,
        defaultVisible: true, defaultOrder: 30, nodeToolbar: { group: "primary", order: 5 }, applicable: canRetry,
        run: (ctx) => ctx.handlers.onNodeRetry(ctx.node!),
    },
    {
        id: "saveAsset", toolbar: "node-hover", category: "resource", label: "保存到图片素材库", icon: <FolderPlus className="size-3.5" />,
        defaultVisible: true, defaultOrder: 50, nodeToolbar: { group: "more", order: 40, section: "素材" }, applicable: hasImage,
        run: (ctx) => ctx.handlers.onNodeSaveAsset(ctx.node!),
    },
    {
        id: "download", toolbar: "node-hover", category: "resource", label: "下载图片", displayLabel: "下载", icon: <Download className="size-3.5" />,
        defaultVisible: true, defaultOrder: 60, nodeToolbar: { group: "utility", order: 20 }, applicable: hasImage,
        run: (ctx) => ctx.handlers.onNodeDownload(ctx.node!),
    },
    {
        id: "edit", toolbar: "node-hover", category: "node-state", label: "生图设置", icon: <Settings2 className="size-3.5" />,
        defaultVisible: true, defaultOrder: 70, nodeToolbar: { group: "more", order: 30, section: "生成信息" },
        applicable: (ctx) => isImage(ctx) && canOpenCanvasNodePromptPanel(ctx.node),
        run: (ctx) => ctx.handlers.onNodeToggleDialog(ctx.node!),
    },
    {
        id: "editText", toolbar: "node-hover", category: "node-state", label: "编辑提示词", icon: <Maximize2 className="size-3.5" />,
        defaultVisible: true, defaultOrder: 80, nodeToolbar: { group: "primary", order: 20 }, applicable: isText,
        run: (ctx) => ctx.handlers.onNodeEditText(ctx.node!),
    },
    {
        id: "generateImage", toolbar: "node-hover", category: "create", label: "用提示词生图", displayLabel: "生图", icon: <ImageIcon className="size-3.5" />,
        defaultVisible: true, defaultOrder: 90, nodeToolbar: { group: "primary", order: 10 }, applicable: isText,
        disabled: (ctx) => !Boolean((ctx.nodeMetadata?.content || ctx.nodeMetadata?.prompt || "").trim()),
        run: (ctx) => ctx.handlers.onNodeGenerateImage(ctx.node!),
    },
    {
        id: "config", toolbar: "node-hover", category: "node-state", label: "生图配置", icon: <Settings2 className="size-3.5" />,
        defaultVisible: true, defaultOrder: 100, nodeToolbar: { group: "primary", order: 10 }, applicable: isConfig,
        run: (ctx) => ctx.handlers.onNodeToggleDialog(ctx.node!),
    },
    {
        id: "decreaseFont", toolbar: "node-hover", category: "appearance", label: "减小字号", icon: <Minus className="size-3.5" />,
        defaultVisible: true, defaultOrder: 110, nodeToolbar: { group: "process", order: 10 }, applicable: isText,
        run: (ctx) => ctx.handlers.onNodeDecreaseFont(ctx.node!),
    },
    {
        id: "increaseFont", toolbar: "node-hover", category: "appearance", label: "增大字号", icon: <Plus className="size-3.5" />,
        defaultVisible: true, defaultOrder: 120, nodeToolbar: { group: "process", order: 20 }, applicable: isText,
        run: (ctx) => ctx.handlers.onNodeIncreaseFont(ctx.node!),
    },
    {
        id: "uploadImage", toolbar: "node-hover", category: "resource", label: "上传图片", icon: <Upload className="size-3.5" />,
        defaultVisible: true, defaultOrder: 130, nodeToolbar: { group: "primary", order: 10 }, applicable: (ctx) => isImage(ctx) && !hasImage(ctx),
        run: (ctx) => ctx.handlers.onNodeUpload(ctx.node!),
    },
    {
        id: "node-lock", toolbar: "node-hover", category: "navigation", label: (ctx) => ctx.nodeMetadata?.locked ? "解锁节点" : "锁定位置和尺寸", displayLabel: "锁定位置与尺寸", icon: (ctx) => ctx.nodeMetadata?.locked ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />,
        defaultVisible: true, defaultOrder: 160, nodeToolbar: { group: "more", order: 900, section: "节点管理" }, active: (ctx) => Boolean(ctx.nodeMetadata?.locked),
        run: (ctx) => ctx.handlers.onNodeToggleLocked(ctx.node!),
    },
];

registerToolbarTools(nodeHoverToolbarTools);
