import { localForageStorageForScope } from "@/lib/localforage-storage";
import { parseStandaloneMediaReferences, type StandaloneMediaReference } from "@/lib/standalone-generation-reference";
import { getActiveUserScope } from "@/lib/user-scope";

export const STANDALONE_IMAGE_HISTORY_KEY = "standalone-image-history-v1";
const MAX_HISTORY_JOBS = 100;

export type ImageGenerationJobStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled" | "retrievable";

export type ImageGenerationJob = {
    id: string;
    createdAt: string;
    updatedAt: string;
    prompt: string;
    model: string;
    ratio: string;
    quality: string;
    count: number;
    status: ImageGenerationJobStatus;
    taskIds: string[];
    assetIds: string[];
    references?: StandaloneMediaReference[];
    error?: string;
    generationErrorCode?: string;
};

function isStatus(value: unknown): value is ImageGenerationJobStatus {
    return value === "pending" || value === "running" || value === "succeeded" || value === "failed" || value === "cancelled" || value === "retrievable";
}

export function parseImageGenerationHistory(raw: unknown): ImageGenerationJob[] {
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
            ratio: typeof record.ratio === "string" ? record.ratio : "1:1",
            quality: typeof record.quality === "string" ? record.quality : "auto",
            count: Math.max(1, Math.min(15, Math.floor(Number(record.count) || 1))),
            status: isStatus(record.status) ? record.status : "failed",
            taskIds: Array.isArray(record.taskIds) ? record.taskIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0) : [],
            assetIds: Array.isArray(record.assetIds) ? record.assetIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0) : [],
            references: parseStandaloneMediaReferences(record.references),
            error: typeof record.error === "string" ? record.error : undefined,
            generationErrorCode: typeof record.generationErrorCode === "string" ? record.generationErrorCode : undefined,
        }];
    });
}

export function upsertImageGenerationJob(jobs: ImageGenerationJob[], next: ImageGenerationJob) {
    const remaining = jobs.filter((job) => job.id !== next.id);
    return [next, ...remaining].slice(0, MAX_HISTORY_JOBS);
}

export function removeImageGenerationJob(jobs: ImageGenerationJob[], jobId: string) {
    return jobs.filter((job) => job.id !== jobId);
}

export function imageGenerationJobCanRetrieve(job: Pick<ImageGenerationJob, "status" | "taskIds">) {
    return job.taskIds.length > 0 && (job.status === "retrievable" || job.status === "cancelled" || job.status === "running");
}

export async function loadImageGenerationHistory(scope = getActiveUserScope()) {
    const storage = localForageStorageForScope(scope);
    const raw = await storage.getItem(STANDALONE_IMAGE_HISTORY_KEY);
    if (!raw) return [];
    try {
        return parseImageGenerationHistory(JSON.parse(raw) as unknown);
    } catch {
        return [];
    }
}

export async function saveImageGenerationHistory(jobs: ImageGenerationJob[], scope = getActiveUserScope()) {
    const storage = localForageStorageForScope(scope);
    await storage.setItem(STANDALONE_IMAGE_HISTORY_KEY, JSON.stringify(parseImageGenerationHistory(jobs)));
}
