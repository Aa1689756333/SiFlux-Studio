import type { ReactNode } from "react";

import type { CanvasResourceKind } from "@/lib/canvas/canvas-resource-references";
import type { CanvasGenerationMode, CanvasNodeData, CanvasNodeMetadata, CanvasNodeType } from "@/types/canvas";

export type CanvasNodeInputKind = "image" | "text";

/** 节点名称、尺寸与输入能力的唯一来源。 */
export type CanvasNodeDefinition = {
    type: CanvasNodeType;
    label: string;
    listLabel?: string;
    icon: ReactNode;
    defaultTitle: string;
    defaultSize: { width: number; height: number };
    defaultMetadata?: CanvasNodeMetadata;
    minSize: { width: number; height: number };
    keepAspectRatio?: (node: CanvasNodeData) => boolean;
    showInCreateMenu: boolean;
    resourceKind?: (node: CanvasNodeData) => CanvasResourceKind | null;
    generationMode?: (node: CanvasNodeData) => CanvasGenerationMode | null;
    showOutputConnection?: boolean;
    acceptsInputKind?: CanvasNodeInputKind | CanvasNodeInputKind[];
    maxInputCount?: number;
    inputKind?: CanvasNodeInputKind;
};
