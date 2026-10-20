import { localForageStorageForScope } from "@/lib/localforage-storage";
import { parseStandaloneMediaReferences, type StandaloneMediaReference } from "@/lib/standalone-generation-reference";
import { getActiveUserScope } from "@/lib/user-scope";

export const STANDALONE_VIDEO_HISTORY_KEY = "standalone-video-history-v1";
const MAX_HISTORY_JOBS = 100;

export type VideoGenerationJobStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled" | "retrievable";

export type VideoGenerationJob = {
    id: string;
    createdAt: string;
    updatedAt: string;
    prompt: string;
    model: string;
    ratio: string;
    videoQuality: string;
    seconds: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    status: VideoGenerationJobStatus;
    taskIds: string[];
    assetIds: string[];
    references?: StandaloneMediaReference[];
    error?: string;
    generationErrorCode?: string;
};

function isStatus(value: unknown): value is VideoGenerationJobStatus {
    return value === "pending" || value === "running" || value === "succeeded" || value === "failed" || value === "cancelled" || value === "retrievable";
}

export function parseVideoGenerationHistory(raw: unknown): VideoGenerationJob[] {
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const record = item as Record<string, unknown>;
        const id = typeof record.id === "string" ? record.id.trim() : "";
        const prompt = typeof record.prompt === "string" ? record.prompt : "";
        const model = typeof record.model === "string" ? record.model : "";
        if (!id) return [];
        const createdAt = typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString();
        return [{
            id,
            createdAt,
            updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : createdAt,
            prompt,
            model,
            ratio: typeof record.ratio === "string" ? record.ratio : "16:9",
            videoQuality: typeof record.videoQuality === "string" ? record.videoQuality : "",
            seconds: typeof record.seconds === "string" ? record.seconds : "5",
            videoGenerateAudio: typeof record.videoGenerateAudio === "string" ? record.videoGenerateAudio : "false",
            videoWatermark: typeof record.videoWatermark === "string" ? record.videoWatermark : "false",
            status: isStatus(record.status) ? record.status : "failed",
            taskIds: Array.isArray(record.taskIds) ? record.taskIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0) : [],
            assetIds: Array.isArray(record.assetIds) ? record.assetIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0) : [],
            references: parseStandaloneMediaReferences(record.references),
            error: typeof record.error === "string" ? record.error : undefined,
            generationErrorCode: typeof record.generationErrorCode === "string" ? record.generationErrorCode : undefined,
        }];
    });
}

export function upsertVideoGenerationJob(jobs: VideoGenerationJob[], next: VideoGenerationJob) {
    const remaining = jobs.filter((job) => job.id !== next.id);
    return [next, ...remaining].slice(0, MAX_HISTORY_JOBS);
}

export function removeVideoGenerationJob(jobs: VideoGenerationJob[], jobId: string) {
    return jobs.filter((job) => job.id !== jobId);
}

export function videoGenerationJobCanRetrieve(job: Pick<VideoGenerationJob, "status" | "taskIds">) {
    return job.taskIds.length > 0 && (job.status === "retrievable" || job.status === "cancelled" || job.status === "running");
}

export async function loadVideoGenerationHistory(scope = getActiveUserScope()) {
    const storage = localForageStorageForScope(scope);
    const raw = await storage.getItem(STANDALONE_VIDEO_HISTORY_KEY);
    if (!raw) return [];
    try {
        return parseVideoGenerationHistory(JSON.parse(raw) as unknown);
    } catch {
        return [];
    }
}

export async function saveVideoGenerationHistory(jobs: VideoGenerationJob[], scope = getActiveUserScope()) {
    const storage = localForageStorageForScope(scope);
    await storage.setItem(STANDALONE_VIDEO_HISTORY_KEY, JSON.stringify(parseVideoGenerationHistory(jobs)));
}
