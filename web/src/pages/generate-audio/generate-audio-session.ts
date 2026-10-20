import { explainGenerationError, generationErrorMessage } from "@/lib/generation-error";
import { createStandaloneGenerationStore } from "@/lib/standalone-generation-store";
import { captureUserScope, userScopeMatches } from "@/lib/user-scope-guard";
import { isGenerationTaskCancelled } from "@/services/api/generation-task";
import type { AiConfig } from "@/stores/use-config-store";

import {
    loadAudioGenerationHistory,
    removeAudioGenerationJob,
    saveAudioGenerationHistory,
    upsertAudioGenerationJob,
    type AudioGenerationJob,
} from "./generate-audio-history";
import { audioGenerationErrorIsRetrievable, resumeStandaloneAudioGeneration, runStandaloneAudioGeneration } from "./generate-audio-run";

const store = createStandaloneGenerationStore({
    load: loadAudioGenerationHistory,
    save: saveAudioGenerationHistory,
    upsert: upsertAudioGenerationJob,
    remove: removeAudioGenerationJob,
});

store.setResumeHandler((job) => {
    void resumeStandaloneAudioJob(job);
});

export const subscribeStandaloneAudio = store.subscribe;
export const getStandaloneAudioSnapshot = store.getSnapshot;
export const hydrateStandaloneAudio = store.hydrate;
export const deleteStandaloneAudioJob = store.deleteJob;
export const stopStandaloneAudioJob = store.stopJob;
export const setStandaloneAudioErrorHandler = store.setErrorHandler;

function nowIso() {
    return new Date().toISOString();
}

export async function runStandaloneAudioJob(options: {
    retryJob?: AudioGenerationJob;
    prompt: string;
    config: AiConfig;
    model: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioPitch: string;
    audioVolume: string;
    audioInstructions: string;
}) {
    const prompt = options.prompt.trim();
    if (!prompt) throw new Error("请先填写提示词");
    const retryJob = options.retryJob;
    if (retryJob && store.hasTurn(retryJob.id)) return retryJob.id;
    const job: AudioGenerationJob = retryJob
        ? { ...retryJob, status: "running", updatedAt: nowIso(), error: undefined, generationErrorCode: undefined }
        : {
            id: crypto.randomUUID(),
            createdAt: nowIso(),
            updatedAt: nowIso(),
            prompt,
            model: options.model,
            audioVoice: options.audioVoice,
            audioFormat: options.audioFormat,
            audioSpeed: options.audioSpeed,
            audioPitch: options.audioPitch,
            audioVolume: options.audioVolume,
            audioInstructions: options.audioInstructions,
            status: "running",
            taskIds: [],
            assetIds: [],
        };
    const controller = store.beginTurn(job.id);
    if (!controller) return job.id;
    const expectedScope = captureUserScope();
    store.upsertJob(job);
    try {
        const result = await runStandaloneAudioGeneration({
            prompt,
            config: options.config,
            model: job.model,
            audioVoice: job.audioVoice,
            audioFormat: job.audioFormat,
            audioSpeed: job.audioSpeed,
            audioPitch: job.audioPitch,
            audioVolume: job.audioVolume,
            audioInstructions: job.audioInstructions,
            signal: controller.signal,
            expectedScope,
            onTaskIds: (taskIds) => {
                store.patchJob(job.id, (latest) => ({ ...latest, taskIds, status: "running", updatedAt: nowIso() }));
            },
        });
        if (!userScopeMatches(expectedScope) || !store.job(job.id)) return job.id;
        store.patchJob(job.id, (latest) => ({ ...latest, status: "succeeded", taskIds: result.taskIds, assetIds: result.assetIds, error: undefined, generationErrorCode: undefined, updatedAt: nowIso() }));
    } catch (error) {
        if (!userScopeMatches(expectedScope) || !store.job(job.id)) return job.id;
        const latest = store.job(job.id) || job;
        if (isGenerationTaskCancelled(error, controller.signal)) {
            store.patchJob(job.id, (current) => ({ ...current, status: current.taskIds.length ? "retrievable" : "cancelled", updatedAt: nowIso() }));
            return job.id;
        }
        const retrievable = audioGenerationErrorIsRetrievable(error, latest.taskIds);
        store.patchJob(job.id, (current) => ({
            ...current,
            status: retrievable ? "retrievable" : "failed",
            error: generationErrorMessage(error),
            generationErrorCode: explainGenerationError(error).errorCode,
            updatedAt: nowIso(),
        }));
        if (!retrievable) store.notifyError(generationErrorMessage(error));
    } finally {
        store.endTurn(job.id, controller);
    }
    return job.id;
}

export async function resumeStandaloneAudioJob(job: AudioGenerationJob) {
    if (!job.taskIds.length || store.hasTurn(job.id)) return job.id;
    const controller = store.beginTurn(job.id);
    if (!controller) return job.id;
    const expectedScope = captureUserScope();
    store.patchJob(job.id, (current) => ({ ...current, status: "running", updatedAt: nowIso() }));
    try {
        const assetIds = await resumeStandaloneAudioGeneration(job.taskIds, controller.signal, expectedScope);
        if (!userScopeMatches(expectedScope) || !store.job(job.id)) return job.id;
        store.patchJob(job.id, (current) => ({ ...current, status: "succeeded", assetIds, error: undefined, generationErrorCode: undefined, updatedAt: nowIso() }));
    } catch (error) {
        if (!userScopeMatches(expectedScope) || !store.job(job.id)) return job.id;
        if (isGenerationTaskCancelled(error, controller.signal)) {
            store.patchJob(job.id, (current) => ({ ...current, status: "retrievable", updatedAt: nowIso() }));
            return job.id;
        }
        const retrievable = audioGenerationErrorIsRetrievable(error, job.taskIds);
        store.patchJob(job.id, (current) => ({
            ...current,
            status: retrievable ? "retrievable" : "failed",
            error: generationErrorMessage(error),
            generationErrorCode: explainGenerationError(error).errorCode,
            updatedAt: nowIso(),
        }));
        if (!retrievable) store.notifyError(generationErrorMessage(error));
    } finally {
        store.endTurn(job.id, controller);
    }
    return job.id;
}
