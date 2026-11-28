const STORAGE_KEY = "siflux.download.directory";

type DirectoryHandle = {
    name: string;
    getFileHandle: (name: string, options?: { create?: boolean }) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>;
    queryPermission?: (options?: { mode: "readwrite" }) => Promise<PermissionState>;
    requestPermission?: (options?: { mode: "readwrite" }) => Promise<PermissionState>;
};

let directoryHandle: DirectoryHandle | null = null;

export function downloadDirectoryName() {
    if (directoryHandle) return directoryHandle.name;
    try {
        return window.localStorage.getItem(STORAGE_KEY) || "";
    } catch {
        return "";
    }
}

/** 让用户挑一个保存文件夹；不支持文件系统访问时返回空字符串。 */
export async function pickDownloadDirectory(): Promise<string> {
    const picker = (window as unknown as { showDirectoryPicker?: () => Promise<DirectoryHandle> }).showDirectoryPicker;
    if (!picker) throw new Error("当前环境不支持选择文件夹，将使用浏览器默认下载位置");
    const handle = await picker();
    const granted = await handle.requestPermission?.({ mode: "readwrite" });
    if (granted && granted !== "granted") throw new Error("没有获得该文件夹的写入权限");
    directoryHandle = handle;
    try {
        window.localStorage.setItem(STORAGE_KEY, handle.name);
    } catch {
        /* 忽略存储失败 */
    }
    return handle.name;
}

export function clearDownloadDirectory() {
    directoryHandle = null;
    try {
        window.localStorage.removeItem(STORAGE_KEY);
    } catch {
        /* 忽略存储失败 */
    }
}

/** 已选择文件夹时直接写入，返回是否成功。 */
export async function saveBlobToDownloadDirectory(blob: Blob, filename: string): Promise<boolean> {
    if (!directoryHandle) return false;
    try {
        const granted = await directoryHandle.queryPermission?.({ mode: "readwrite" });
        if (granted && granted !== "granted") return false;
        const file = await directoryHandle.getFileHandle(filename, { create: true });
        const writable = await file.createWritable();
        await writable.write(blob);
        await writable.close();
        return true;
    } catch {
        return false;
    }
}