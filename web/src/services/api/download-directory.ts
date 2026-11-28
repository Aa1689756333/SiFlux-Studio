import { http } from "./request";

export type DownloadDirectoryState = {
    directory: string;
    default: string;
};

export function fetchDownloadDirectory(signal?: AbortSignal) {
    return http.get<DownloadDirectoryState>("/downloads/directory", { signal });
}

export function saveDownloadDirectory(directory: string, signal?: AbortSignal) {
    return http.put<{ directory: string }>("/downloads/directory", { directory }, { signal });
}

/** 把图片写入设置好的下载目录，返回落盘路径。 */
export async function saveImageToDownloadDirectory(blob: Blob, name: string, signal?: AbortSignal) {
    const form = new FormData();
    form.append("file", blob, name);
    form.append("name", name);
    return http.post<{ path: string; directory: string }>("/downloads/save", form, { signal });
}