import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import type { CapturedUserScope } from "@/lib/user-scope-guard";
import { CanvasGenerationHistoryPicker } from "@/components/canvas/canvas-generation-history-picker";
import { CanvasNodeInfoModal } from "@/components/canvas/canvas-node-toolbar";
import { CanvasNodeSearchModal } from "@/components/canvas/canvas-node-search-modal";
import { CanvasTextEditorModal } from "@/components/canvas/canvas-text-editor-modal";
import { CanvasVersionCompareModal } from "@/components/canvas/canvas-version-compare-modal";
import { canvasThemes } from "@/lib/canvas-theme";
import type { GenerationTask, TaskLog } from "@/services/api/task-center";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

import { CanvasProjectMediaDialogs } from "./canvas-project-media-dialogs";
import { CanvasProjectStatusDialogs } from "./canvas-project-status-dialogs";

type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

export type CanvasProjectEditorDialogsProps = {
    projectId: string;
    theme: CanvasTheme;
    config: AiConfig;
    nodes: CanvasNodeData[];
    search: {
        open: boolean;
        onClose: () => void;
        onFocus: (nodeId: string) => void;
    };
    generationHistory: {
        open: boolean;
        onClose: () => void;
        onSelect: (task: GenerationTask) => void;
    };
    info: {
        node: CanvasNodeData | null;
        onClose: () => void;
        onMetadataChange: (nodeId: string, metadata: Partial<CanvasNodeMetadata>) => void;
    };
    text: {
        node: CanvasNodeData | null;
        onClose: () => void;
        onSave: (nodeId: string, title: string, content: string, richText: Record<string, unknown>) => void;
    };
    versionCompare: {
        open: boolean;
        versions: CanvasNodeData[];
        onClose: () => void;
        onSetPrimary: (nodeId: string) => void;
        onFocus: (nodeId: string) => void;
    };
    media: {
        upscaleNode: CanvasNodeData | null;
        onCloseUpscale: () => void;
        onUpscale: (node: CanvasNodeData, params: import("@/components/canvas/canvas-node-upscale-dialog").CanvasImageUpscaleParams) => void;
    };
    status: {
        task: GenerationTask | null;
        taskLogs: TaskLog[];
        taskLoading: boolean;
        taskError?: boolean;
        onCloseTask: () => void;
        onCancelTask?: (task: GenerationTask) => void;
        previewNode: CanvasNodeData | null;
        onClosePreview: () => void;
        clearConfirmOpen: boolean;
        onCancelClear: () => void;
        onConfirmClear: () => void;
    };
    assets: {
        pickerOpen: boolean;
        multiple: boolean;
        onInsertLibrary: (payloads: InsertAssetPayload[], expectedScope: CapturedUserScope) => void | Promise<void>;
        onClosePicker: () => void;
    };
};

export function CanvasProjectEditorDialogs({
    projectId,
    theme,
    config,
    nodes,
    search,
    generationHistory,
    info,
    text,
    versionCompare,
    media,
    status,
    assets,
}: CanvasProjectEditorDialogsProps) {
    return (
        <>
            <CanvasNodeSearchModal open={search.open} nodes={nodes} onClose={search.onClose} onFocus={search.onFocus} />
            <CanvasGenerationHistoryPicker projectId={projectId} open={generationHistory.open} onClose={generationHistory.onClose} onSelect={generationHistory.onSelect} />
            <CanvasNodeInfoModal node={info.node} open={Boolean(info.node)} onClose={info.onClose} onMetadataChange={info.onMetadataChange} />
            <CanvasTextEditorModal node={text.node} open={Boolean(text.node)} onClose={text.onClose} onSave={text.onSave} />
            <CanvasVersionCompareModal open={versionCompare.open} versions={versionCompare.versions} onClose={versionCompare.onClose} onSetPrimary={versionCompare.onSetPrimary} onFocus={versionCompare.onFocus} />
            <CanvasProjectMediaDialogs upscaleNode={media.upscaleNode} onCloseUpscale={media.onCloseUpscale} onUpscale={media.onUpscale} config={config} />
            <CanvasProjectStatusDialogs
                theme={theme}
                task={status.task}
                taskLogs={status.taskLogs}
                taskLoading={status.taskLoading}
                taskError={status.taskError}
                onCloseTask={status.onCloseTask}
                onCancelTask={status.onCancelTask}
                previewNode={status.previewNode}
                onClosePreview={status.onClosePreview}
                clearConfirmOpen={status.clearConfirmOpen}
                onCancelClear={status.onCancelClear}
                onConfirmClear={status.onConfirmClear}
            />
            <AssetPickerModal open={assets.pickerOpen} multiple={assets.multiple} onInsert={assets.onInsertLibrary} onClose={assets.onClosePicker} />
        </>
    );
}
