import type { MouseEvent, ReactNode } from "react";

import type { CanvasAlignmentMode } from "@/lib/canvas/canvas-layout";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasNodeData, CanvasNodeMetadata, CanvasNodeTypeId, CanvasToolMode, CanvasWorkspaceMode } from "@/types/canvas";

export type ToolbarId = "main" | "selection" | "node-hover" | "add-node-menu";
export type NodeToolbarGroup = "primary" | "process" | "utility" | "more";

export type ToolCategory = "navigation" | "history" | "create" | "appearance" | "selection" | "layout" | "arrange" | "danger" | "node-state" | "resource";

export type ToolbarHandlers = {
    onToolChange: (tool: CanvasToolMode) => void;
    onDeselect: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onClear: () => void;
    onAddText: () => void;
    onAddImage: () => void;
    onAddFrame: () => void;
    onUpload: () => void;
    onOpenMyAssets: () => void;
    onOpenGenerationHistory: () => void;
    onOpenShortcuts: () => void;
    onAskAssistant?: () => void;
    onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
    onShowImageInfoChange: (show: boolean) => void;
    onToggleAddPanel: (event: MouseEvent<HTMLElement>) => void;
    onToggleAppearancePanel: (event: MouseEvent<HTMLElement>) => void;
    onToggleSettingsPanel: () => void;
    onDeleteSelected: () => void;
    onDuplicateSelected: () => void;
    onAlign: (mode: CanvasAlignmentMode) => void;
    onArrange: (mode: "row" | "column" | "grid" | "flow") => void;
    onCreateReferenceGroup: () => void;
    onBatchConnect: () => void;
    onNodeInfo: (node: CanvasNodeData) => void;
    onNodeDelete: (node: CanvasNodeData) => void;
    onNodeDuplicate: (node: CanvasNodeData) => void;
    onNodeRetry: (node: CanvasNodeData) => void;
    onNodeEditText: (node: CanvasNodeData) => void;
    onNodeDecreaseFont: (node: CanvasNodeData) => void;
    onNodeIncreaseFont: (node: CanvasNodeData) => void;
    onNodeToggleDialog: (node: CanvasNodeData) => void;
    onNodeGenerateImage: (node: CanvasNodeData) => void;
    onNodeUpload: (node: CanvasNodeData) => void;
    onNodeDownload: (node: CanvasNodeData) => void;
    onNodeSaveAsset: (node: CanvasNodeData) => void;
    onNodeToggleLocked: (node: CanvasNodeData) => void;
};

export type ToolContext = {
    selectedCount: number;
    selectedNodeTypes: Set<CanvasNodeTypeId>;
    canvasTool: CanvasToolMode;
    workspaceMode: CanvasWorkspaceMode;
    isProjectLinked: boolean;
    canUndo: boolean;
    canRedo: boolean;
    node?: CanvasNodeData;
    nodeMetadata?: CanvasNodeMetadata;
    addPanelOpen: boolean;
    appearancePanelOpen: boolean;
    settingsPanelOpen: boolean;
    handlers: ToolbarHandlers;
};

export type AddNodeMenuContext = {
    workspaceMode: CanvasWorkspaceMode;
    isProjectLinked: boolean;
    handlers: Pick<ToolbarHandlers, "onAddText" | "onAddImage" | "onAddFrame" | "onUpload" | "onOpenMyAssets" | "onOpenGenerationHistory" | "onAskAssistant">;
};

export type ToolDefinition = {
    id: string;
    toolbar: ToolbarId;
    category: ToolCategory;
    label: string | ((ctx: ToolContext) => string);
    displayLabel?: string | ((ctx: ToolContext) => string);
    icon: ReactNode | ((ctx: ToolContext) => ReactNode);
    defaultVisible: boolean;
    defaultOrder: number;
    nodeToolbar?: {
        group: NodeToolbarGroup | ((ctx: ToolContext) => NodeToolbarGroup);
        order?: number | ((ctx: ToolContext) => number);
        section?: string;
        description?: string;
    };
    active?: (ctx: ToolContext) => boolean;
    disabled?: (ctx: ToolContext) => boolean;
    danger?: boolean;
    prominent?: boolean;
    expands?: boolean;
    switchGroup?: {
        value: (ctx: ToolContext) => string;
        options: Array<{ id: string; label: string; icon: ReactNode; value: string }>;
        onChange: (ctx: ToolContext, value: string) => void;
    };
    applicable?: (ctx: ToolContext) => boolean;
    run: (ctx: ToolContext, event?: MouseEvent<HTMLElement>) => void;
};

export type AddNodeMenuCommand = {
    id: string;
    label: string;
    icon: ReactNode;
    section: "node" | "resource";
    defaultOrder: number;
    applicable?: (ctx: AddNodeMenuContext) => boolean;
    run: (ctx: AddNodeMenuContext) => void;
};

export type ToolbarPrefs = {
    order: string[];
    hidden: string[];
};
