import { resolveResourceUrl } from "@/services/api/resources";
import type { CreationAttachment } from "@/pages/create/creation-assets";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export type StandaloneMediaReference = {
    id: string;
    name: string;
    type: string;
    url?: string;
    storageKey?: string;
    bytes?: number;
    width?: number;
    height?: number;
    durationMs?: number;
    arkAssetId?: string;
};

function optionalString(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function persistableUrl(value: string | undefined) {
    const url = value?.trim() || "";
    if (!url || url.startsWith("data:") || url.startsWith("blob:")) return undefined;
    return url;
}

export function persistableMediaReference(attachment: CreationAttachment): StandaloneMediaReference | null {
    const storageKey = "storageKey" in attachment ? optionalString(attachment.storageKey) : undefined;
    const rawUrl = persistableUrl(("url" in attachment ? attachment.url : undefined) || ("dataUrl" in attachment ? attachment.dataUrl : undefined) || attachment.previewUrl);
    if (!storageKey && !rawUrl) return null;
    const next: StandaloneMediaReference = {
        id: attachment.id,
        name: attachment.name,
        type: attachment.type,
    };
    if (rawUrl) next.url = rawUrl;
    if (storageKey) next.storageKey = storageKey;
    const bytes = "bytes" in attachment ? optionalNumber(attachment.bytes) : undefined;
    const width = "width" in attachment ? optionalNumber(attachment.width) : undefined;
    const height = "height" in attachment ? optionalNumber(attachment.height) : undefined;
    const durationMs = "durationMs" in attachment ? optionalNumber(attachment.durationMs) : undefined;
    const arkAssetId = "arkAssetId" in attachment ? optionalString((attachment as { arkAssetId?: string }).arkAssetId) : undefined;
    if (bytes != null) next.bytes = bytes;
    if (width != null) next.width = width;
    if (height != null) next.height = height;
    if (durationMs != null) next.durationMs = durationMs;
    if (arkAssetId) next.arkAssetId = arkAssetId;
    return next;
}

export function persistableMediaReferences(attachments: CreationAttachment[]) {
    return attachments.flatMap((attachment) => {
        const next = persistableMediaReference(attachment);
        return next ? [next] : [];
    });
}

export function parseStandaloneMediaReferences(raw: unknown): StandaloneMediaReference[] {
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const record = item as Record<string, unknown>;
        const id = optionalString(record.id);
        const name = typeof record.name === "string" ? record.name : "";
        const type = optionalString(record.type);
        const url = persistableUrl(typeof record.url === "string" ? record.url : undefined);
        const storageKey = optionalString(record.storageKey);
        if (!id || !type || (!url && !storageKey)) return [];
        const next: StandaloneMediaReference = { id, name, type };
        if (url) next.url = url;
        if (storageKey) next.storageKey = storageKey;
        const bytes = optionalNumber(record.bytes);
        const width = optionalNumber(record.width);
        const height = optionalNumber(record.height);
        const durationMs = optionalNumber(record.durationMs);
        const arkAssetId = optionalString(record.arkAssetId);
        if (bytes != null) next.bytes = bytes;
        if (width != null) next.width = width;
        if (height != null) next.height = height;
        if (durationMs != null) next.durationMs = durationMs;
        if (arkAssetId) next.arkAssetId = arkAssetId;
        return [next];
    });
}

function resolvedUrl(reference: StandaloneMediaReference) {
    return resolveResourceUrl(reference.storageKey, reference.url) || reference.url || "";
}

export function creationAttachmentsFromReferences(references: StandaloneMediaReference[]): CreationAttachment[] {
    return references.map((reference) => {
        const url = resolvedUrl(reference);
        if (reference.type.startsWith("video/")) {
            return {
                id: reference.id,
                name: reference.name,
                type: reference.type,
                url,
                storageKey: reference.storageKey,
                bytes: reference.bytes,
                width: reference.width,
                height: reference.height,
                durationMs: reference.durationMs,
                previewUrl: url,
            };
        }
        if (reference.type.startsWith("audio/")) {
            return {
                id: reference.id,
                name: reference.name,
                type: reference.type,
                url,
                storageKey: reference.storageKey,
                bytes: reference.bytes,
                durationMs: reference.durationMs,
                previewUrl: url,
            };
        }
        return {
            id: reference.id,
            name: reference.name,
            type: reference.type,
            dataUrl: url,
            url,
            storageKey: reference.storageKey,
            bytes: reference.bytes,
            width: reference.width,
            height: reference.height,
            previewUrl: url,
            arkAssetId: reference.arkAssetId,
        };
    });
}

export function referenceImagesFromStandalone(references: StandaloneMediaReference[]): ReferenceImage[] {
    return creationAttachmentsFromReferences(references).flatMap((attachment) => {
        if (!attachment.type.startsWith("image/")) return [];
        const url = attachment.previewUrl || ("dataUrl" in attachment ? attachment.dataUrl : attachment.url) || "";
        return [{
            id: attachment.id,
            name: attachment.name,
            type: attachment.type,
            dataUrl: url,
            url: attachment.url,
            storageKey: attachment.storageKey,
            bytes: attachment.bytes,
            width: "width" in attachment ? attachment.width : undefined,
            height: "height" in attachment ? attachment.height : undefined,
            arkAssetId: "arkAssetId" in attachment ? attachment.arkAssetId : undefined,
        }];
    });
}

export function referenceVideosFromStandalone(references: StandaloneMediaReference[]): ReferenceVideo[] {
    return creationAttachmentsFromReferences(references).flatMap((attachment) => {
        if (!attachment.type.startsWith("video/")) return [];
        return [{
            id: attachment.id,
            name: attachment.name,
            type: attachment.type,
            url: attachment.url,
            storageKey: attachment.storageKey,
            bytes: attachment.bytes,
            width: "width" in attachment ? attachment.width : undefined,
            height: "height" in attachment ? attachment.height : undefined,
            durationMs: "durationMs" in attachment ? attachment.durationMs : undefined,
        }];
    });
}

export function referenceAudiosFromStandalone(references: StandaloneMediaReference[]): ReferenceAudio[] {
    return creationAttachmentsFromReferences(references).flatMap((attachment) => {
        if (!attachment.type.startsWith("audio/")) return [];
        return [{
            id: attachment.id,
            name: attachment.name,
            type: attachment.type,
            url: attachment.url,
            storageKey: attachment.storageKey,
            bytes: attachment.bytes,
            durationMs: "durationMs" in attachment ? attachment.durationMs : undefined,
        }];
    });
}
