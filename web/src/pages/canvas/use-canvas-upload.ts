import { useCallback, useEffect, useRef, useState, type ChangeEvent, type Dispatch, type DragEvent, type SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { App } from "antd";

import { CANVAS_IMAGE_ASSET_DND_TYPE } from "@/components/canvas/canvas-asset-tray";
import type { InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { isLocalRuntimeMode } from "@/lib/runtime-mode";
import { assertUserScope, captureUserScope, isUserScopeAbandonedError, userScopeMatches, type CapturedUserScope } from "@/lib/user-scope-guard";
import { imageMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { mediaResultMetadata } from "@/lib/canvas/canvas-node-semantics";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { CANVAS_UPLOAD_ACCEPT, createFileUploadPlaceholder, uploadNodeType, uploadPercent } from "@/lib/canvas/canvas-file-upload";
import { canvasNodesMissingResourceAssetBinding } from "@/lib/canvas/canvas-node-asset";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import { isReferenceHTTPSLink } from "@/services/api/reference-link-replacement";
import { http } from "@/services/api/request";
import { uploadMediaFile } from "@/services/file-storage";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { ensureCanvasNodeAsset } from "@/services/project-asset-sync";
import { useAssetStore, type ImageAsset } from "@/stores/use-asset-store";
import { CanvasNodeType, type CanvasNodeData, type ContextMenuState, type Position } from "@/types/canvas";
import type { CanvasUploadStatus } from "./canvas-project-feedback";
import { runOwnedCanvasCreatedNodes, useCanvasOwnerLifetime } from "./canvas-owner-epoch";
import { createOwnedCanvasUploadGuard, persistOwnedCanvasUploadNode, shouldSuppressOwnedCanvasCallback } from "./canvas-upload-ownership";

type UseCanvasUploadOptions = {
    canvasId: string;
    domainProjectId?: string;
    nodesRef: { current: CanvasNodeData[] };
    selectedNodeIdsRef: { current: Set<string> };
    getCanvasCenter: () => Position;
    screenToCanvas: (clientX: number, clientY: number) => Position;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
};

export type StartCanvasUploadStatus = (title: string, detail: string, total?: number) => {
    update: (detail: string, step: number) => void;
    done: (detail?: string) => void;
    fail: (detail?: string) => void;
};

const NODE_STATUS_SUCCESS = "success" as const;
const BATCH_UPLOAD_COLUMNS = 3;
const BATCH_UPLOAD_COLUMN_GAP = 380;
const BATCH_UPLOAD_ROW_GAP = 300;

export function useCanvasUpload({
    canvasId,
    domainProjectId,
    nodesRef,
    selectedNodeIdsRef,
    getCanvasCenter,
    screenToCanvas,
    setNodes,
    setSelectedNodeIds,
    setSelectedConnectionId,
    setContextMenu,
    setDialogNodeId,
}: UseCanvasUploadOptions) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const canvasIdRef = useRef(canvasId);
    canvasIdRef.current = canvasId;
    const { lifetime, mountedRef } = useCanvasOwnerLifetime(canvasId);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const uploadTargetRef = useRef<{ nodeId?: string; referenceToNodeId?: string; position?: Position } | null>(null);
    const assetInsertPositionRef = useRef<Position | null>(null);
    const uploadStatusIdRef = useRef(0);
    const statusTimersRef = useRef<Set<number>>(new Set());
    const fileDragDepthRef = useRef(0);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [uploadModalOpen,setUploadModalOpen] = useState(false);
    const [uploadStatus, setUploadStatus] = useState<CanvasUploadStatus | null>(null);
    const [fileDropActive, setFileDropActive] = useState(false);

    useEffect(() => () => {
        statusTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    }, []);

    const startUploadStatus = useCallback<StartCanvasUploadStatus>((title, detail, total = 3) => {
        const id = (uploadStatusIdRef.current += 1);
        const guard = createOwnedCanvasUploadGuard({
            lifetime,
            canvasId,
            getLiveCanvasId: () => canvasIdRef.current,
            mounted: () => mountedRef.current,
        });
        if (guard.alive()) setUploadStatus({ id, title, detail, step: 1, total });
        const dismiss = (delay: number) => {
            const timer = window.setTimeout(() => {
                statusTimersRef.current.delete(timer);
                if (!guard.alive()) return;
                setUploadStatus((current) => (current?.id === id ? null : current));
            }, delay);
            statusTimersRef.current.add(timer);
        };
        return {
            update: (nextDetail: string, step: number) => {
                if (!guard.alive()) return;
                setUploadStatus((current) => (current?.id === id ? { ...current, detail: nextDetail, step: Math.min(Math.max(step, 1), total) } : current));
            },
            done: (nextDetail = "处理完成") => {
                if (!guard.alive()) return;
                setUploadStatus((current) => (current?.id === id ? { ...current, detail: nextDetail, step: total, done: true } : current));
                dismiss(850);
            },
            fail: (nextDetail = "处理失败") => {
                if (!guard.alive()) return;
                setUploadStatus((current) => (current?.id === id ? { ...current, detail: nextDetail, error: true } : current));
                dismiss(1800);
            },
        };
    }, [canvasId, lifetime, mountedRef]);

    const selectInsertedNode = useCallback((nodeId: string, dialog: "open" | "close" | "preserve") => {
        setSelectedNodeIds(new Set([nodeId]));
        setSelectedConnectionId(null);
        if (dialog !== "preserve") setDialogNodeId(dialog === "open" ? nodeId : null);
    }, [setDialogNodeId, setSelectedConnectionId, setSelectedNodeIds]);

    const persistMediaNode = useCallback(async (node: CanvasNodeData, expectedScope?: CapturedUserScope, signal?: AbortSignal) => {
        const guard = createOwnedCanvasUploadGuard({
            lifetime,
            canvasId,
            getLiveCanvasId: () => canvasIdRef.current,
            expectedScope,
            mounted: () => mountedRef.current,
        });
        const result = await persistOwnedCanvasUploadNode({
            owner: guard.owner,
            expectedScope: guard.expectedScope,
            getLiveCanvasId: () => canvasIdRef.current,
            getLiveLifetime: () => lifetime.current(),
            mounted: () => mountedRef.current,
            canvasId,
            domainProjectId,
            node,
            signal: signal ?? guard.signal,
        }, {
            ensureCanvasNodeAsset,
            nodesRef,
            setNodes,
            invalidateProject: domainProjectId
                ? async (projectId) => { await queryClient.invalidateQueries({ queryKey: ["project", projectId] }); }
                : undefined,
            warn: (text) => message.warning(text),
        });
        return result.confirmed;
    }, [canvasId, domainProjectId, lifetime, message, mountedRef, nodesRef, queryClient, setNodes]);

    const activeUploadsRef = useRef(new Set<string>());
    const createFileNode = useCallback(async (file: File, position: Position, replaceId?: string, expectedScope?: CapturedUserScope) => {
        const original = replaceId ? nodesRef.current.find((node) => node.id === replaceId) : undefined;
        if (replaceId && (!original || activeUploadsRef.current.has(replaceId))) return null;
        const id = replaceId || `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const guard = createOwnedCanvasUploadGuard({
            lifetime,
            canvasId,
            getLiveCanvasId: () => canvasIdRef.current,
            expectedScope,
            mounted: () => mountedRef.current,
        });
        activeUploadsRef.current.add(id);
        const progress = startUploadStatus(replaceId ? "替换文件" : "上传文件", "读取文件信息", domainProjectId ? 4 : 3);
        try {
            const placeholder = await createFileUploadPlaceholder(id, file, position);
            if (!guard.alive()) return null;
            const uploadPlaceholder = placeholder.type === CanvasNodeType.Image
                ? { ...placeholder, metadata: mediaResultMetadata("upload", placeholder.metadata) }
                : placeholder;
            const applyPlaceholder = (current: CanvasNodeData[]) => replaceId ? current.map((item) => item.id === id ? {
                ...item, width: uploadPlaceholder.width, height: uploadPlaceholder.height,
                metadata: mediaResultMetadata("upload", { ...item.metadata, fileUpload: "uploading", fileUploadProgress: undefined, status: undefined, size: undefined, errorDetails: undefined }),
            } : item) : [...current, uploadPlaceholder];
            nodesRef.current = applyPlaceholder(nodesRef.current);
            setNodes(applyPlaceholder);
            selectInsertedNode(id, "close");
            let lastPercent: number | undefined;
            const onProgress = (loaded: number, total: number) => {
                if (!guard.alive()) return;
                const percent = uploadPercent(loaded, total);
                if (percent === undefined || percent === lastPercent) return;
                lastPercent = percent;
                setNodes((current) => current.map((item) => item.id === id ? { ...item, metadata: { ...item.metadata, fileUploadProgress: percent } } : item));
                progress.update(percent === 100 ? "文件已传输，正在保存与处理" : `已上传 ${percent}%`, 2);
            };
            const localRuntime = isLocalRuntimeMode();
            progress.update(localRuntime ? "保存文件到本地资源目录" : "上传文件并同步资源", 2);
            let metadata: CanvasNodeData["metadata"];
            if (placeholder.type === CanvasNodeType.Image) {
                metadata = imageMetadata(await uploadImage(file, onProgress, guard.expectedScope));
            } else if (placeholder.type === CanvasNodeType.Text) {
                const content = await file.text();
                if (!guard.alive()) return null;
                const uploaded = await uploadMediaFile(file, "file", onProgress, guard.expectedScope);
                metadata = { content, prompt: content, storageKey: uploaded.storageKey, mimeType: uploaded.mimeType || file.type || "text/plain", bytes: uploaded.bytes, status: "success" };
            } else {
                const content = await file.text();
                if (!guard.alive()) return null;
                const uploaded = await uploadMediaFile(file, "file", onProgress, guard.expectedScope);
                metadata = { content, prompt: content, storageKey: uploaded.storageKey, mimeType: uploaded.mimeType || file.type || "text/plain", bytes: uploaded.bytes, status: "success" };
            }
            if (!guard.alive()) return null;
            progress.update("更新画布节点", 3);
            const currentNode = nodesRef.current.find((item) => item.id === id);
            if (!currentNode) {
                progress.done("上传完成，画布占位已移除");
                return null;
            }
            const node: CanvasNodeData = {
                ...currentNode, type: placeholder.type,
                metadata: mediaResultMetadata("upload", {
                    ...currentNode.metadata, ...metadata,
                    fileUpload: undefined, fileUploadProgress: undefined, errorDetails: undefined,
                    ...(replaceId ? {
                        assetId: undefined, taskId: undefined, freeResize: false,
                        isBatchRoot: undefined, batchRootId: undefined, batchChildIds: undefined,
                        batchFailedCount: undefined, batchUsesReferenceImages: undefined,
                        generationType: undefined, generationResultPlacement: undefined,
                        copiedFromNodeId: undefined, versionOfNodeId: undefined,
                        model: undefined, size: undefined, quality: undefined,
                        transparentBackground: undefined, count: undefined, references: undefined,
                        primaryImageId: undefined, imageBatchExpanded: undefined,
                        richText: undefined, composerContent: undefined,
                    } : {}),
                }),
            };
            const applyUploadedNode = (current: CanvasNodeData[]) => current.map((item) => item.id === id ? { ...item, type: node.type, width: node.width, height: node.height, position: node.position, metadata: node.metadata } : item);
            nodesRef.current = applyUploadedNode(nodesRef.current);
            setNodes(applyUploadedNode);
            if (domainProjectId) progress.update("写入项目资产", 4);
            const persisted = await persistMediaNode(node, guard.expectedScope, guard.signal);
            if (!guard.alive()) return null;
            const browserFallback = Boolean(metadata.storageKey && !resourceIdFromStorageKey(metadata.storageKey));
            // Keep the mode decision from the start of this upload. Runtime
            // hydration can finish while the file is being processed; reading
            // the global mode again here could produce contradictory local and
            // remote messages for one upload.
            const localOnly = browserFallback && localRuntime;
            const remotePending = browserFallback && !localRuntime;
            progress.done(localOnly ? "已保存在本机" : remotePending ? "已保存在本机，等待远端同步" : persisted ? "文件已添加到画布" : "文件已添加，项目资产待重试");
            if (remotePending) message.warning("已保存在本机缓存，资源服务暂不可用；等待远端同步");
            return id;
        } catch (error) {
            if (shouldSuppressOwnedCanvasCallback(error, {
                owner: guard.owner,
                liveCanvasId: canvasIdRef.current,
                expectedScope: guard.expectedScope,
                liveLifetime: lifetime.current(),
                mounted: mountedRef.current,
                signal: guard.signal,
            })) return null;
            const details = error instanceof Error ? error.message : "文件上传失败";
            setNodes((current) => current.map((item) => item.id !== id ? item : original?.metadata?.content ? {
                ...item, width: original.width, height: original.height, metadata: original.metadata,
            } : { ...item, metadata: { ...item.metadata, fileUpload: "error", fileUploadProgress: undefined, errorDetails: details } }));
            progress.fail(details);
            message.error(details);
            return null;
        } finally {
            activeUploadsRef.current.delete(id);
        }
    }, [canvasId, domainProjectId, lifetime, message, mountedRef, nodesRef, persistMediaNode, selectInsertedNode, setNodes, startUploadStatus]);

    const createImageAssetNode = useCallback(async (asset: ImageAsset, position?: Position, expectedScope?: CapturedUserScope) => {
        const guard = createOwnedCanvasUploadGuard({
            lifetime,
            canvasId,
            getLiveCanvasId: () => canvasIdRef.current,
            expectedScope,
            mounted: () => mountedRef.current,
        });
        try {
            let storageKey = asset.data.storageKey;
            let content = storageKey ? await resolveImageUrl(storageKey, asset.data.dataUrl || asset.coverUrl) : asset.data.dataUrl || asset.coverUrl;
            if (!guard.alive()) return;
            if (!content) {
                message.error("素材图片不可用");
                return;
            }
            // Legacy browser assets can still contain data URLs. They are fine
            // for previewing, but the desktop canvas contract rejects inline
            // media so documents stay small and resource cleanup can track
            // references. Promote the bytes before inserting the node.
            if (content.startsWith("data:image/") || !resourceIdFromStorageKey(storageKey || "")) {
                const uploaded = await uploadImage(content, undefined, guard.expectedScope);
                if (!guard.alive()) return;
                content = uploaded.url;
                storageKey = uploaded.storageKey;
            }
            // Canvas persistence intentionally requires an Asset -> Resource
            // pair. Keep that invariant by migrating the legacy library record
            // before the node that references it can be auto-saved.
            if (resourceIdFromStorageKey(storageKey)) {
                await http.put(`/assets/${encodeURIComponent(asset.id)}`, {
                    asset: {
                        ...asset,
                        coverUrl: content,
                        data: { ...asset.data, dataUrl: content, storageKey },
                        updatedAt: new Date().toISOString(),
                    },
                }, { expectedScope: guard.expectedScope, signal: guard.signal });
                if (!guard.alive()) return;
            }
            const size = fitNodeSize(asset.data.width || NODE_DEFAULT_SIZE[CanvasNodeType.Image].width, asset.data.height || NODE_DEFAULT_SIZE[CanvasNodeType.Image].height);
            const center = position || getCanvasCenter();
            const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const node: CanvasNodeData = {
                id,
                type: CanvasNodeType.Image,
                title: asset.title || "素材图片",
                position: { x: center.x - size.width / 2, y: center.y - size.height / 2 },
                width: size.width,
                height: size.height,
                metadata: mediaResultMetadata("library", {
                    content,
                    storageKey,
                    status: NODE_STATUS_SUCCESS,
                    naturalWidth: asset.data.width,
                    naturalHeight: asset.data.height,
                    bytes: asset.data.bytes || getDataUrlByteSize(content.startsWith("data:") ? content : ""),
                    mimeType: asset.data.mimeType || "image/png",
                    prompt: typeof asset.metadata?.prompt === "string" ? asset.metadata.prompt : asset.title,
                    assetId: asset.id,
                    assetTags: asset.tags || [],
                }),
            };
            setNodes((current) => [...current, node]);
            selectInsertedNode(id, "close");
        } catch (error) {
            if (guard.suppress(error)) return;
            message.error(error instanceof Error ? error.message : "素材图片读取失败");
        }
    }, [canvasId, getCanvasCenter, lifetime, message, mountedRef, selectInsertedNode, setNodes]);

    const createTextNodeFromClipboard = useCallback((text: string, position?: Position) => {
        const trimmed = text.trim();
        if (!trimmed) return false;
        const node = {
            ...createCanvasNode(CanvasNodeType.Text, position || getCanvasCenter(), { content: trimmed, status: NODE_STATUS_SUCCESS }),
            title: trimmed.slice(0, 32) || "剪切板文本",
        };
        setNodes((current) => [...current, node]);
        selectInsertedNode(node.id, "open");
        setContextMenu(null);
        return true;
    }, [getCanvasCenter, selectInsertedNode, setContextMenu, setNodes]);

    const handleUploadRequest = useCallback((nodeId?: string, position?: Position) => {
        uploadTargetRef.current = { nodeId, position };
        const target = nodeId ? nodesRef.current.find((node) => node.id === nodeId) : null;
        if (imageInputRef.current) {
            imageInputRef.current.accept = target?.type === CanvasNodeType.Image
                ? "image/*"
                : target?.type === CanvasNodeType.Text ? "text/plain,text/markdown,.txt,.md,.markdown" : CANVAS_UPLOAD_ACCEPT;
            imageInputRef.current.multiple = !nodeId;
        }
        if(nodeId) imageInputRef.current?.click();
        else setUploadModalOpen(true);
    }, [nodesRef]);

    const handleUploadReferenceRequest = useCallback((targetNodeId: string, position: Position) => {
        uploadTargetRef.current = { referenceToNodeId: targetNodeId, position };
        if (imageInputRef.current) {
            imageInputRef.current.accept = "image/*";
            imageInputRef.current.multiple = true;
        }
        setUploadModalOpen(true);
    }, []);

    const handleUploadFiles = useCallback(async (files: File[]) => {
        const guard = createOwnedCanvasUploadGuard({
            lifetime,
            canvasId,
            getLiveCanvasId: () => canvasIdRef.current,
            mounted: () => mountedRef.current,
        });
        const current = () => guard.alive();
        const uploadTarget = uploadTargetRef.current;
        const supportedFiles = files.filter((file) => Boolean(uploadNodeType(file)));
        if (!supportedFiles.length) {
            message.warning("请选择图片或 TXT / Markdown 文件");
            return false;
        }
        const center = uploadTarget?.position || getCanvasCenter();
        const columns = Math.min(BATCH_UPLOAD_COLUMNS, supportedFiles.length);
        const originX = center.x - ((columns - 1) * BATCH_UPLOAD_COLUMN_GAP) / 2;
        const createdIds: string[] = [];
        for (let index = 0; index < supportedFiles.length; index += 1) {
            if (!current()) return false;
            const file = supportedFiles[index];
            const position = {
                x: originX + (index % columns) * BATCH_UPLOAD_COLUMN_GAP,
                y: center.y + Math.floor(index / columns) * BATCH_UPLOAD_ROW_GAP,
            };
            const createdId = await createFileNode(file, position, undefined, guard.expectedScope);
            if (!current()) return false;
            if (createdId) createdIds.push(createdId);
        }
        if (!createdIds.length || !current()) return false;
        setSelectedNodeIds(new Set(createdIds));
        setSelectedConnectionId(null);
        setDialogNodeId(null);
        const failedCount = supportedFiles.length - createdIds.length;
        if (uploadTarget?.referenceToNodeId) {
            message.success(`已添加 ${createdIds.length} 张参考图`);
        }
        else if (failedCount) message.warning(`已添加 ${createdIds.length} 个文件，${failedCount} 个上传失败`);
        else message.success(`已添加 ${createdIds.length} 个文件到画布`);
        return true;
    }, [canvasId, lifetime, createFileNode, getCanvasCenter, message, mountedRef, setDialogNodeId, setNodes, setSelectedConnectionId, setSelectedNodeIds]);

    const handleImportUrl = useCallback(async (url: string) => {
        if(!isReferenceHTTPSLink(url)) throw new Error("请填写不含账号密码的 HTTPS 图片网址");
        const target=uploadTargetRef.current;
        const type=CanvasNodeType.Image;
        const existing=target?.nodeId ? nodesRef.current.find(node=>node.id===target.nodeId) : undefined;
        if(existing && existing.type!==type) throw new Error("素材类型须与当前节点一致");
        const guard=createOwnedCanvasUploadGuard({lifetime,canvasId,getLiveCanvasId:()=>canvasIdRef.current,mounted:()=>mountedRef.current});
        const node=existing ? {...existing,metadata:{...existing.metadata,content:url,storageKey:undefined,assetId:undefined}} : createCanvasNode(type,target?.position || getCanvasCenter(),{content:url});
        if(!existing) node.title=new URL(url).pathname.split("/").pop() || "在线素材";
        if(!guard.alive()) return false;
        const applyImportedNode = (current: CanvasNodeData[]) => existing ? current.map(item=>item.id===node.id ? node : item) : [...current,node];
        nodesRef.current = applyImportedNode(nodesRef.current);
        setNodes(applyImportedNode);
        const persisted = await persistMediaNode(node,guard.expectedScope,guard.signal);
        if(!guard.alive()) return false;
        if (!persisted) {
            // Keep the local node visible for recovery, without claiming it was saved.
            selectInsertedNode(node.id,"close");
            return true;
        }
        selectInsertedNode(node.id,"close");
        message.success("已添加在线素材");
        return true;
    },[canvasId,getCanvasCenter,lifetime,message,mountedRef,nodesRef,persistMediaNode,selectInsertedNode,setNodes]);


    const replaceNodeMedia = useCallback(async (nodeId: string, file: File, expectedScope?: CapturedUserScope) => {
        const currentNode = nodesRef.current.find((node) => node.id === nodeId);
        if (!currentNode || !uploadNodeType(file)) return false;
        const typedNode = [CanvasNodeType.Image, CanvasNodeType.Text].includes(currentNode.type as CanvasNodeType);
        if (typedNode && uploadNodeType(file) !== currentNode.type) return false;
        return Boolean(await createFileNode(file, currentNode.position, nodeId, expectedScope));
    }, [createFileNode, nodesRef]);

    const pasteSystemClipboard = useCallback(async (position?: Position, clipboardEvent?: ClipboardEvent | null) => {
        const guard = createOwnedCanvasUploadGuard({
            lifetime,
            canvasId,
            getLiveCanvasId: () => canvasIdRef.current,
            mounted: () => mountedRef.current,
        });
        const isNodeMarker = (value: string) => {
            const trimmed = value.trim();
            return trimmed.startsWith("open-ai-canvas-nodes:") || trimmed.startsWith("open-ai-canvas-nodes-json:");
        };
        const pasteImageFile = async (file: File) => {
            if (!guard.alive()) return false;
            const selected = nodesRef.current.filter((node) => selectedNodeIdsRef.current.has(node.id));
            if (selected.length === 1 && selected[0].type === CanvasNodeType.Image) {
                if (await replaceNodeMedia(selected[0].id, file, guard.expectedScope) && guard.alive()) message.success("已用剪切板图片替换，可撤销恢复");
                return true;
            }
            const inserted = await createFileNode(file, position || getCanvasCenter(), undefined, guard.expectedScope);
            if (inserted && guard.alive()) message.success("已从剪切板添加图片");
            return Boolean(inserted);
        };

        // 1) paste 事件里的图片文件（截图/资源管理器复制）优先。
        const filesFromEvent = clipboardEvent
            ? Array.from(clipboardEvent.clipboardData?.items || [])
                .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
                .map((item) => item.getAsFile())
                .filter((file): file is File => Boolean(file))
            : [];
        if (filesFromEvent.length) return pasteImageFile(filesFromEvent[0]);

        // 2) 若系统文本是节点标记，说明最近一次复制是画布节点，不要再读旧图片。
        const eventText = clipboardEvent?.clipboardData?.getData("text/plain") || "";
        if (isNodeMarker(eventText)) return false;

        // 3) 异步读系统剪贴板：有图片才导入；若文本是节点标记则让位给节点粘贴。
        if (navigator.clipboard?.read) {
            try {
                const items = await navigator.clipboard.read();
                if (!guard.alive()) return false;
                const textItem = items.find((item) => item.types.includes("text/plain"));
                if (textItem) {
                    const textBlob = await textItem.getType("text/plain");
                    const text = await textBlob.text();
                    if (!guard.alive()) return false;
                    if (isNodeMarker(text)) return false;
                }
                const imageItem = items.find((item) => item.types.some((type) => type.startsWith("image/")));
                if (imageItem) {
                    const imageType = imageItem.types.find((type) => type.startsWith("image/"));
                    if (!imageType) return false;
                    const blob = await imageItem.getType(imageType);
                    if (!guard.alive()) return false;
                    return pasteImageFile(new File([blob], "clipboard-image.png", { type: imageType }));
                }
            } catch {
                // 无权限时继续文本分支。
            }
        }

        try {
            const text = eventText || (navigator.clipboard?.readText ? await navigator.clipboard.readText() : "");
            if (!guard.alive()) return false;
            if (isNodeMarker(text)) return false;
            if (createTextNodeFromClipboard(text, position)) {
                message.success("已从剪切板添加文本");
                return true;
            }
        } catch {
            // ignore
        }
        return false;
    }, [canvasId, createFileNode, createTextNodeFromClipboard, getCanvasCenter, lifetime, message, mountedRef, nodesRef, replaceNodeMedia, selectedNodeIdsRef]);

    const handleImageInputChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []);
        const file = files[0];
        const target = uploadTargetRef.current;
        try {
            if (!file || !uploadNodeType(file)) return;
            if (target?.nodeId) {
                const targetNode = nodesRef.current.find((node) => node.id === target.nodeId);
                const compatible = targetNode && (targetNode.type === uploadNodeType(file)
                    || ![CanvasNodeType.Image, CanvasNodeType.Text].includes(targetNode.type as CanvasNodeType));
                if (!compatible) {
                    message.warning("请选择与当前节点相同类型的媒体文件");
                    return;
                }
                await replaceNodeMedia(target.nodeId, file);
                return;
            }
            await handleUploadFiles(files);
        } finally {
            uploadTargetRef.current = null;
            event.target.value = "";
        }
    }, [getCanvasCenter, handleUploadFiles, message, nodesRef, replaceNodeMedia]);

    const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        fileDragDepthRef.current = 0;
        setFileDropActive(false);
        const imageAssetId = event.dataTransfer.getData(CANVAS_IMAGE_ASSET_DND_TYPE);
        if (imageAssetId) {
            const asset = useAssetStore.getState().assets.find((item): item is ImageAsset => item.kind === "image" && item.id === imageAssetId);
            if (!asset) {
                message.warning("素材不存在");
                return;
            }
            void createImageAssetNode(asset, screenToCanvas(event.clientX, event.clientY));
            return;
        }
        const files = Array.from(event.dataTransfer.files).filter((item) => uploadNodeType(item));
        if (!files.length) return;
        if (files.length > 1) {
            void handleUploadFiles(files);
            return;
        }
        const file = files[0];
        const position = screenToCanvas(event.clientX, event.clientY);
        const target = [...nodesRef.current].reverse().find((node) => {
            const compatible = node.type === uploadNodeType(file);
            return compatible && position.x >= node.position.x && position.x <= node.position.x + node.width && position.y >= node.position.y && position.y <= node.position.y + node.height;
        });
        if (target) {
            const expectedScope = captureUserScope();
            void replaceNodeMedia(target.id, file, expectedScope).then((replaced) => {
                if (replaced && userScopeMatches(expectedScope)) message.success("媒体已替换，可撤销恢复");
            });
            return;
        }
        void createFileNode(file, position);
    }, [createFileNode, createImageAssetNode, handleUploadFiles, message, nodesRef, replaceNodeMedia, screenToCanvas]);

    const handleFileDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
        if (!hasDraggedFiles(event)) return;
        event.preventDefault();
        fileDragDepthRef.current += 1;
        setFileDropActive(true);
    }, []);

    const handleFileDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
        if (!hasDraggedFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
    }, []);

    const handleFileDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
        if (!hasDraggedFiles(event)) return;
        fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
        if (fileDragDepthRef.current === 0) setFileDropActive(false);
    }, []);

    const pasteAssistantImage = useCallback((file: File) => {
        const expectedScope = captureUserScope();
        void createFileNode(file, getCanvasCenter(), undefined, expectedScope).then((inserted) => {
            if (inserted && userScopeMatches(expectedScope)) message.success("已从剪切板添加图片");
        });
    }, [createFileNode, getCanvasCenter, message]);

    const openAssetsAtPosition = useCallback((position?: Position) => {
        assetInsertPositionRef.current = position || null;
        setAssetPickerOpen(true);
    }, []);

    const closeAssetPicker = useCallback(() => {
        assetInsertPositionRef.current = null;
        setAssetPickerOpen(false);
    }, []);

    const createAssetPayloadNode = useCallback(async (payload: InsertAssetPayload, center: Position, expectedScope?: CapturedUserScope) => {
        if (payload.kind === "text") {
            const node = { ...createCanvasNode(CanvasNodeType.Text, center, { content: payload.content, status: NODE_STATUS_SUCCESS, assetId: payload.assetId }), title: payload.content.slice(0, 32) || "Assistant Text" };
            return node;
        }
        if (payload.kind !== "image") return null;
        const uploadedFreshResource = !payload.url && !payload.storageKey;
        const storedImage = payload.url
            ? { url: payload.url, storageKey: undefined, width: payload.width || 1, height: payload.height || 1, bytes: payload.bytes || 0, mimeType: payload.mimeType || "image/png" }
            : payload.storageKey
                ? { url: payload.dataUrl, storageKey: payload.storageKey, width: payload.width || 1, height: payload.height || 1, bytes: payload.bytes || 0, mimeType: payload.mimeType || "image/png" }
                : await uploadImage(payload.dataUrl, undefined, expectedScope);
        if (expectedScope) assertUserScope(expectedScope);
        const meta = !payload.storageKey && (!payload.width || !payload.height) ? await readImageMeta(storedImage.url) : storedImage;
        if (expectedScope) assertUserScope(expectedScope);
        let resolvedAssetId = payload.assetId;
        if (uploadedFreshResource && resourceIdFromStorageKey(storedImage.storageKey)) {
            const existingAsset = resolvedAssetId
                ? useAssetStore.getState().assets.find((item): item is ImageAsset => item.kind === "image" && item.id === resolvedAssetId)
                : undefined;
            if (existingAsset && resolvedAssetId) {
                await http.put(`/assets/${encodeURIComponent(resolvedAssetId)}`, {
                    asset: {
                        ...existingAsset,
                        coverUrl: storedImage.url,
                        data: { ...existingAsset.data, dataUrl: storedImage.url, storageKey: storedImage.storageKey },
                        updatedAt: new Date().toISOString(),
                    },
                }, { expectedScope });
                if (expectedScope) assertUserScope(expectedScope);
                useAssetStore.getState().updateAsset(resolvedAssetId, {
                    coverUrl: storedImage.url,
                    data: { ...existingAsset.data, dataUrl: storedImage.url, storageKey: storedImage.storageKey },
                });
            } else {
                resolvedAssetId = undefined;
            }
        }
        const size = fitNodeSize(meta.width, meta.height);
        const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const metadata = storedImage.storageKey
            ? imageMetadata({ ...storedImage, storageKey: storedImage.storageKey, width: meta.width, height: meta.height })
            : { content: storedImage.url, status: NODE_STATUS_SUCCESS, naturalWidth: meta.width, naturalHeight: meta.height, bytes: storedImage.bytes, mimeType: storedImage.mimeType };
        return { id, type: CanvasNodeType.Image, title: payload.title.slice(0, 32) || "Generated Image", position: { x: center.x - size.width / 2, y: center.y - size.height / 2 }, width: size.width, height: size.height, metadata: mediaResultMetadata("library", { ...metadata, prompt: payload.title, assetId: resolvedAssetId }) } satisfies CanvasNodeData;
    }, []);

    const createAssetPayloadNodes = useCallback(async (payloads: InsertAssetPayload[], origin: Position, expectedScope?: CapturedUserScope) => {
        const nodes = await Promise.all(payloads.map((payload, index) => createAssetPayloadNode(payload, {
            x: origin.x + (index % BATCH_UPLOAD_COLUMNS) * BATCH_UPLOAD_COLUMN_GAP,
            y: origin.y + Math.floor(index / BATCH_UPLOAD_COLUMNS) * BATCH_UPLOAD_ROW_GAP,
        }, expectedScope)));
        return nodes.filter((node): node is CanvasNodeData => Boolean(node));
    }, [createAssetPayloadNode]);

    const insertAssetPayloads = useCallback(async (payloads: InsertAssetPayload[], origin: Position, successMessage: string, failureMessage: string, expectedScope?: CapturedUserScope): Promise<CanvasNodeData[]> => {
        if (expectedScope) assertUserScope(expectedScope);
        const owner = lifetime.capture(canvasId);
        let created: CanvasNodeData[] = [];
        let applied = false;
        try {
            const status = await runOwnedCanvasCreatedNodes({
                owner,
                getLiveCanvasId: () => canvasIdRef.current,
                getLiveLifetime: () => lifetime.current(),
                create: async () => {
                    if (expectedScope) assertUserScope(expectedScope);
                    created = await createAssetPayloadNodes(payloads, origin, expectedScope);
                    return created;
                },
                apply: (nodes) => {
                    applied = true;
                    setNodes((current) => {
                        const next = [...current, ...nodes];
                        nodesRef.current = next;
                        return next;
                    });
                    setSelectedNodeIds(new Set(nodes.map((node) => node.id)));
                    setSelectedConnectionId(null);
                    setDialogNodeId(null);
                },
            });
            if (status !== "committed") return [];
            const unboundNodes = canvasNodesMissingResourceAssetBinding(created);
            let allUnboundConfirmed = true;
            for (const unbound of unboundNodes) {
                const confirmed = await persistMediaNode(unbound, expectedScope);
                if (!confirmed) allUnboundConfirmed = false;
            }
            if (!lifetime.matches(owner, canvasIdRef.current) || (expectedScope && !userScopeMatches(expectedScope))) {
                return [];
            }
            const createdIds = new Set(created.map((node) => node.id));
            const insertedNodes = nodesRef.current.filter((node) => createdIds.has(node.id));
            if (!allUnboundConfirmed) {
                message.warning("素材已添加到画布，但尚未同步到素材库，可在节点上重试");
                return insertedNodes;
            }
            message.success(successMessage);
            return insertedNodes;
        } catch (error) {
            if (!lifetime.matches(owner, canvasIdRef.current) || isUserScopeAbandonedError(error) || (expectedScope && !userScopeMatches(expectedScope))) {
                return [];
            }
            message.error(error instanceof Error ? error.message : failureMessage);
            throw error;
        }
    }, [canvasId, createAssetPayloadNodes, lifetime, message, nodesRef, persistMediaNode, setDialogNodeId, setNodes, setSelectedNodeIds, setSelectedConnectionId]);

    const handleAssetsInsert = useCallback(async (payloads: InsertAssetPayload[], expectedScope?: CapturedUserScope): Promise<CanvasNodeData[]> => {
        const origin = assetInsertPositionRef.current || getCanvasCenter();
        return insertAssetPayloads(payloads, origin, `已插入 ${payloads.length} 项素材`, "素材插入失败", expectedScope);
    }, [getCanvasCenter, insertAssetPayloads]);

    const handleProjectAssetsInsert = useCallback(async (payloads: InsertAssetPayload[], position?: Position, expectedScope?: CapturedUserScope): Promise<CanvasNodeData[]> => {
        const origin = position || getCanvasCenter();
        return insertAssetPayloads(payloads, origin, `已引入 ${payloads.length} 项项目资产`, "项目资产引入失败", expectedScope);
    }, [getCanvasCenter, insertAssetPayloads]);

    return {
        assetPickerOpen,
        uploadModalOpen,
        closeUploadModal:()=>setUploadModalOpen(false),
        handleImportUrl,
        closeAssetPicker,
        createAssetPayloadNode,
        createAssetPayloadNodes,
        createImageAssetNode,
        fileDropActive,
        handleAssetsInsert,
        handleDrop,
        handleFileDragEnter,
        handleFileDragLeave,
        handleFileDragOver,
        handleImageInputChange,
        handleProjectAssetsInsert,
        handleUploadFiles,
        handleUploadRequest,
        handleUploadReferenceRequest,
        imageInputRef,
        openAssetsAtPosition,
        pasteAssistantImage,
        pasteSystemClipboard,
        replaceNodeMedia,
        createFileNode,
        startUploadStatus,
        uploadStatus,
    };
}

function hasDraggedFiles(event: DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types).includes("Files");
}
