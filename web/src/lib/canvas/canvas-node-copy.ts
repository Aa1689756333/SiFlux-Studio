import { resetGenerationTaskMetadata } from "@/lib/canvas/canvas-project-generation";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

const COPY_TITLE_SUFFIX = /^(.*)_copy(\d+)$/i;

export function nextCopiedNodeTitle(sourceTitle: string, existingTitles: Iterable<string>) {
    const sourceMatch = sourceTitle.match(COPY_TITLE_SUFFIX);
    const baseTitle = (sourceMatch?.[1] || sourceTitle.replace(/ Copy$/i, "")).trim() || sourceTitle.trim() || "未命名节点";
    let maxCopyIndex = 0;
    for (const title of existingTitles) {
        const match = title.match(COPY_TITLE_SUFFIX);
        if (!match || match[1] !== baseTitle) continue;
        const copyIndex = Number(match[2]);
        if (Number.isSafeInteger(copyIndex)) maxCopyIndex = Math.max(maxCopyIndex, copyIndex);
    }
    return `${baseTitle}_copy${maxCopyIndex + 1}`;
}

function remapReferenceId(nodeId: string | undefined, idMap: ReadonlyMap<string, string>) {
    return nodeId ? idMap.get(nodeId) || nodeId : undefined;
}

function remapOwnedNodeId(nodeId: string | undefined, idMap: ReadonlyMap<string, string>) {
    return nodeId ? idMap.get(nodeId) : undefined;
}

// 副本只能继承内容和用户引用，运行中任务、批次及指向源生成结果的关系必须隔离。
export function isolateCopiedNodeMetadata(node: CanvasNodeData, idMap: ReadonlyMap<string, string>): CanvasNodeMetadata {
    const metadata = resetGenerationTaskMetadata(node.metadata, node.metadata?.content ? "success" : "idle");
    // 提交标记绑定原任务和节点；副本携带它会被普通保存当作未确认生成结果过滤。
    delete metadata.generationEffectKeys;
    delete metadata.generationBatches;
    delete metadata.batchRootId;
    delete metadata.batchChildIds;
    delete metadata.batchFailedCount;
    delete metadata.isBatchRoot;
    delete metadata.primaryImageId;
    delete metadata.imageBatchExpanded;
    delete metadata.batchUsesReferenceImages;
    delete metadata.versionOfNodeId;
    delete metadata.versionLabel;
    delete metadata.versionPrimary;

    metadata.copiedFromNodeId = node.id;
    if (node.type === CanvasNodeType.Image) {
        metadata.generationResultPlacement = "replace-node";
    }
    metadata.frame = node.metadata?.frame ? { ...node.metadata.frame } : undefined;
    metadata.referenceSetId = remapOwnedNodeId(node.metadata?.referenceSetId, idMap);
    metadata.referenceAssetNodeIds = node.metadata?.referenceAssetNodeIds
        ?.map((nodeId) => remapOwnedNodeId(nodeId, idMap))
        .filter((nodeId): nodeId is string => Boolean(nodeId));
    metadata.emotionEdit = node.metadata?.emotionEdit ? {
        ...node.metadata.emotionEdit,
        sourceNodeId: remapReferenceId(node.metadata.emotionEdit.sourceNodeId, idMap)!,
        faceBox: { ...node.metadata.emotionEdit.faceBox },
        editRegion: node.metadata.emotionEdit.editRegion ? { ...node.metadata.emotionEdit.editRegion } : undefined,
    } : undefined;
    return metadata;
}
