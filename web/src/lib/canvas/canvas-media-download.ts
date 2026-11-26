import { type CanvasNodeData } from "@/types/canvas";

const FILE_NAME_PART_LIMIT = 80;

const MIME_EXTENSIONS: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "image/avif": "avif",
    "image/bmp": "bmp",
    "image/tiff": "tiff",
};

const CONTENT_EXTENSIONS = new Set(Object.values(MIME_EXTENSIONS));

export function buildCanvasMediaDownloadFileName(canvasTitle: string, node: CanvasNodeData, now = new Date()) {
    const canvasName = safeFileNamePart(canvasTitle, "未命名画布");
    const nodeName = safeFileNamePart(node.title, defaultNodeName());
    return `${canvasName}_${nodeName}_${formatDownloadDate(now)}.${canvasMediaFileExtension(node)}`;
}

export function sanitizeDownloadFileName(value: string, fallback = "未命名文件") {
    const leaf = value.trim().replace(/\\/g, "/").split("/").pop() || "";
    const lastDot = leaf.lastIndexOf(".");
    const extension = lastDot > 0 ? leaf.slice(lastDot + 1) : "";
    const base = lastDot > 0 ? leaf.slice(0, lastDot) : leaf;
    const safeBase = safeFileNamePart(base, fallback);
    if (!extension || !/^[a-z0-9]{1,8}$/i.test(extension)) return safeBase;
    return `${safeBase}.${extension.toLowerCase() === "jpeg" ? "jpg" : extension.toLowerCase()}`;
}

export function canvasMediaFileExtension(node: CanvasNodeData) {
    return mediaFileExtension(node.metadata?.mimeType, node.metadata?.content)
        || defaultExtension();
}

export function mediaFileExtension(mimeType?: string, content?: string) {
    return extensionFromMimeType(mimeType) || extensionFromContent(content);
}

function extensionFromMimeType(mimeType?: string) {
    const normalized = mimeType?.split(";", 1)[0]?.trim().toLowerCase();
    return normalized ? MIME_EXTENSIONS[normalized] : undefined;
}

function extensionFromContent(content?: string) {
    if (!content) return undefined;
    const dataMimeType = content.match(/^data:([^;,]+)/i)?.[1];
    const dataExtension = extensionFromMimeType(dataMimeType);
    if (dataExtension) return dataExtension;
    const path = content.split(/[?#]/, 1)[0];
    const extension = path.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    if (!extension || !CONTENT_EXTENSIONS.has(extension)) return undefined;
    if (extension === "jpeg") return "jpg";
    return extension;
}

function safeFileNamePart(value: string, fallback: string) {
    const normalized = value
        .trim()
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
        .replace(/_+/g, "_")
        .replace(/\s+/g, " ")
        .replace(/^_+|_+$/g, "")
        .slice(0, FILE_NAME_PART_LIMIT)
        .replace(/[. ]+$/g, "");
    if (!normalized) return fallback;
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(normalized) ? `_${normalized}` : normalized;
}

function formatDownloadDate(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
}

function defaultNodeName(): string {
    return "图片节点";
}

function defaultExtension(): string {
    return "png";
}
