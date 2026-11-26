import { useCallback, useState } from "react";

export function useCanvasProjectDialogs() {
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [generationHistoryOpen, setGenerationHistoryOpen] = useState(false);
    const [nodeSearchOpen, setNodeSearchOpen] = useState(false);
    const [textEditorNodeId, setTextEditorNodeId] = useState<string | null>(null);
    const [infoNodeId, setInfoNodeId] = useState<string | null>(null);
    const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
    const [versionCompareRootId, setVersionCompareRootId] = useState<string | null>(null);

    const clearDeletedNodeIds = useCallback((removedIds: Set<string>) => {
        const clearDeletedId = (current: string | null) => (current && removedIds.has(current) ? null : current);
        setTextEditorNodeId(clearDeletedId);
        setInfoNodeId(clearDeletedId);
        setPreviewNodeId(clearDeletedId);
        setVersionCompareRootId(clearDeletedId);
    }, []);

    const resetForClearCanvas = useCallback(() => {
        setTextEditorNodeId(null);
        setInfoNodeId(null);
        setPreviewNodeId(null);
        setVersionCompareRootId(null);
        setClearConfirmOpen(false);
    }, []);

    return {
        clearConfirmOpen,
        setClearConfirmOpen,
        generationHistoryOpen,
        setGenerationHistoryOpen,
        nodeSearchOpen,
        setNodeSearchOpen,
        textEditorNodeId,
        setTextEditorNodeId,
        infoNodeId,
        setInfoNodeId,
        previewNodeId,
        setPreviewNodeId,
        versionCompareRootId,
        setVersionCompareRootId,
        clearDeletedNodeIds,
        resetForClearCanvas,
    };
}