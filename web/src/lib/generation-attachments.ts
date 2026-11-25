import { resolveResourceUrl } from "@/services/api/resources";
import type { GenerationAttachment } from "@/lib/standalone-generation-reference";
import type { UploadedImage } from "@/services/image-storage";
import type { NewAsset, ImageAsset } from "@/stores/use-asset-store";

export type { GenerationAttachment } from "@/lib/standalone-generation-reference";

const imageExtensions = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".bmp"];

/** 独立生图页只接受图片文件；文档和音视频在精简版本中不再支持。 */
export function acceptedImageFile(file: Pick<File, "type" | "name">) {
    if (file.type.startsWith("image/")) return true;
    const name = file.name.toLowerCase();
    return imageExtensions.some((extension) => name.endsWith(extension));
}

export function removeCreationAttachment<T extends { id: string }>(attachments: T[], id: string) {
    return attachments.filter((attachment) => attachment.id !== id);
}

export function creationAttachmentFromImage(file: File, uploaded: UploadedImage): GenerationAttachment {
    return {
        id: `upload:${file.name}:${uploaded.storageKey}`,
        name: file.name,
        type: uploaded.mimeType || file.type || "image/png",
        dataUrl: uploaded.url,
        url: uploaded.url,
        storageKey: uploaded.storageKey,
        bytes: uploaded.bytes,
        width: uploaded.width,
        height: uploaded.height,
        previewUrl: uploaded.url,
    };
}

export function creationAttachmentFromAsset(asset: ImageAsset): GenerationAttachment {
    const url = resolveResourceUrl(asset.data.storageKey, asset.data.dataUrl || asset.coverUrl);
    return {
        id: `asset:${asset.id}`,
        name: asset.title || "素材图片",
        type: asset.data.mimeType || "image/png",
        dataUrl: url,
        url,
        storageKey: asset.data.storageKey,
        bytes: asset.data.bytes,
        width: asset.data.width,
        height: asset.data.height,
        previewUrl: url,
    };
}

export function creationImageAsset({ title, uploaded, metadata }: { title: string; uploaded: UploadedImage; metadata?: Record<string, unknown> }): NewAsset {
    return {
        kind: "image",
        title: title.trim() || "创作图片",
        coverUrl: uploaded.url,
        tags: ["创作"],
        status: "confirmed",
        source: "生图页",
        metadata: { source: "standalone-image-page", ...metadata },
        data: {
            dataUrl: uploaded.url,
            storageKey: uploaded.storageKey,
            width: uploaded.width,
            height: uploaded.height,
            bytes: uploaded.bytes,
            mimeType: uploaded.mimeType || "image/png",
        },
    };
}
