import { resolveResourceUrl } from "@/services/api/resources";
import type { ReferenceImage } from "@/types/image";

export type StandaloneImageReference = {
    id: string;
    name: string;
    type: string;
    url?: string;
    storageKey?: string;
    bytes?: number;
    width?: number;
    height?: number;
    arkAssetId?: string;
};

export type GenerationAttachment = ReferenceImage & { previewUrl: string };

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

export function persistableMediaReference(attachment: GenerationAttachment): StandaloneImageReference | null {
    const storageKey = optionalString(attachment.storageKey);
    const rawUrl = persistableUrl(attachment.url || attachment.dataUrl || attachment.previewUrl);
    if (!storageKey && !rawUrl) return null;
    const next: StandaloneImageReference = {
        id: attachment.id,
        name: attachment.name,
        type: attachment.type,
    };
    if (rawUrl) next.url = rawUrl;
    if (storageKey) next.storageKey = storageKey;
    const bytes = optionalNumber(attachment.bytes);
    const width = optionalNumber(attachment.width);
    const height = optionalNumber(attachment.height);
    const arkAssetId = optionalString(attachment.arkAssetId);
    if (bytes != null) next.bytes = bytes;
    if (width != null) next.width = width;
    if (height != null) next.height = height;
    if (arkAssetId) next.arkAssetId = arkAssetId;
    return next;
}

export function persistableMediaReferences(attachments: GenerationAttachment[]) {
    return attachments.flatMap((attachment) => {
        const next = persistableMediaReference(attachment);
        return next ? [next] : [];
    });
}

export function parseStandaloneMediaReferences(raw: unknown): StandaloneImageReference[] {
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
        const next: StandaloneImageReference = { id, name, type };
        if (url) next.url = url;
        if (storageKey) next.storageKey = storageKey;
        const bytes = optionalNumber(record.bytes);
        const width = optionalNumber(record.width);
        const height = optionalNumber(record.height);
        const arkAssetId = optionalString(record.arkAssetId);
        if (bytes != null) next.bytes = bytes;
        if (width != null) next.width = width;
        if (height != null) next.height = height;
        if (arkAssetId) next.arkAssetId = arkAssetId;
        return [next];
    });
}

function resolvedUrl(reference: StandaloneImageReference) {
    return resolveResourceUrl(reference.storageKey, reference.url) || reference.url || "";
}

export function creationAttachmentsFromReferences(references: StandaloneImageReference[]): GenerationAttachment[] {
    return references.map((reference) => {
        const url = resolvedUrl(reference);
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

export function referenceImagesFromStandalone(references: StandaloneImageReference[]): ReferenceImage[] {
    return references.map((reference) => {
        const url = resolvedUrl(reference);
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
            arkAssetId: reference.arkAssetId,
        };
    });
}
