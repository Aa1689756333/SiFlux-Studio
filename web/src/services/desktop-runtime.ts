import { configureApiRuntime } from "@/services/api/request";

export type DesktopRuntimeConfig = {
    baseURL: string;
    launchToken: string;
    uiBootstrapToken?: string;
};

export const DESKTOP_UPDATE_STATUSES = ["disabled", "idle", "checking", "available", "downloading", "ready", "installing", "error"] as const;

export type DesktopUpdateStatus = (typeof DESKTOP_UPDATE_STATUSES)[number];

export type DesktopUpdateState = {
	phase?: "downloading" | "verifying" | "extracting" | "preparing" | "restarting";
	completedFiles?: number;
	totalFiles?: number;
    installPrepared?: boolean;
    status: DesktopUpdateStatus;
    currentVersion: string;
    latestVersion: string;
    releaseNotes: string;
    downloadedBytes: number;
    totalBytes: number;
    bytesPerSecond: number;
    reconnecting: boolean;
    error: string;
};

export type DesktopRuntimeBinding = {
	ReferenceStorageSettings?: () => Promise<ReferenceStorageConfig>;
	SaveReferenceStorage?: (config: ReferenceStorageConfig & { secretAccessKey: string }) => Promise<ReferenceStorageConfig>;
	UploadReferenceMedia?: (ids: string[]) => Promise<Record<string,string>>;
	StorageSettings?: () => Promise<DesktopStorageUsage>;
	ChooseStorageDirectory?: () => Promise<string>;
	MigrateStorage?: (target: string) => Promise<DesktopStorageUsage>;
	CleanupPreviousStorage?: () => Promise<DesktopStorageUsage>;
    RuntimeConfig: () => Promise<DesktopRuntimeConfig>;
    SaveOwnedMedia?: (fileName: string, resourceID: string) => Promise<boolean>;
    SaveOwnedArtifact?: (fileName: string, data: string) => Promise<boolean>;
    UpdateStatus?: () => Promise<DesktopUpdateState>;
    CheckForUpdate?: () => Promise<DesktopUpdateState>;
    DownloadUpdate?: () => Promise<DesktopUpdateState>;
    InstallUpdate?: () => Promise<void>;
    ConfirmUpdateStartup?: () => Promise<void>;
    OpenSiFluxWebsite?: () => Promise<void>;
};

export type DesktopStorageUsage = { dataDir: string; usedBytes: number; freeBytes: number; previousDir?: string; previousBytes?: number };
export type ReferenceStorageConfig = { enabled: boolean; endpoint: string; bucket: string; region: string; accessKeyId: string; publicBaseURL: string; hasSecret: boolean };

declare global {
    interface Window {
        go?: {
            main?: {
                DesktopApp?: DesktopRuntimeBinding;
            };
        };
    }
}

export function getDesktopAppBinding(): DesktopRuntimeBinding | undefined {
    return window.go?.main?.DesktopApp;
}

let nativeFetch: typeof fetch | undefined;

/**
 * 桌面判定：macOS 的 Wails 用 wails: 方案，Windows 的 WebView2 服务在
 * http://wails.localhost 并注入 Go 绑定（参见 services/api/custom-channel-relay.ts）。
 */
export function isDesktopRuntime() {
    return Boolean(getDesktopAppBinding()) || window.location?.protocol === "wails:";
}

export type DesktopRelayImport = { name: string; baseUrl: string; apiKey: string };

/**
 * 取走待确认的一键导入。后端取一次即清空，所以轮询是安全的；
 * 非桌面环境（开发模式的浏览器）没有这个路由，直接返回 undefined。
 */
export async function takePendingRelayImport(): Promise<DesktopRelayImport | undefined> {
    if (!isDesktopRuntime()) return undefined;
    const response = await fetch("/__desktop/relay-import", { cache: "no-store" });
    if (!response.ok) return undefined;
    const candidate: unknown = await response.json();
    if (!candidate || typeof candidate !== "object") return undefined;
    const payload = candidate as Partial<DesktopRelayImport>;
    if (typeof payload.baseUrl !== "string" || typeof payload.apiKey !== "string") return undefined;
    const baseUrl = payload.baseUrl.trim();
    const apiKey = payload.apiKey.trim();
    if (!baseUrl || !apiKey) return undefined;
    return { name: typeof payload.name === "string" ? payload.name : "", baseUrl, apiKey };
}

function isDesktopRuntimeConfig(value: unknown): value is DesktopRuntimeConfig {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<DesktopRuntimeConfig>;
    return /^http:\/\/127\.0\.0\.1:\d+\/api$/u.test(candidate.baseURL ?? "") && Boolean(candidate.launchToken);
}

export function configureDesktopRuntime(config: DesktopRuntimeConfig) {
    const baseURL = config.baseURL.replace(/\/+$/u, "");
    configureApiRuntime(baseURL, config.launchToken, config.uiBootstrapToken);
    if (!nativeFetch) nativeFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        if (request.url === baseURL || request.url.startsWith(`${baseURL}/`)) {
            const headers = new Headers(request.headers);
            headers.set("X-Desktop-Token", config.launchToken);
            return nativeFetch!(new Request(request, { headers }));
        }
        return nativeFetch!(request);
    }) as typeof fetch;
}

export async function bootstrapDesktopRuntime() {
    const binding = window.go?.main?.DesktopApp;
    let config: DesktopRuntimeConfig | undefined;
    if (binding) {
        try {
            const candidate = await binding.RuntimeConfig();
            if (isDesktopRuntimeConfig(candidate)) config = candidate;
        } catch {
            // Wails can expose the WebView before generated bindings settle.
        }
    }
    if (!config && window.location?.protocol === "wails:") {
        const response = await fetch("/__desktop/runtime-config", { cache: "no-store" });
        if (!response.ok) throw new Error(`Desktop runtime bootstrap failed: ${response.status}`);
        const candidate = await response.json();
        if (isDesktopRuntimeConfig(candidate)) config = candidate;
    }
    if (!config) return false;
    configureDesktopRuntime(config);
    return true;
}
