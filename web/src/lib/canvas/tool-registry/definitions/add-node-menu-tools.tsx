import { Clock3, FolderOpen, Sparkles, UploadCloud } from "lucide-react";

import { getNodeIcon, getNodeLabel } from "@/lib/canvas/node-registry";
import { registerAddNodeMenuCommands, type AddNodeMenuCommand } from "@/lib/canvas/tool-registry";
import { CanvasNodeType } from "@/types/canvas";

function nodeCommand(type: CanvasNodeType, rest: Omit<AddNodeMenuCommand, "id" | "label" | "icon" | "section">): AddNodeMenuCommand {
    return { id: type, label: getNodeLabel(type), icon: getNodeIcon(type), section: "node", ...rest };
}

export const addNodeMenuCommands: AddNodeMenuCommand[] = [
    nodeCommand(CanvasNodeType.Image, { defaultOrder: 10, run: (ctx) => ctx.handlers.onAddImage() }),
    nodeCommand(CanvasNodeType.Text, { defaultOrder: 20, run: (ctx) => ctx.handlers.onAddText() }),
    nodeCommand(CanvasNodeType.Frame, { defaultOrder: 30, run: (ctx) => ctx.handlers.onAddFrame() }),
    { id: "upload", label: "上传图片", icon: <UploadCloud />, section: "resource", defaultOrder: 40, run: (ctx) => ctx.handlers.onUpload() },
    { id: "generation-history", label: "从生图历史选择", icon: <Clock3 />, section: "resource", defaultOrder: 50, run: (ctx) => ctx.handlers.onOpenGenerationHistory() },
    { id: "assets", label: "图片素材库", icon: <FolderOpen />, section: "resource", defaultOrder: 60, run: (ctx) => ctx.handlers.onOpenMyAssets() },
    { id: "ask-assistant", label: "Agent", icon: <Sparkles />, section: "resource", defaultOrder: 70, applicable: (ctx) => Boolean(ctx.handlers.onAskAssistant), run: (ctx) => ctx.handlers.onAskAssistant?.() },
];

registerAddNodeMenuCommands(addNodeMenuCommands);
