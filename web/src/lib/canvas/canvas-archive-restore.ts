import { confinedArchivePath } from "@/lib/zip";
import { canonicalize } from "json-canonicalize";
import { isLocalRuntimeMode } from "@/lib/runtime-mode";
import {
    collectStorageKeys,
    isArchiveStorageKey,
    openCanvasArchive,
    preflightCanvasArchive,
    type OpenCanvasArchive,
} from "@/lib/canvas/canvas-export";
import { createCanvasLibraryFolder, deleteCanvasLibraryFolder, persistCanvasFolderCover } from "@/lib/canvas/canvas-folder-storage";
import { canvasWorkspaceProjectId } from "@/lib/canvas/canvas-workspace-project";
import { normalizeLocalCanvasProject } from "@/lib/local-workspace-migration";
import { assertUserScope, captureUserScope, isUserScopeAbandonedError, userScopeMatches, type CapturedUserScope } from "@/lib/user-scope-guard";
import { http } from "@/services/api/request";
import { resourceFileUrl, resourceIdFromStorageKey, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { primeResourceBlobCache } from "@/services/resource-blob-cache";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { readLocalCanvasProjectFromBackend, syncLocalCanvasProjectToBackend } from "@/services/local-workspace-repository";
import { ensureCanvasNodeAsset } from "@/services/project-asset-sync";
import { deleteWorkspaceAsset } from "@/services/workspace-asset-repository";
import { usesBrowserLocalResourceStore } from "@/services/workspace-resource-storage";
import { flushCanvasStorePersistence, useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { CanvasExportAsset } from "@/types/canvas-export";

export type RestoredMediaRef = {
    storageKey: string;
    url: string;
    resourceId?: string;
};

export type CanvasArchiveProjectProgress = {
    projectId: string;
    total: number;
    completed: number;
    phase: "uploading" | "saving" | "error";
    message: string;
};

export type CanvasArchiveRestoreHost = {
    usesCanonicalBackend: boolean;
    createFolder(name: string): string | Promise<string>;
    deleteFolder(id: string): void | Promise<void>;
    restoreFolderCover?(id: string, cover: Blob): Promise<void>;
    importProject(project: Partial<CanvasProject>, workspaceProjectId?: string): string;
    updateProject(id: string, patch: Partial<CanvasProject>): void;
    persistProject(id: string): Promise<void>;
    deleteProjects(ids: readonly string[]): Promise<void>;
    discardProjects(ids: readonly string[]): void;
    uploadMedia(blob: Blob, kind: "image" | "file", meta: { storageKey: string; mimeType: string; fileName?: string }): Promise<RestoredMediaRef>;
    bindMediaAsset?(options: { canvasId: string; node: CanvasNodeData }): Promise<string>;
    deleteResource?(resourceId: string): Promise<void>;
    onProjectProgress?(projectId: string, progress: CanvasArchiveProjectProgress | null): void;
};

export type CanvasArchiveRestoreResult = {
    count: number;
    projectIds: string[];
    folderIds: string[];
    resourceIds: string[];
    storage: "browser" | "backend";
};

export async function archiveContentDigest(blob: Blob): Promise<string> {
    const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function archiveMediaIdempotencyKey(blob: Blob): Promise<string> {
    return `canvas-archive:sha256:${await archiveContentDigest(blob)}`;
}

export function assertRestoredCanvasMatches(intended: Partial<CanvasProject> & Pick<CanvasProject, "id" | "nodes">, saved: CanvasProject, storage: "browser" | "backend" = "browser") {
    if (!saved?.id || saved.id !== intended.id) throw new Error("画布未保存到工作区");
    if ((saved.folderId || "") !== (intended.folderId || "")) throw new Error("画布文件夹未保存到工作区");
    const intendedKeys = collectStorageKeys({ nodes: intended.nodes }).sort();
    const savedKeys = collectStorageKeys({ nodes: saved.nodes }).sort();
    if (intendedKeys.join("\n") !== savedKeys.join("\n")) throw new Error("画布媒体未保存到工作区");
    const intendedAssets = mediaAssetIds(intended.nodes);
    const savedAssets = mediaAssetIds(saved.nodes);
    if (intendedAssets.join("\n") !== savedAssets.join("\n")) throw new Error("画布素材引用未保存到工作区");
    // Compare every submitted document field, including new editor features.
    // Only server-owned timestamps and synchronization metadata may differ.
    for (const [key, value] of Object.entries(intended)) {
        if (["revision", "createdAt", "updatedAt", "remoteContentHash"].includes(key)) continue;
        // Canonical document commits exclude viewport; the client retains this
        // local view preference. Browser-cache readback must still preserve it.
        if (storage === "backend" && key === "viewport") continue;
        const actual = saved[key as keyof CanvasProject];
        if (value === undefined && (actual === undefined || actual === null || actual === "")) continue;
        if (canonicalize(value) !== canonicalize(actual)) throw new Error("画布内容未完整保存到工作区");
    }
}

function mediaAssetIds(nodes: CanvasNodeData[]) {
    const ids: string[] = [];
    for (const node of nodes) {
        if (!isMediaNode(node.type)) continue;
        if (node.metadata?.storageKey && node.metadata.assetId) ids.push(`${node.id}:${node.metadata.assetId}`);
    }
    return ids.sort();
}

function isMediaNode(type: CanvasNodeData["type"]) {
    return type === CanvasNodeType.Image;
}

export function createCanvasArchiveRestoreHost(overrides: Partial<CanvasArchiveRestoreHost> = {}, scope = captureUserScope()): CanvasArchiveRestoreHost {
    const store = () => useCanvasStore.getState();
    const usesCanonicalBackend = overrides.usesCanonicalBackend ?? !usesBrowserLocalResourceStore();
    const createdAssets = new Set<string>();
    return {
        createFolder: (name) => createCanvasLibraryFolder(name, scope),
        deleteFolder: (id) => deleteCanvasLibraryFolder(id, scope),
        restoreFolderCover: async (id, cover) => {
            const bytes = new Uint8Array(await cover.arrayBuffer());
            assertUserScope(scope);
            let binary = "";
            for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
            await persistCanvasFolderCover(id, `data:${cover.type || "image/png"};base64,${btoa(binary)}`, scope);
        },
        importProject: (project, workspaceProjectId) => store().importProject(project, workspaceProjectId),
        updateProject: (id, patch) => store().updateProject(id, patch),
        persistProject: async (id) => {
            const live = store().openProject(id);
            if (!live) throw new Error("画布未保存到工作区");
            if (!usesCanonicalBackend) {
                await flushCanvasStorePersistence();
                assertUserScope(scope);
                const cached = store().openProject(id);
                if (!cached) throw new Error("画布未保存到工作区");
                assertRestoredCanvasMatches(live, cached);
                return;
            }
            await syncLocalCanvasProjectToBackend(id, scope);
            let saved: CanvasProject;
            try {
                saved = await readLocalCanvasProjectFromBackend(id, scope);
            } catch (error) {
                if (isUserScopeAbandonedError(error)) throw error;
                throw new Error("画布未保存到工作区");
            }
            assertRestoredCanvasMatches(live, saved, "backend");
            if ((saved.revision ?? 0) < 1) throw new Error("画布未保存到工作区");
        },
        deleteProjects: async (ids) => {
            const unique = [...new Set(ids.filter(Boolean))];
            if (usesCanonicalBackend) {
                await Promise.all(unique.map(async (id) => {
                    await http.delete(`/canvas-projects/${encodeURIComponent(id)}`, { expectedScope: scope });
                }));
            }
            assertUserScope(scope);
            store().deleteProjects(unique);
            for (const assetId of createdAssets) {
                await deleteWorkspaceAsset(assetId, scope);
                createdAssets.delete(assetId);
            }
        },
        discardProjects: (ids) => store().deleteProjects([...ids]),
        uploadMedia: async (blob, kind, meta) => {
            if (!usesCanonicalBackend) {
                const storageKey = `${kind}:${scope.userScope}:${crypto.randomUUID()}`;
                const url = await (kind === "image" ? setImageBlob(storageKey, blob) : setMediaBlob(storageKey, blob));
                assertUserScope(scope);
                return { storageKey, url: url || "" };
            }
            const resource = await uploadResourceFile(blob, kind, { fileName: meta.fileName, idempotencyKey: await archiveMediaIdempotencyKey(blob), expectedScope: scope });
            assertUserScope(scope);
            const storageKey = resourceStorageKey(resource.id);
            await primeResourceBlobCache(storageKey, blob, scope).catch((error) => {
                if (isUserScopeAbandonedError(error)) throw error;
            });
            return { storageKey, url: resource.publicUrl || resourceFileUrl(resource.id), resourceId: resource.id };
        },
        bindMediaAsset: async (options) => {
            const result = await ensureCanvasNodeAsset({ ...options, source: "canvas-upload", expectedScope: scope });
            if (result.created) createdAssets.add(result.assetId);
            if (!result.confirmed) throw new Error("素材文件尚未保存到工作区，导入未完成");
            return result.assetId;
        },
        ...overrides,
        usesCanonicalBackend,
    };
}

function withRestoreScope(host: CanvasArchiveRestoreHost, scope: CapturedUserScope): CanvasArchiveRestoreHost {
    const run = <Args extends unknown[], Result>(fn: (...args: Args) => Result) => (...args: Args) => {
        assertUserScope(scope);
        const result = fn(...args);
        if (result instanceof Promise) return result.then((value) => {
            assertUserScope(scope);
            return value;
        }) as Result;
        assertUserScope(scope);
        return result;
    };
    return {
        usesCanonicalBackend: host.usesCanonicalBackend,
        createFolder: run(host.createFolder),
        deleteFolder: run(host.deleteFolder),
        restoreFolderCover: host.restoreFolderCover ? run(host.restoreFolderCover) : undefined,
        importProject: run(host.importProject),
        updateProject: run(host.updateProject),
        persistProject: run(host.persistProject),
        deleteProjects: run(host.deleteProjects),
        discardProjects: run(host.discardProjects),
        uploadMedia: run(host.uploadMedia),
        bindMediaAsset: host.bindMediaAsset ? run(host.bindMediaAsset) : undefined,
        deleteResource: host.deleteResource ? run(host.deleteResource) : undefined,
        onProjectProgress: host.onProjectProgress ? run(host.onProjectProgress) : undefined,
    };
}

export async function restoreCanvasArchive(input: Blob | OpenCanvasArchive, host: Partial<CanvasArchiveRestoreHost> = {}): Promise<CanvasArchiveRestoreResult> {
    const scope = captureUserScope();
    const localPersistence = isLocalRuntimeMode();
    const archive = "data" in input && "files" in input ? input : await openCanvasArchive(input);
    assertUserScope(scope);
    preflightCanvasArchive(archive.data, archive.files);
    const restoreHost = withRestoreScope(createCanvasArchiveRestoreHost(host, scope), scope);
    const folderIds: string[] = [];
    const projectIds: string[] = [];
    const resourceIds: string[] = [];
    const progressProjectIds = new Set<string>();
    const reportProgress = (id: string, progress: CanvasArchiveProjectProgress | null) => {
        if (progress) progressProjectIds.add(id);
        else progressProjectIds.delete(id);
        restoreHost.onProjectProgress?.(id, progress);
    };
    const folderIdMap = new Map<string, string>();
    const importedWorkspaceProjectIds = new Map<string, string>();
    try {
        for (const folder of archive.data.folders || []) {
            const id = await restoreHost.createFolder(folder.name);
            folderIds.push(id);
            folderIdMap.set(folder.id, id);
            if (folder.coverPath && restoreHost.restoreFolderCover) {
                const cover = archive.files.get(confinedArchivePath(folder.coverPath));
                if (!cover) throw new Error(`压缩包缺少文件夹封面：${folder.name}`);
                await restoreHost.restoreFolderCover(id, cover.slice(0, cover.size, folder.coverMimeType || cover.type || "image/png"));
            } else if (folder.coverDataUrl?.startsWith("data:image/") && restoreHost.restoreFolderCover) {
                const response = await fetch(folder.coverDataUrl);
                assertUserScope(scope);
                await restoreHost.restoreFolderCover(id, await response.blob());
            }
        }
        for (const item of archive.data.projects) {
            const archiveProjectId = item.project.id;
            reportProgress(archiveProjectId, {
                projectId: archiveProjectId,
                total: item.files.length,
                completed: 0,
                phase: localPersistence ? "saving" : "uploading",
                message: localPersistence ? "正在保存本地媒体" : "正在上传媒体",
            });
            const storageKeyMap = await restoreArchiveMedia(item.files, archive.files, restoreHost, resourceIds, (completed) => {
                reportProgress(archiveProjectId, {
                    projectId: archiveProjectId,
                    total: item.files.length,
                    completed,
                    phase: localPersistence ? "saving" : "uploading",
                    message: localPersistence ? "正在保存本地媒体" : "正在上传媒体",
                });
            });
            const remappedNodes = (item.project.nodes || []).map((node) => remapArchiveNode(node, storageKeyMap));
            const sourceWorkspaceProjectId = canvasWorkspaceProjectId(item.project);
            const importedProjectId = restoreHost.importProject({
                ...normalizeLocalCanvasProject(item.project),
                projectId: undefined,
                folderId: item.project.folderId ? folderIdMap.get(item.project.folderId) : undefined,
                title: item.project.title || "导入画布",
                nodes: remappedNodes,
            }, importedWorkspaceProjectIds.get(sourceWorkspaceProjectId));
            projectIds.push(importedProjectId);
            if (!importedWorkspaceProjectIds.has(sourceWorkspaceProjectId)) importedWorkspaceProjectIds.set(sourceWorkspaceProjectId, importedProjectId);
            reportProgress(archiveProjectId, null);
            reportProgress(importedProjectId, {
                projectId: importedProjectId,
                total: item.files.length,
                completed: item.files.length,
                phase: "saving",
                message: localPersistence ? "正在保存本地画布" : "正在保存画布",
            });
            const bound = await bindRestoredMedia(importedProjectId, remappedNodes, restoreHost);
            restoreHost.updateProject(importedProjectId, { nodes: bound });
            try {
                await restoreHost.persistProject(importedProjectId);
            } catch (error) {
                reportProgress(importedProjectId, {
                    projectId: importedProjectId,
                    total: item.files.length,
                    completed: item.files.length,
                    phase: "error",
                    message: error instanceof Error ? error.message : "画布导入未完成",
                });
                throw error;
            } finally {
                reportProgress(importedProjectId, null);
            }
        }
        return {
            count: archive.data.projects.length,
            projectIds,
            folderIds,
            resourceIds,
            storage: restoreHost.usesCanonicalBackend ? "backend" : "browser",
        };
    } catch (error) {
        if (isUserScopeAbandonedError(error) || !userScopeMatches(scope)) throw error;
        try {
            await cleanupCanvasArchiveAttempt(restoreHost, scope, { folderIds, projectIds, resourceIds });
        } catch (cleanupError) {
            throw new AggregateError([error, cleanupError], `${error instanceof Error ? error.message : "导入未完成"}；部分导入内容未能清理，请检查工作区后重试`);
        }
        throw error;
    } finally {
        // Media upload and asset binding can fail before persistProject's
        // finally block. Their progress must not keep blocking exit/update.
        if (userScopeMatches(scope)) {
            for (const id of progressProjectIds) restoreHost.onProjectProgress?.(id, null);
        }
    }
}

async function restoreArchiveMedia(
    files: CanvasExportAsset[],
    zip: Map<string, Blob>,
    host: CanvasArchiveRestoreHost,
    resourceIds: string[],
    onProgress?: (completed: number) => void,
) {
    const storageKeyMap = new Map<string, RestoredMediaRef>();
    const concurrency = 4;
    let fileIndex = 0;
    let completed = 0;
    let halt = false;
    let firstError: unknown;
    const workers = new Array(Math.min(files.length, concurrency) || 0).fill(null).map(async () => {
        while (!halt) {
            const current = fileIndex++;
            if (current >= files.length) return;
            const fileItem = files[current];
            try {
                const blob = zip.get(fileItem.path) || zip.get(confinedArchivePath(fileItem.path));
                if (!blob) throw new Error(`压缩包缺少媒体文件：${fileItem.path}`);
                const mime = fileItem.mimeType || blob.type || "application/octet-stream";
                const typedBlob = blob.type ? blob : blob.slice(0, blob.size, mime);
                const mapped = await host.uploadMedia(typedBlob, mediaKind(fileItem.storageKey, mime), {
                    storageKey: fileItem.storageKey,
                    mimeType: mime,
                    fileName: fileItem.path.split("/").pop(),
                });
                if (mapped.resourceId) resourceIds.push(mapped.resourceId);
                storageKeyMap.set(fileItem.storageKey, mapped);
                completed += 1;
                onProgress?.(completed);
            } catch (error) {
                halt = true;
                firstError ??= error;
            }
        }
    });
    await Promise.all(workers);
    if (firstError) throw firstError;
    return storageKeyMap;
}

async function bindRestoredMedia(
    projectId: string,
    nodes: CanvasNodeData[],
    host: CanvasArchiveRestoreHost,
) {
    if (!host.bindMediaAsset) return nodes;
    const assetIdByStorageKey = new Map<string, string>();
    const nextNodes: CanvasNodeData[] = [];
    for (const node of nodes) {
        const isMedia = isMediaNode(node.type);
        if (!isMedia || !node.metadata?.storageKey) {
            nextNodes.push(node);
            continue;
        }
        const storageKey = node.metadata.storageKey;
        let assetId = assetIdByStorageKey.get(storageKey);
        if (!assetId) {
            assetId = await host.bindMediaAsset({ canvasId: projectId, node: { ...node, metadata: { ...node.metadata, assetId: undefined } } });
            if (assetId) assetIdByStorageKey.set(storageKey, assetId);
        }
        nextNodes.push(assetId ? { ...node, metadata: { ...node.metadata, assetId } } : node);
    }
    return nextNodes;
}

function mediaKind(storageKey: string, mime: string): "image" | "file" {
    if (mime.startsWith("image/") || storageKey.startsWith("image:")) return "image";
    return "file";
}

function remapArchiveNode(node: CanvasNodeData, storageKeyMap: Map<string, RestoredMediaRef>): CanvasNodeData {
    const media = isMediaNode(node.type);
    const mapped = media && node.metadata?.storageKey ? storageKeyMap.get(node.metadata.storageKey) : undefined;
    return {
        ...node,
        metadata: {
            ...node.metadata,
            assetId: undefined,
            taskId: undefined,
            storageKey: media ? mapped?.storageKey ?? dropDeadStorageKey(node.metadata?.storageKey) : node.metadata?.storageKey,
            content: media ? (mapped ? mapped.url : dropInlineMediaRef(node.metadata?.content)) : node.metadata?.content,
            previewContent: media ? (mapped ? mapped.url : dropInlineMediaRef(node.metadata?.previewContent)) : node.metadata?.previewContent,
        },
    };
}

function dropDeadStorageKey(value?: string) {
    if (!value || !isArchiveStorageKey(value)) return undefined;
    return value;
}

function dropInlineMediaRef(value?: string) {
    if (typeof value !== "string") return value;
    if (value.startsWith("blob:")) return "";
    if (/^data:image\//i.test(value.trim())) return "";
    return value;
}

async function cleanupCanvasArchiveAttempt(
    host: CanvasArchiveRestoreHost,
    scope: CapturedUserScope,
    attempt: { folderIds: string[]; projectIds: string[]; resourceIds: string[] },
) {
    if (!userScopeMatches(scope)) return;
    try {
        assertUserScope(scope);
    } catch {
        return;
    }
    if (attempt.projectIds.length) {
        try {
            await host.deleteProjects(attempt.projectIds);
        } catch (error) {
            if (isUserScopeAbandonedError(error) || !userScopeMatches(scope)) return;
            // Keep the visible projects when their durable deletion failed.
            throw error;
        }
    }
    if (!userScopeMatches(scope)) return;
    for (const folderId of attempt.folderIds) {
        try {
            await host.deleteFolder(folderId);
        } catch (error) {
            if (isUserScopeAbandonedError(error) || !userScopeMatches(scope)) return;
            throw error;
        }
    }
    if (!host.deleteResource || !userScopeMatches(scope)) return;
    await Promise.all(attempt.resourceIds.map(async (resourceId) => {
        try {
            assertUserScope(scope);
            await host.deleteResource?.(resourceId);
        } catch (error) {
            if (isUserScopeAbandonedError(error) || !userScopeMatches(scope)) return;
            throw error;
        }
    }));
}

export { collectStorageKeys, isArchiveStorageKey, resourceIdFromStorageKey };
