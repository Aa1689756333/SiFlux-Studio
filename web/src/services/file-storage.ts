import { nanoid } from "nanoid";

import { getActiveUserScope } from "@/lib/user-scope";
import { assertUserScope, captureUserScope, isUserScopeAbandonedError, type CapturedUserScope } from "@/lib/user-scope-guard";
import { resourceFileUrl, resourceIdFromStorageKey, resourceStorageKey, ResourceUploadError, uploadResourceFile } from "@/services/api/resources";
import { apiBaseURL } from "@/services/api/request";
import type { UploadedImage } from "@/services/image-storage";
import { cacheResourceObjectUrl, getCachedResourceBlob, getCachedResourceObjectUrl, primeResourceBlobCache } from "@/services/resource-blob-cache";
import { cleanupLocalMedia, deleteLocalMedia, getLocalMediaBlob, resolveLocalMediaUrl, saveLocalMedia, setLocalMediaBlob } from "@/services/local-media-repository";
import { usesBrowserLocalResourceStore } from "@/services/workspace-resource-storage";

export type UploadedFile = {
    url: string;
    storageKey: string;
    bytes: number;
    mimeType: string;
    width?: number;
    height?: number;
    preview?: UploadedImage;
    /**
     * true 表示本地 Go 资源服务暂时不可用、文件当前只存在于本机 IndexedDB。
     * 在那之前 `url` 是页面级 objectURL，刷新后需要从本地缓存恢复。
     */
    pendingRemoteUpload?: boolean;
    /** 直传失败原因，仅在 pendingRemoteUpload 为 true 时有值。 */
    remoteUploadError?: string;
};

export async function uploadMediaFile(input: Blob, prefix = "file", onProgress?: (uploadedBytes: number, totalBytes: number) => void, expectedScope?: CapturedUserScope): Promise<UploadedFile> {
    // 直传和失败后的本地同步必须复用同一上传身份，避免响应丢失后创建第二个对象。
    const expected = expectedScope ?? captureUserScope();
    const storageKey = `${prefix}:${expected.userScope}:${nanoid()}`;
    const blob = input;
    const previewUrl = URL.createObjectURL(blob);
    let retainPreviewUrl = false;

    try {
        assertUserScope(expected);

        if (usesBrowserLocalResourceStore()) {
            assertUserScope(expected);
            await saveLocalMedia(storageKey, blob, previewUrl);
            retainPreviewUrl = true;
            return { url: previewUrl, storageKey, bytes: blob.size, mimeType: blob.type || "application/octet-stream" };
        }

        let remoteUploadError = "";
        // The native desktop Go resource service is the canonical local store.
        // Browser local mode keeps IndexedDB as its offline/development store.
        try {
            const resource = await uploadResourceFile(blob, "file", { fileName: input instanceof File ? input.name : undefined, idempotencyKey: storageKey, expectedScope: expected }, onProgress);
            assertUserScope(expected);
            try {
                await primeResourceBlobCache(resourceStorageKey(resource.id), blob, expected);
            } catch (error) {
                if (isUserScopeAbandonedError(error)) throw error;
                // 缓存只影响后续读取性能，服务端资源已经成功落盘，不得把缓存失败误报为上传失败。
                console.warn("预热媒体缓存失败，服务端资源已保存", { resourceId: resource.id, error });
            }
            return {
                url: resource.publicUrl || resourceFileUrl(resource.id),
                storageKey: resourceStorageKey(resource.id),
                bytes: resource.size || blob.size,
                mimeType: resource.mimeType || blob.type || "application/octet-stream",
                width: resource.width,
                height: resource.height,
            };
        } catch (error) {
            if (isUserScopeAbandonedError(error)) throw error;
            // 与图片上传同一套判定：永久性失败必须当场暴露，不能混进“稍后自动同步”。
            if (error instanceof ResourceUploadError && error.permanent) throw error;
            remoteUploadError = error instanceof Error ? error.message : "媒体直传失败";
        }

        assertUserScope(expected);
        // 本地资源服务暂时不可用时退回浏览器本地缓存，保持当前编辑可用。
        await saveLocalMedia(storageKey, blob, previewUrl);
        retainPreviewUrl = true;
        return {
            url: previewUrl,
            storageKey,
            bytes: blob.size,
            mimeType: blob.type || "application/octet-stream",
            pendingRemoteUpload: true,
            remoteUploadError,
        };
    } finally {
        // 只有本地降级结果需要把 objectURL 留给页面；成功上传和所有异常路径都及时释放。
        if (!retainPreviewUrl) URL.revokeObjectURL(previewUrl);
    }
}

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
    // Older canvas snapshots stored resource paths without the `/api` prefix.
    // In desktop mode those paths are interpreted by Wails as asset-server
    // paths and return its plain-text 404 page. Normalize them before handing
    // the URL to an element.
    if (!storageKey) {
        const legacyResource = fallback.match(/^\/resources\/([^/?#]+)\/file(?:[?#].*)?$/u);
        if (legacyResource) {
            const suffix = fallback.slice(legacyResource[0].indexOf("/file") + "/file".length);
            return `${String(apiBaseURL).replace(/\/+$/u, "")}/resources/${encodeURIComponent(legacyResource[1])}/file${suffix}`;
        }
        return fallback;
    }
    const resourceId = resourceIdFromStorageKey(storageKey);
    if (resourceId) {
        const cached = await getCachedResourceObjectUrl(storageKey).catch(() => "");
        // A native element cannot attach the desktop launch token. If the
        // resource is not already cached, eagerly fetch it through the
        // authenticated client and hand the caller a Blob URL.
        if (cached) return cached;
        const hydrated = await cacheResourceObjectUrl(storageKey).catch(() => "");
        return hydrated || resourceFileUrl(resourceId);
    }
    return resolveLocalMediaUrl(storageKey, fallback);
}

export async function getMediaBlob(storageKey: string) {
    if (resourceIdFromStorageKey(storageKey)) return getCachedResourceBlob(storageKey);
    return getLocalMediaBlob(storageKey);
}

export async function setMediaBlob(storageKey: string, blob: Blob) {
    if (resourceIdFromStorageKey(storageKey)) return primeResourceBlobCache(storageKey, blob);
    return setLocalMediaBlob(storageKey, blob);
}

export async function deleteStoredMedia(keys: Iterable<string>) {
    await deleteLocalMedia(Array.from(keys).filter((key) => !resourceIdFromStorageKey(key)));
}

export async function cleanupUnusedMedia(usedData: unknown, scope = getActiveUserScope()) {
    const usedKeys = collectMediaStorageKeys(usedData);
    const currentScope = scope;
    await cleanupLocalMedia(usedKeys, currentScope);
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && (value.storageKey.includes(":") || resourceIdFromStorageKey(value.storageKey))) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectMediaStorageKeys(child, keys)) : collectMediaStorageKeys(item, keys)));
    return keys;
}
