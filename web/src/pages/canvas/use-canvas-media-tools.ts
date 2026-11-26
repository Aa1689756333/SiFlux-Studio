import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";

import type { CanvasImageCropRect } from "@/components/canvas/canvas-node-crop-dialog";
import type { CanvasImageMaskEditPayload } from "@/components/canvas/canvas-node-mask-edit-dialog";
import type { CanvasImageSplitParams } from "@/components/canvas/canvas-node-split-dialog";
import type { CanvasImageUpscaleParams } from "@/components/canvas/canvas-node-upscale-dialog";
import type { CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import { buildLightingLabel, type CanvasImageLightingOptions } from "@/components/canvas/canvas-node-lighting-dialog";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { cropDataUrl, splitDataUrl, upscaleDataUrl } from "@/lib/canvas/canvas-image-data";
import { isValidGridSplit, layoutGridSplitCells } from "@/lib/canvas/canvas-grid-split";
import { imageMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { findAvailableGenerationGroupPosition, imageGenerationChildPosition, imageGenerationGroupSize } from "@/lib/canvas/canvas-generation-layout";
import { canvasGenerationPromptMetadata } from "@/lib/canvas/canvas-generation-submission";
import { cancelIncompleteImageBatch } from "@/lib/canvas/canvas-image-batch-retry";
import { buildAngleLabel, buildAnglePrompt, createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { resolveCanvasStyleExecution } from "@/lib/canvas/canvas-style-execution";
import {
    buildGenerationConfig,
    buildImageGenerationMetadata,
    nodeReferenceImage,
    isGenerationCanceled,
    runBackendCanvasGenerationTask,
} from "@/lib/canvas/canvas-project-generation";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { DEFAULT_PORTRAIT_TEXTURE_SETTINGS } from "@/lib/canvas/canvas-portrait-texture";
import { IMAGE_PROMPT_REVERSE } from "@/lib/prompts";
import { createPortraitTextureNode } from "@/lib/canvas/canvas-image-source";
import { mediaResultMetadata } from "@/lib/canvas/canvas-node-semantics";
import { persistOwnedCanvasMediaNodes } from "@/lib/canvas/canvas-media-persist";
import { generationErrorMessage } from "@/lib/generation-error";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { defaultImageParamsForModel } from "@/lib/model-selection";
import { navigateToSettings } from "@/lib/settings-navigation";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { ensureCanvasNodeAsset } from "@/services/project-asset-sync";
import { isLocalWorkspaceMode } from "@/services/workspace-mode";
import { syncLocalCanvasSnapshot } from "@/services/local-workspace-sync";
import { openLocalCanvasProjectFromBackend } from "@/services/local-workspace-repository";
import { http } from "@/services/api/request";
import { flushCanvasStorePersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import type { GenerationTask } from "@/services/api/task-center";
import { assertUserScope, captureUserScope, type CapturedUserScope } from "@/lib/user-scope-guard";
import { defaultConfig, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ContextMenuState } from "@/types/canvas";

function normalizeMaskEditQuality(quality: string | undefined, size: string | undefined) {
    const value = String(quality || "").trim().toLowerCase();
    if (value && value !== "auto" && value !== "any") return value;
    const match = String(size || "").trim().toLowerCase().match(/^(\d+)x(\d+)$/);
    if (!match) return quality || "auto";
    const pixels = Number(match[1]) * Number(match[2]);
    return pixels <= 2_000_000 ? "1k" : pixels <= 4_300_000 ? "2k" : pixels <= 8_294_400 ? "4k" : quality || "auto";
}

type UseCanvasMediaToolsOptions = {
    projectId: string;
    domainProjectId?: string;
    nodesRef: { current: CanvasNodeData[] };
    connectionsRef: { current: CanvasConnection[] };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
    setHoveredNodeId: Dispatch<SetStateAction<string | null>>;
    setToolbarNodeId: Dispatch<SetStateAction<string | null>>;
    setRunningNodeId: Dispatch<SetStateAction<string | null>>;
    startGenerationRequest: (targetNodeId: string, originNodeId: string, runningId?: string, controller?: AbortController) => AbortController;
    finishGenerationRequest: (targetNodeId: string, controller: AbortController) => void;
    bindGenerationTask: (targetNodeId: string, task: GenerationTask) => void;
};

const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;
const NODE_STATUS_IDLE = "idle" as const;

export function useCanvasMediaTools({
    projectId,
    domainProjectId,
    nodesRef,
    connectionsRef,
    setNodes,
    setConnections,
    setSelectedNodeIds,
    setSelectedConnectionId,
    setDialogNodeId,
    setContextMenu,
    setHoveredNodeId,
    setToolbarNodeId,
    setRunningNodeId,
    startGenerationRequest,
    finishGenerationRequest,
    bindGenerationTask,
}: UseCanvasMediaToolsOptions) {
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const [cropNodeId, setCropNodeId] = useState<string | null>(null);
    const [maskEditNodeId, setMaskEditNodeId] = useState<string | null>(null);
    const [upscaleNodeId, setUpscaleNodeId] = useState<string | null>(null);
    const [annotationNodeId, setAnnotationNodeId] = useState<string | null>(null);
    const [angleNodeId, setAngleNodeId] = useState<string | null>(null);
    const [lightingNodeId, setLightingNodeId] = useState<string | null>(null);

    const resolveImageEditStyle = useCallback((node: CanvasNodeData, prompt: string, config: AiConfig) => {
        try {
            const runtime = resolveCanvasStyleExecution(nodesRef.current, node, prompt, config, "image");
            return {
                prompt: runtime?.prompt || prompt,
                metadata: runtime ? { styleProfileJson: runtime.profileJson, styleExecutionPlan: runtime.plan } : {},
            };
        } catch (error) {
            message.error(generationErrorMessage(error));
            return null;
        }
    }, [message, nodesRef]);

    const persistMediaNodes = useCallback(async (
        mediaNodes: CanvasNodeData[],
        mediaConnections: CanvasConnection[] = [],
        options?: { expectedScope?: CapturedUserScope; signal?: AbortSignal },
    ) => {
        return persistOwnedCanvasMediaNodes({
            canvasId: projectId,
            domainProjectId,
            mediaNodes,
            mediaConnections,
            expectedScope: options?.expectedScope ?? captureUserScope(),
            signal: options?.signal,
        }, {
            ensureCanvasNodeAsset,
            getStoredProject: (canvasId) => {
                const project = useCanvasStore.getState().projects.find((item) => item.id === canvasId);
                return project ? { nodes: project.nodes, connections: project.connections } : undefined;
            },
            hasProject: (canvasId) => useCanvasStore.getState().projects.some((item) => item.id === canvasId),
            openProject: (id, expectedScope) => openLocalCanvasProjectFromBackend(id, expectedScope),
            updateProject: (canvasId, patch) => useCanvasStore.getState().updateProject(canvasId, patch),
            flushPersistence: async (expectedScope) => {
                assertUserScope(expectedScope);
                await flushCanvasStorePersistence();
            },
            syncSnapshot: (id, patch, expectedScope) => syncLocalCanvasSnapshot(id, patch, expectedScope),
            readSavedProject: async (canvasId, expectedScope) => {
                const { project } = await http.get<{ project: { nodes: CanvasNodeData[] } }>(
                    `/canvas-projects/${encodeURIComponent(canvasId)}`,
                    { expectedScope, signal: options?.signal },
                );
                return project;
            },
            setNodes,
            getLiveProjectId: () => projectId,
            getLiveNodes: () => nodesRef.current,
            getLiveConnections: () => connectionsRef.current,
            isLocalWorkspace: isLocalWorkspaceMode,
            warn: (text) => { message.warning(text); },
            error: (text) => { message.error(text); },
        });
    }, [connectionsRef, domainProjectId, message, nodesRef, projectId, setNodes]);

    const createImageReversePromptNodes = useCallback((node: CanvasNodeData) => {
        if (node.type !== CanvasNodeType.Image || !node.metadata?.content) {
            message.warning("图片节点为空，无法反推提示词");
            return;
        }
        const gap = 96;
        const textSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
        const resultSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
        const centerY = node.position.y + node.height / 2;
        const textNode = {
            ...createCanvasNode(CanvasNodeType.Text, { x: node.position.x + node.width + gap + textSpec.width / 2, y: centerY }, { content: IMAGE_PROMPT_REVERSE, prompt: IMAGE_PROMPT_REVERSE, status: NODE_STATUS_SUCCESS, fontSize: 14 }),
            title: "反推提示词",
        };
        const resultNode = {
            ...createCanvasNode(CanvasNodeType.Text, { x: textNode.position.x + textNode.width + gap + resultSpec.width / 2, y: centerY }, {
                content: "",
                generationMode: "text",
                model: effectiveConfig.textModel || effectiveConfig.model || defaultConfig.textModel,
                count: 1,
                composerContent: "参考图片：@图片1\n任务说明：@文本1",
            }),
            title: "反推提示词结果",
        };
        setNodes((current) => [...current, textNode, resultNode]);
        setConnections((current) => [...current, { id: nanoid(), fromNodeId: node.id, toNodeId: resultNode.id }, { id: nanoid(), fromNodeId: textNode.id, toNodeId: resultNode.id }]);
        setSelectedNodeIds(new Set([resultNode.id]));
        setSelectedConnectionId(null);
        setDialogNodeId(resultNode.id);
        setContextMenu(null);
    }, [effectiveConfig.model, effectiveConfig.textModel, message, setConnections, setContextMenu, setDialogNodeId, setNodes, setSelectedConnectionId, setSelectedNodeIds]);

    const openPortraitTextureEditor = useCallback((node: CanvasNodeData) => {
        if (node.type !== CanvasNodeType.Image || !node.metadata?.content) {
            message.warning("图片节点为空，无法调节人物质感");
            return;
        }
        const portraitTextureSettings = { ...DEFAULT_PORTRAIT_TEXTURE_SETTINGS, ...node.metadata?.portraitTexture };
        const child = createPortraitTextureNode(node, nanoid());
        child.metadata = { ...child.metadata, portraitTexture: portraitTextureSettings };
        setHoveredNodeId(null);
        setToolbarNodeId(null);
        setNodes((current) => [...current, child]);
        setConnections((current) => [...current, { id: nanoid(), fromNodeId: node.id, toNodeId: child.id }]);
        setSelectedNodeIds(new Set([child.id]));
        setSelectedConnectionId(null);
        setDialogNodeId(child.id);
    }, [message, setConnections, setDialogNodeId, setHoveredNodeId, setNodes, setSelectedConnectionId, setSelectedNodeIds, setToolbarNodeId]);

    const cropImageNode = useCallback(async (node: CanvasNodeData, crop: CanvasImageCropRect) => {
        if (!node.metadata?.content) return;
        try {
            const source = await resolveImageUrl(node.metadata.storageKey, node.metadata.content, { cacheMiss: true });
            const cropped = await cropDataUrl(source, crop);
            const image = await uploadImage(cropped);
            const size = fitNodeSize(image.width, image.height, node.width, node.height);
            const childId = nanoid();
            const child: CanvasNodeData = { id: childId, type: CanvasNodeType.Image, title: `${node.title || "图片"} · 裁剪`, position: { x: node.position.x + node.width + 96, y: node.position.y }, width: size.width, height: size.height, metadata: mediaResultMetadata("derived", { ...imageMetadata(image), prompt: node.metadata?.prompt, generatedFromNodeId: node.id }) };
            const connection = { id: nanoid(), fromNodeId: node.id, toNodeId: childId };
            setNodes((current) => [...current, child]);
            setConnections((current) => [...current, connection]);
            setSelectedNodeIds(new Set([childId]));
            setDialogNodeId(childId);
            setCropNodeId(null);
            await persistMediaNodes([child], [connection]);
        } catch (error) {
            message.error(error instanceof Error ? `裁切失败：${error.message}` : "裁切失败，请重试");
        }
    }, [message, persistMediaNodes, setConnections, setDialogNodeId, setNodes, setSelectedNodeIds]);

    const saveAnnotatedImageNode = useCallback(async (node: CanvasNodeData, dataUrl: string) => {
        const image = await uploadImage(dataUrl);
        const size = fitNodeSize(image.width, image.height, node.width, node.height);
        const childId = nanoid();
        const child: CanvasNodeData = { id: childId, type: CanvasNodeType.Image, title: `${node.title || "图片"} · 标注`, position: { x: node.position.x + node.width + 96, y: node.position.y }, width: size.width, height: size.height, metadata: mediaResultMetadata("derived", { ...imageMetadata(image), prompt: node.metadata?.prompt, generatedFromNodeId: node.id }) };
        const connection = { id: nanoid(), fromNodeId: node.id, toNodeId: childId };
        setNodes((current) => [...current, child]);
        setConnections((current) => [...current, connection]);
        setSelectedNodeIds(new Set([childId]));
        setSelectedConnectionId(null);
        setDialogNodeId(null);
        setAnnotationNodeId(null);
        await persistMediaNodes([child], [connection]);
        message.success("标注图片已保存为新节点");
    }, [message, persistMediaNodes, setConnections, setDialogNodeId, setNodes, setSelectedConnectionId, setSelectedNodeIds]);

    const splitImageNode = useCallback(async (node: CanvasNodeData, params: CanvasImageSplitParams) => {
        if (!node.metadata?.content || !isValidGridSplit(params)) return;
        const source = await resolveImageUrl(node.metadata.storageKey, node.metadata.content, { cacheMiss: true });
        const pieces = await splitDataUrl(source, params);
        const sizedPieces = await Promise.all(pieces.map(async (piece) => {
            const image = await uploadImage(piece.dataUrl);
            return { piece, image, size: fitNodeSize(image.width, image.height) };
        }));
        const positions = layoutGridSplitCells(
            { x: node.position.x + node.width + 96, y: node.position.y },
            sizedPieces.map(({ piece, size }) => ({ row: piece.row, column: piece.column, width: size.width, height: size.height })),
        );
        const childNodes = sizedPieces.map(({ piece, image, size }, index) => ({
            id: nanoid(),
            type: CanvasNodeType.Image,
            title: `${node.title || "图片"} · 宫格 ${piece.row + 1}-${piece.column + 1}`,
            position: positions[index] || { x: node.position.x + node.width + 96, y: node.position.y },
            width: size.width,
            height: size.height,
            metadata: mediaResultMetadata("derived", { ...imageMetadata(image), prompt: node.metadata?.prompt, manualSize: true, generatedFromNodeId: node.id }),
        } satisfies CanvasNodeData));
        setNodes((current) => [...current, ...childNodes]);
        setConnections((current) => [...current, ...childNodes.map((child) => ({ id: nanoid(), fromNodeId: node.id, toNodeId: child.id }))]);
        setSelectedNodeIds(new Set(childNodes.map((child) => child.id)));
        setSelectedConnectionId(null);
        setDialogNodeId(null);
        await persistMediaNodes(childNodes);
        message.success(`已切分为 ${childNodes.length} 个子节点`);
    }, [message, persistMediaNodes, setConnections, setDialogNodeId, setNodes, setSelectedConnectionId, setSelectedNodeIds]);

    const maskEditImageNode = useCallback(async (node: CanvasNodeData, payload: CanvasImageMaskEditPayload) => {
        if (!node.metadata?.content) return;
        const baseGenerationConfig = buildGenerationConfig(effectiveConfig, node, "image");
        const selectedModel = payload.generationConfig?.model || payload.generationConfig?.imageModel || baseGenerationConfig.model;
        const modelDefaults = defaultImageParamsForModel(baseGenerationConfig, selectedModel);
        const selectedImageProfile = modelCapabilityConfigFor(baseGenerationConfig, selectedModel).image;
        if (!selectedImageProfile?.references.maskSupported) {
            message.error("当前图片模型不支持局部重绘蒙版，请选择支持蒙版编辑的模型");
            return;
        }
        const generationConfig = {
            ...baseGenerationConfig,
            ...payload.generationConfig,
            model: selectedModel,
            imageModel: payload.generationConfig?.imageModel || payload.generationConfig?.model || effectiveConfig.imageModel,
            quality: normalizeMaskEditQuality(payload.generationConfig?.quality || node.metadata?.quality || baseGenerationConfig.quality || modelDefaults.quality, payload.generationConfig?.size || node.metadata?.size || baseGenerationConfig.size || modelDefaults.size),
            count: String(payload.generationConfig?.count || 1),
            // 原图像素尺寸不是模型的输出尺寸合同；非高级设置时使用模型默认尺寸，避免把节点尺寸误发给上游。
            size: payload.generationConfig?.size || node.metadata?.size || modelDefaults.size,
        };
        if (!isAiConfigReady(generationConfig, generationConfig.model)) {
            navigateToSettings({ continueCreation: true });
            return;
        }
        const userPrompt = payload.prompt.trim();
        const prompt = `只修改蒙版透明区域，其他区域保持不变。${userPrompt}`;
        const source = nodeReferenceImage(node);
        if (!source) return;
        const styleExecution = resolveImageEditStyle(node, prompt, generationConfig);
        if (!styleExecution) return;
        const { prompt: effectivePrompt, metadata: styleMetadata } = styleExecution;
        const requestedCount = Math.max(1, Number(generationConfig.count) || 1);
        const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, requestedCount, [source]);
        setMaskEditNodeId(null);
        const rootId = nanoid();
        const childIds = requestedCount > 1 ? Array.from({ length: requestedCount }, () => nanoid()) : [];
        const targetIds = requestedCount > 1 ? childIds : [rootId];
        const imageSize = { width: node.width, height: node.height };
        const preferredPosition = { x: node.position.x + node.width + 96, y: node.position.y };
        const rootPosition = findAvailableGenerationGroupPosition(nodesRef.current, preferredPosition, imageGenerationGroupSize(imageSize, imageSize, childIds.length));
        const rootNode: CanvasNodeData = {
            id: rootId,
            type: CanvasNodeType.Image,
            title: userPrompt.slice(0, 32) || "局部编辑结果",
            position: rootPosition,
            width: node.width,
            height: node.height,
            metadata: {
                ...canvasGenerationPromptMetadata(userPrompt, effectivePrompt),
                status: NODE_STATUS_LOADING,
                isBatchRoot: requestedCount > 1,
                batchChildIds: requestedCount > 1 ? childIds : undefined,
                batchFailedCount: requestedCount > 1 ? 0 : undefined,
                imageBatchExpanded: requestedCount > 1 ? true : undefined,
                ...generationMetadata,
                ...styleMetadata,
            },
        };
        const childNodes: CanvasNodeData[] = childIds.map((id, index) => ({
            id,
            type: CanvasNodeType.Image,
            title: `${userPrompt.slice(0, 28) || "局部编辑结果"} · ${index + 1}`,
            position: imageGenerationChildPosition(rootNode.position, rootNode.width, imageSize, index),
            width: node.width,
            height: node.height,
            metadata: {
                ...canvasGenerationPromptMetadata(userPrompt, effectivePrompt),
                status: NODE_STATUS_LOADING,
                batchRootId: rootId,
                ...generationMetadata,
                ...styleMetadata,
            },
        }));
        setRunningNodeId(rootId);
        setNodes((current) => [...current, rootNode, ...childNodes]);
        setConnections((current) => [...current, { id: nanoid(), fromNodeId: node.id, toNodeId: rootId }, ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: rootId, toNodeId: childId }))]);
        setSelectedNodeIds(new Set([rootId, ...childIds]));
        setSelectedConnectionId(null);
        setDialogNodeId(rootId);
        const controller = startGenerationRequest(rootId, node.id, rootId);
        targetIds.forEach((targetId) => startGenerationRequest(targetId, node.id, rootId, controller));
        let hasSuccess = false;
        let failureCount = 0;
        let representativeError: string | undefined;
        try {
            await Promise.all(targetIds.map(async (targetId) => {
                try {
                    const result = await runBackendCanvasGenerationTask({
                        projectId,
                        nodeId: targetId,
                        mode: "image",
                        prompt: effectivePrompt,
                        config: { ...generationConfig, count: "1" },
                        referenceImages: [source],
                        mask: { id: `${node.id}-mask`, name: "mask.png", type: "image/png", dataUrl: payload.maskDataUrl },
                        signal: controller.signal,
                        metadata: { sourceNodeId: node.id, edit: "mask", ...styleMetadata },
                        onTaskCreated: (task) => bindGenerationTask(targetId, task),
                    });
                    const image = result.images?.find((item) => item?.dataUrl);
                    if (!image?.dataUrl) throw new Error("后端任务没有返回图片");
                    const uploaded = await uploadImage(image.dataUrl);
                    const size = fitNodeSize(uploaded.width, uploaded.height, node.width, node.height);
                    const currentNode = nodesRef.current.find((item) => item.id === targetId);
                    if (!currentNode) throw new Error("局部编辑节点已被删除");
                    const finalizedNode = { ...currentNode, width: size.width, height: size.height, metadata: { ...currentNode.metadata, ...imageMetadata(uploaded), prompt: effectivePrompt, ...generationMetadata } };
                    setNodes((current) => current.map((item) => {
                        if (item.id === targetId) return finalizedNode;
                        if (item.id !== rootId || requestedCount <= 1 || item.metadata?.primaryImageId) return item;
                        return { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), primaryImageId: targetId, status: NODE_STATUS_SUCCESS } };
                    }));
                    await persistMediaNodes([finalizedNode]);
                    hasSuccess = true;
                } catch (error) {
                    if (isGenerationCanceled(error)) return;
                    failureCount += 1;
                    const details = generationErrorMessage(error);
                    representativeError = details;
                    setNodes((current) => current.map((item) => (item.id === targetId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: details } } : item)));
                } finally {
                    finishGenerationRequest(targetId, controller);
                }
            }));
            if (controller.signal.aborted) {
                setNodes((current) => {
                    const cancelled = cancelIncompleteImageBatch(rootId, childIds, current, []);
                    if (cancelled.removedIds.length) {
                        const removed = new Set(cancelled.removedIds);
                        setConnections((connections) => connections.filter((connection) => !removed.has(connection.fromNodeId) && !removed.has(connection.toNodeId)));
                    }
                    return cancelled.nodes.map((item) => {
                        if (item.id !== rootId) return item;
                        if (item.metadata?.content) return item;
                        return { ...item, metadata: { ...item.metadata, status: NODE_STATUS_IDLE, errorDetails: undefined } };
                    });
                });
                return;
            }
            if (failureCount > 0) {
                message.error(hasSuccess ? "部分局部编辑失败" : representativeError || "局部编辑失败");
            }
            setNodes((current) => current.map((item) => {
                if (item.id !== rootId) return item;
                return {
                    ...item,
                    metadata: {
                        ...item.metadata,
                        status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR,
                        batchFailedCount: requestedCount > 1 ? failureCount : undefined,
                        ...(hasSuccess
                            ? { errorDetails: undefined }
                            : { errorDetails: representativeError || "局部编辑失败" }),
                    },
                };
            }));
        } finally {
            if (requestedCount > 1) finishGenerationRequest(rootId, controller);
            setRunningNodeId(null);
        }
    }, [bindGenerationTask, effectiveConfig, finishGenerationRequest, isAiConfigReady, message, nodesRef, persistMediaNodes, projectId, resolveImageEditStyle, setConnections, setDialogNodeId, setNodes, setRunningNodeId, setSelectedConnectionId, setSelectedNodeIds, startGenerationRequest]);

    const upscaleImageNode = useCallback(async (node: CanvasNodeData, params: CanvasImageUpscaleParams) => {
        if (!node.metadata?.content) return;
        setUpscaleNodeId(null);
        const source = await resolveImageUrl(node.metadata.storageKey, node.metadata.content, { cacheMiss: true });
        const upscaled = await upscaleDataUrl(source, params);
        const image = await uploadImage(upscaled);
        const size = fitNodeSize(image.width, image.height);
        const childId = nanoid();
        const child: CanvasNodeData = { id: childId, type: CanvasNodeType.Image, title: `${node.title || "图片"} · 放大`, position: { x: node.position.x + node.width + 96, y: node.position.y }, width: size.width, height: size.height, metadata: mediaResultMetadata("derived", { ...imageMetadata(image), prompt: node.metadata?.prompt, generatedFromNodeId: node.id }) };
        setNodes((current) => [...current, child]);
        setConnections((current) => [...current, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
        setSelectedNodeIds(new Set([childId]));
        setDialogNodeId(childId);
        await persistMediaNodes([child]);
    }, [persistMediaNodes, setConnections, setDialogNodeId, setNodes, setSelectedNodeIds]);

    const generateAngleNode = useCallback(async (node: CanvasNodeData, params: CanvasImageAngleParams) => {
        if (!node.metadata?.content) return;
        const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1" };
        if (!isAiConfigReady(generationConfig, generationConfig.model)) {
            navigateToSettings({ continueCreation: true });
            return;
        }
        const childId = nanoid();
        const imageSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
        const title = buildAngleLabel(params);
        const prompt = buildAnglePrompt(params);
        const source = nodeReferenceImage(node);
        if (!source) return;
        const styleExecution = resolveImageEditStyle(node, prompt, generationConfig);
        if (!styleExecution) return;
        const { prompt: effectivePrompt, metadata: styleMetadata } = styleExecution;
        const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [source]);
        setAngleNodeId(null);
        setRunningNodeId(childId);
        setNodes((current) => [...current, { id: childId, type: CanvasNodeType.Image, title, position: { x: node.position.x + node.width + 96, y: node.position.y }, width: imageSpec.width, height: imageSpec.height, metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, ...generationMetadata, ...styleMetadata } }]);
        setConnections((current) => [...current, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
        setSelectedNodeIds(new Set([childId]));
        setDialogNodeId(childId);
        const controller = startGenerationRequest(childId, node.id, childId);
        try {
            const result = await runBackendCanvasGenerationTask({ projectId, nodeId: childId, mode: "image", prompt: effectivePrompt, config: generationConfig, referenceImages: [source], signal: controller.signal, metadata: { sourceNodeId: node.id, edit: "angle", ...styleMetadata }, onTaskCreated: (task) => bindGenerationTask(childId, task) });
            const image = result.images?.[0];
            if (!image?.dataUrl) throw new Error("后端任务没有返回图片");
            const uploaded = await uploadImage(image.dataUrl);
            const size = fitNodeSize(uploaded.width, uploaded.height, imageSpec.width, imageSpec.height);
            const currentNode = nodesRef.current.find((item) => item.id === childId);
            if (!currentNode) throw new Error("视角生成节点已被删除");
            const finalizedNode = { ...currentNode, width: size.width, height: size.height, metadata: { ...currentNode.metadata, ...imageMetadata(uploaded), prompt: effectivePrompt, ...generationMetadata } };
            setNodes((current) => current.map((item) => item.id === childId ? finalizedNode : item));
            await persistMediaNodes([finalizedNode]);
        } catch (error) {
            if (isGenerationCanceled(error)) return;
            const details = generationErrorMessage(error);
            setNodes((current) => current.map((item) => item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: details } } : item));
        } finally {
            finishGenerationRequest(childId, controller);
            setRunningNodeId(null);
        }
    }, [bindGenerationTask, effectiveConfig, finishGenerationRequest, isAiConfigReady, nodesRef, persistMediaNodes, projectId, resolveImageEditStyle, setConnections, setDialogNodeId, setNodes, setRunningNodeId, setSelectedNodeIds, startGenerationRequest]);

    const generateLightingNode = useCallback((node: CanvasNodeData, options: CanvasImageLightingOptions, prompt: string) => {
        if (!node.metadata?.content) return;
        const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1" };
        const childId = nanoid();
        const imageSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
        const title = buildLightingLabel(options);
        const source = nodeReferenceImage(node);
        if (!source) return;
        const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [source]);
        setLightingNodeId(null);
        setNodes((current) => [...current, {
            id: childId,
            type: CanvasNodeType.Image,
            title,
            position: { x: node.position.x + node.width + 96, y: node.position.y },
            width: imageSpec.width,
            height: imageSpec.height,
            metadata: {
                prompt,
                status: NODE_STATUS_IDLE,
                generationMode: "image",
                ...generationMetadata,
            },
        }]);
        setConnections((current) => [...current, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
        setSelectedNodeIds(new Set([childId]));
        setSelectedConnectionId(null);
        setDialogNodeId(childId);
    }, [effectiveConfig, setConnections, setDialogNodeId, setLightingNodeId, setNodes, setSelectedConnectionId, setSelectedNodeIds]);

    return {
        angleNodeId,
        lightingNodeId,
        annotationNodeId,
        createImageReversePromptNodes,
        openPortraitTextureEditor,
        cropImageNode,
        cropNodeId,
        generateAngleNode,
        generateLightingNode,
        maskEditImageNode,
        maskEditNodeId,
        saveAnnotatedImageNode,
        setAngleNodeId,
        setLightingNodeId,
        setAnnotationNodeId,
        setCropNodeId,
        setMaskEditNodeId,
        setUpscaleNodeId,
        splitImageNode,
        upscaleImageNode,
        upscaleNodeId,
    };
}
