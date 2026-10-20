import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";

export const STANDALONE_AUDIO_HISTORY_KEY = "standalone-audio-history-v1";
const MAX_HISTORY_JOBS = 100;

export type AudioGenerationJobStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled" | "retrievable";

export type AudioGenerationJob = {
    id: string;
    createdAt: string;
    updatedAt: string;
    prompt: string;
    model: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioPitch: string;
    audioVolume: string;
    audioInstructions: string;
    status: AudioGenerationJobStatus;
    taskIds: string[];
    assetIds: string[];
    error?: string;
    generationErrorCode?: string;
};

function isStatus(value: unknown): value is AudioGenerationJobStatus {
    return value === "pending" || value === "running" || value === "succeeded" || value === "failed" || value === "cancelled" || value === "retrievable";
}

export function parseAudioGenerationHistory(raw: unknown): AudioGenerationJob[] {
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
            audioVoice: typeof record.audioVoice === "string" ? record.audioVoice : "",
            audioFormat: typeof record.audioFormat === "string" ? record.audioFormat : "mp3",
            audioSpeed: typeof record.audioSpeed === "string" ? record.audioSpeed : "1",
            audioPitch: typeof record.audioPitch === "string" ? record.audioPitch : "0",
            audioVolume: typeof record.audioVolume === "string" ? record.audioVolume : "1",
            audioInstructions: typeof record.audioInstructions === "string" ? record.audioInstructions : "",
            status: isStatus(record.status) ? record.status : "failed",
            taskIds: Array.isArray(record.taskIds) ? record.taskIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0) : [],
            assetIds: Array.isArray(record.assetIds) ? record.assetIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0) : [],
            error: typeof record.error === "string" ? record.error : undefined,
            generationErrorCode: typeof record.generationErrorCode === "string" ? record.generationErrorCode : undefined,
        }];
    });
}

export function upsertAudioGenerationJob(jobs: AudioGenerationJob[], next: AudioGenerationJob) {
    const remaining = jobs.filter((job) => job.id !== next.id);
    return [next, ...remaining].slice(0, MAX_HISTORY_JOBS);
}

export function removeAudioGenerationJob(jobs: AudioGenerationJob[], jobId: string) {
    return jobs.filter((job) => job.id !== jobId);
}

export function audioGenerationJobCanRetrieve(job: Pick<AudioGenerationJob, "status" | "taskIds">) {
    return job.taskIds.length > 0 && (job.status === "retrievable" || job.status === "cancelled" || job.status === "running");
}

export async function loadAudioGenerationHistory(scope = getActiveUserScope()) {
    const storage = localForageStorageForScope(scope);
    const raw = await storage.getItem(STANDALONE_AUDIO_HISTORY_KEY);
    if (!raw) return [];
    try {
        return parseAudioGenerationHistory(JSON.parse(raw) as unknown);
    } catch {
        return [];
    }
}

export async function saveAudioGenerationHistory(jobs: AudioGenerationJob[], scope = getActiveUserScope()) {
    const storage = localForageStorageForScope(scope);
    await storage.setItem(STANDALONE_AUDIO_HISTORY_KEY, JSON.stringify(parseAudioGenerationHistory(jobs)));
}
