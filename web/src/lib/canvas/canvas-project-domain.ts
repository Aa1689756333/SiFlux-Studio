import { NODE_DEFAULT_SIZE, getNodeSpec } from "@/constant/canvas";
import type { CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import type { NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import { isFrameNode } from "@/lib/canvas/canvas-frame";
import { nodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";
import { canvasNodeResourceId } from "@/lib/canvas/canvas-resource-id";
import { canvasNodeMentionToken, canvasResourceMentionToken, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { normalizeCanvasMediaNodeSemantics } from "@/lib/canvas/canvas-node-semantics";
import { batchReferenceHandleY } from "@/lib/canvas/canvas-batch-table";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata, type CanvasNodeTypeId, type ConnectionHandle, type Position } from "@/types/canvas";

export function createCanvasNode(type: CanvasNodeTypeId, position: Position, metadata?: CanvasNodeMetadata): CanvasNodeData {
    const builtinSpec = type in NODE_DEFAULT_SIZE ? getNodeSpec(type as CanvasNodeType) : undefined;
    const pluginDefinition = getNodeDefinition(type);
    const spec = builtinSpec || (pluginDefinition ? { width: pluginDefinition.defaultSize.width, height: pluginDefinition.defaultSize.height, title: pluginDefinition.defaultTitle, metadata: pluginDefinition.defaultMetadata } : undefined);
    if (!spec) throw new Error(`未注册的画布节点类型：${type}`);
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    return normalizeCanvasMediaNodeSemantics({
        id,
        type,
        title: spec.title,
        createdAt: now,
        updatedAt: now,
        position: {
            x: position.x - spec.width / 2,
            y: position.y - spec.height / 2,
        },
        width: spec.width,
        height: spec.height,
        metadata: { ...spec.metadata, ...metadata },
    });
}

// 模型切换时必须清理的节点级生成参数：这些参数属于旧模型的能力档位（分辨率/宽高比/质量等），
// 新模型不支持时若残留，会在 buildNodeConfig 的「节点优先、全局兜底」合并中反复叠加（issue #254）。
const NODE_MODEL_GENERATION_PARAMS: ReadonlyArray<keyof CanvasNodeMetadata> = [
    "size",
    "quality",
    "transparentBackground",
    "count",
];

export function applyNodeConfigPatch(node: CanvasNodeData, patch: Partial<CanvasNodeMetadata>) {
    const safePatch = patch || {};
    const nextPatch = resetGenerationParamsOnModelSwitch(node, safePatch);
    const next = { ...node, metadata: { ...node.metadata, ...nextPatch } };
    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
    const size = typeof safePatch.size === "string" && !node.metadata?.content ? nodeSizeFromRatio(safePatch.size, spec.width, spec.height) : null;
    return size && node.type === CanvasNodeType.Image ? { ...next, ...size, position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 } } : next;
}

// 切换模型（不同模型标识）时，节点级生成参数必须随旧模型一起失效，回落全局配置；
// 显式传入的同批 patch（如用户同时调整了参数）仍然优先。
function resetGenerationParamsOnModelSwitch(node: CanvasNodeData, patch: Partial<CanvasNodeMetadata>): Partial<CanvasNodeMetadata> {
    if (typeof patch.model !== "string" || patch.model === node.metadata?.model) {
        return patch;
    }
    const reset: Partial<CanvasNodeMetadata> = {};
    for (const key of NODE_MODEL_GENERATION_PARAMS) {
        reset[key] = undefined;
    }
    return { ...reset, ...patch };
}

/**
 * 连线落到目标节点上的吸附点。单端口一侧取边的正中——与 connectionHandleY 保持同一个
 * 口径，否则吸附点和实际画出来的线会对不上（这两处是同一规则的两份实现，改一处必错）。
 */
export function getConnectionTargetAnchor(node: CanvasNodeData, current: ConnectionHandle, handleId?: string) {
    return {
        x: current.handleType === "source" ? node.position.x : node.position.x + node.width,
        y: batchReferenceHandleY(node, handleId) ?? node.position.y + node.height / 2,
    };
}

export function normalizeConnection(firstNodeId: string, secondNodeId: string, nodes: CanvasNodeData[], firstHandleType: "source" | "target") {
    const first = nodes.find((node) => node.id === firstNodeId);
    const second = nodes.find((node) => node.id === secondNodeId);
    if (!first || !second || first.id === second.id) return null;
    if (isFrameNode(first) || isFrameNode(second)) return null;
    if (first.type === CanvasNodeType.Config && second.type === CanvasNodeType.Config) return null;
    if (second.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id };
    if (first.type === CanvasNodeType.Config && firstHandleType === "target") return { fromNodeId: second.id, toNodeId: first.id };
    if (first.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id };
    if (firstHandleType === "target") return { fromNodeId: second.id, toNodeId: first.id };
    return { fromNodeId: first.id, toNodeId: second.id };
}

export function expandStoryboardTextMentions(prompt: string, references: CanvasResourceReference[]) {
    let expanded = prompt;
    references.filter((reference) => reference.active && reference.kind === "text" && reference.text?.trim()).forEach((reference) => {
        const replacement = `【项目设定：${reference.title}】\n${reference.text!.trim()}`;
        for (const token of [canvasResourceMentionToken(reference), `@${reference.label}`, reference.nodeId ? canvasNodeMentionToken(reference.nodeId) : ""]) {
            if (!token) continue;
            if (expanded.includes(token)) expanded = expanded.split(token).join(replacement);
        }
    });
    return expanded;
}

export function getInputSummary(inputs: NodeGenerationInput[]) {
    return {
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: inputs.filter((input) => input.type === "image").length,
    };
}

export type NodeAlignmentContext = {
    movingBounds: { left: number; top: number; right: number; bottom: number };
    targets: Array<{ x: number[]; y: number[] }>;
};

export function createNodeAlignmentContext(nodes: CanvasNodeData[], initialPositions: Array<{ id: string; x: number; y: number }>): NodeAlignmentContext | null {
    const movingIds = new Set(initialPositions.map((item) => item.id));
    const initialById = new Map(initialPositions.map((item) => [item.id, item]));
    const movingNodes = nodes.filter((node) => movingIds.has(node.id));
    if (!movingNodes.length) return null;
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const left = Math.min(...movingNodes.map((node) => initialById.get(node.id)?.x ?? node.position.x));
    const top = Math.min(...movingNodes.map((node) => initialById.get(node.id)?.y ?? node.position.y));
    const right = Math.max(...movingNodes.map((node) => (initialById.get(node.id)?.x ?? node.position.x) + node.width));
    const bottom = Math.max(...movingNodes.map((node) => (initialById.get(node.id)?.y ?? node.position.y) + node.height));
    const targets = nodes.flatMap((node) => {
        if (movingIds.has(node.id)) return [];
        const batchRoot = node.metadata?.batchRootId ? nodeById.get(node.metadata.batchRootId) : null;
        if (batchRoot && !batchRoot.metadata?.imageBatchExpanded) return [];
        const parent = node.parentId ? nodeById.get(node.parentId) : null;
        if (parent && isFrameNode(parent) && parent.metadata?.frame?.collapsed) return [];
        return [{
            x: [node.position.x, node.position.x + node.width / 2, node.position.x + node.width],
            y: [node.position.y, node.position.y + node.height / 2, node.position.y + node.height],
        }];
    });
    return { movingBounds: { left, top, right, bottom }, targets };
}

export function calculateNodeAlignment(context: NodeAlignmentContext | null, rawOffset: Position, threshold: number) {
    if (!context) return { offset: rawOffset, guides: {} as { vertical?: number; horizontal?: number } };
    const { left, top, right, bottom } = context.movingBounds;
    const movingX = [left + rawOffset.x, (left + right) / 2 + rawOffset.x, right + rawOffset.x];
    const movingY = [top + rawOffset.y, (top + bottom) / 2 + rawOffset.y, bottom + rawOffset.y];
    let bestXDelta: number | undefined;
    let bestXGuide: number | undefined;
    let bestYDelta: number | undefined;
    let bestYGuide: number | undefined;
    context.targets.forEach(({ x: targetsX, y: targetsY }) => {
        movingX.forEach((value, anchorIndex) => {
            const target = targetsX[anchorIndex];
            const delta = target - value;
            if (Math.abs(delta) <= threshold && (bestXDelta === undefined || Math.abs(delta) < Math.abs(bestXDelta))) {
                bestXDelta = delta;
                bestXGuide = target;
            }
        });
        movingY.forEach((value, anchorIndex) => {
            const target = targetsY[anchorIndex];
            const delta = target - value;
            if (Math.abs(delta) <= threshold && (bestYDelta === undefined || Math.abs(delta) < Math.abs(bestYDelta))) {
                bestYDelta = delta;
                bestYGuide = target;
            }
        });
    });
    return {
        offset: { x: rawOffset.x + (bestXDelta || 0), y: rawOffset.y + (bestYDelta || 0) },
        guides: { vertical: bestXGuide, horizontal: bestYGuide },
    };
}

export function isHiddenBatchChild(node: CanvasNodeData, nodes: CanvasNodeData[], collapsingBatchIds?: Set<string>) {
    const rootId = node.metadata?.batchRootId;
    if (!rootId) return false;
    const root = nodes.find((item) => item.id === rootId);
    if (root && collapsingBatchIds?.has(rootId)) return false;
    return Boolean(root && !root.metadata?.imageBatchExpanded);
}

export function sameStringSet(left: Set<string>, right: Set<string>) {
    if (left.size !== right.size) return false;
    for (const value of left) if (!right.has(value)) return false;
    return true;
}

export function sameNodeSemanticData(left: CanvasNodeData, right: CanvasNodeData) {
    return left.id === right.id && left.type === right.type && left.title === right.title && left.parentId === right.parentId && left.width === right.width && left.height === right.height && left.metadata === right.metadata;
}

export function applyBatchPrimaryImage(root: CanvasNodeData, primary: CanvasNodeData): CanvasNodeData {
    // 主图是根节点对媒体的完整代理；可选字段也必须显式覆盖，避免残留上一张图的存储身份。
    const nextMetadata: NonNullable<CanvasNodeData["metadata"]> = {
        ...root.metadata,
        primaryImageId: primary.id,
        content: primary.metadata?.content,
        storageKey: primary.metadata?.storageKey,
        status: primary.metadata?.status,
        naturalWidth: primary.metadata?.naturalWidth,
        naturalHeight: primary.metadata?.naturalHeight,
        bytes: primary.metadata?.bytes,
        mimeType: primary.metadata?.mimeType,
        errorDetails: primary.metadata?.errorDetails,
        generationErrorCode: primary.metadata?.generationErrorCode,
        failedPromptFingerprint: primary.metadata?.failedPromptFingerprint,
        freeResize: primary.metadata?.freeResize,
    };
    const nextRoot: CanvasNodeData = {
        ...root,
        width: primary.width,
        height: primary.height,
        metadata: nextMetadata,
    };
    const primaryResourceId = canvasNodeResourceId(primary);
    const rootResourceId = canvasNodeResourceId(nextRoot);
    if (primary.metadata?.assetId && primaryResourceId && rootResourceId && primaryResourceId === rootResourceId) {
        nextMetadata.assetId = primary.metadata.assetId;
    } else {
        delete nextMetadata.assetId;
    }
    return nextRoot;
}

export function removeCanvasNodes(nodes: CanvasNodeData[], requestedIds: Set<string>) {
    const removedIds = new Set(requestedIds);
    nodes.forEach((node) => {
        if (requestedIds.has(node.id)) node.metadata?.batchChildIds?.forEach((childId) => removedIds.add(childId));
    });
    const remainingNodes = nodes.filter((node) => !removedIds.has(node.id));
    const nextNodes = remainingNodes.map((node) => {
        const detached = node.parentId && removedIds.has(node.parentId) ? { ...node, parentId: undefined } : node;
        const childIds = detached.metadata?.batchChildIds?.filter((childId) => !removedIds.has(childId));
        if (!detached.metadata?.isBatchRoot || childIds?.length === detached.metadata.batchChildIds?.length) return detached;
        const primaryImageId = childIds?.includes(detached.metadata.primaryImageId || "") ? detached.metadata.primaryImageId : childIds?.[0];
        const primaryNode = remainingNodes.find((item) => item.id === primaryImageId);
        const batchRoot = { ...detached, metadata: { ...detached.metadata, batchChildIds: childIds, primaryImageId } };
        return primaryNode ? applyBatchPrimaryImage(batchRoot, primaryNode) : batchRoot;
    });
    return { removedIds, nodes: nextNodes };
}

export function buildAngleLabel(params: CanvasImageAngleParams) {
    const horizontal = params.horizontalAngle === 0 ? "正面视角" : params.horizontalAngle > 0 ? `向右旋转 ${params.horizontalAngle} 度` : `向左旋转 ${Math.abs(params.horizontalAngle)} 度`;
    const pitch = params.pitchAngle === 0 ? "水平视角" : params.pitchAngle > 0 ? `俯视 ${params.pitchAngle} 度` : `仰视 ${Math.abs(params.pitchAngle)} 度`;
    return `AI 多角度：${horizontal}，${pitch}，镜头距离 ${params.cameraDistance.toFixed(1)}，${params.wideAngle ? "广角" : "标准"}镜头`;
}

export function buildAnglePrompt(params: CanvasImageAngleParams) {
    return `基于参考图重新生成同一主体的新视角，保持主体、颜色、材质和画面风格一致，不要只做透视变形。${buildAngleLabel(params)}。`;
}
