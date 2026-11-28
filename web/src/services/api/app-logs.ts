import { http } from "./request";

export type AppLogEntry = {
    time: string;
    level: "info" | "warn" | "error";
    message: string;
};

export type AppLogMeta = {
    version: string;
    platform: string;
    logFile: string;
    exeDir: string;
};

export function fetchAppLogs(limit = 300, signal?: AbortSignal) {
    return http.get<{ entries: AppLogEntry[]; path: string }>(`/logs?limit=${limit}`, { signal });
}

export function fetchAppLogMeta(signal?: AbortSignal) {
    return http.get<AppLogMeta>("/logs/meta", { signal });
}