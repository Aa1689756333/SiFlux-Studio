import { Image as ImageIcon, PanelTop, Settings2, Type } from "lucide-react";

import { NODE_SPECS } from "@/constant/canvas";
import { MEDIA_NODE_MIN_SIZE } from "@/lib/canvas/canvas-node-size";
import { canOpenCanvasNodePromptPanel } from "@/lib/canvas/canvas-node-semantics";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

import type { CanvasNodeDefinition } from "../node-definition";
import { registerNodeDefinitions } from "../node-registry";

const DEFAULT_MIN_SIZE = { width: 220, height: 160 } as const;

const BUILTIN_NODE_TRAITS = {
    [CanvasNodeType.Image]: {
        label: "图片",
        icon: <ImageIcon />,
        minSize: MEDIA_NODE_MIN_SIZE,
        keepAspectRatio: (node: CanvasNodeData) => !node.metadata?.freeResize,
        showInCreateMenu: true,
        resourceKind: (node: CanvasNodeData) => (node.metadata?.content || node.metadata?.storageKey ? "image" : null),
        generationMode: (node: CanvasNodeData) => canOpenCanvasNodePromptPanel(node) ? "image" : null,
        inputKind: "image",
    },
    [CanvasNodeType.Text]: {
        label: "提示词",
        icon: <Type />,
        minSize: DEFAULT_MIN_SIZE,
        showInCreateMenu: true,
        resourceKind: (node: CanvasNodeData) => (node.metadata?.content || node.metadata?.prompt ? "text" : null),
        inputKind: "text",
    },
    [CanvasNodeType.Config]: {
        label: "生图配置",
        icon: <Settings2 />,
        minSize: DEFAULT_MIN_SIZE,
        showInCreateMenu: false,
        generationMode: () => "image",
        showOutputConnection: false,
    },
    [CanvasNodeType.Frame]: {
        label: "分组",
        listLabel: "分组",
        icon: <PanelTop />,
        minSize: DEFAULT_MIN_SIZE,
        showInCreateMenu: true,
        showOutputConnection: false,
    },
} satisfies Record<string, Omit<CanvasNodeDefinition, "type" | "defaultTitle" | "defaultSize" | "defaultMetadata">>;

export const BUILTIN_NODE_DEFINITIONS: CanvasNodeDefinition[] = (Object.keys(BUILTIN_NODE_TRAITS) as Array<keyof typeof BUILTIN_NODE_TRAITS>).map((type) => {
    const spec = NODE_SPECS[type];
    return {
        type,
        ...BUILTIN_NODE_TRAITS[type],
        defaultTitle: spec.title,
        defaultSize: { width: spec.width, height: spec.height },
        defaultMetadata: spec.metadata,
    };
});

registerNodeDefinitions(BUILTIN_NODE_DEFINITIONS);
