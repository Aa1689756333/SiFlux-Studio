const LIBTV_RESOURCE_HOST = "libtv-res.liblib.art";
const LIBTV_PREVIEW_WIDTH = 960;

export function buildLibTVImagePreviewUrl(rawUrl: string) {
    try {
        const url = new URL(rawUrl);
        if (url.protocol !== "https:" || url.hostname !== LIBTV_RESOURCE_HOST) return rawUrl;
        if (!url.searchParams.has("x-oss-process")) {
            url.searchParams.set("x-oss-process", `image/resize,w_${LIBTV_PREVIEW_WIDTH}`);
        }
        return url.toString();
    } catch {
        return rawUrl;
    }
}
