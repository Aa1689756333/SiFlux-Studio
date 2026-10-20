import { explainGenerationError, generationErrorMessage } from "@/lib/generation-error";
import { createStandaloneGenerationStore } from "@/lib/standalone-generation-store";
import { referenceAudiosFromStandalone, referenceImagesFromStandalone, referenceVideosFromStandalone, type StandaloneMediaReference } from "@/lib/standalone-generation-reference";
import { captureUserScope, userScopeMatches } from "@/lib/user-scope-guard";
import { isGenerationTaskCancelled } from "@/services/api/generation-task";
import type { AiConfig } from "@/stores/use-config-store";

import {
    loadVideoGenerationHistory,
    removeVideoGenerationJob,
    saveVideoGenerationHistory,
    upsertVideoGenerationJob,
    type VideoGenerationJob,
} from "./generate-video-history";
import { resumeStandaloneVideoGeneration, runStandaloneVideoGeneration, videoGenerationErrorIsRetrievable } from "./generate-video-run";

const store = createStandaloneGenerationStore({
    load: loadVideoGenerationHistory,
    save: saveVideoGenerationHistory,
    upsert: upsertVideoGenerationJob,
    remove: removeVideoGenerationJob,
});

store.setResumeHandler((job) => {
    void resumeStandaloneVideoJob(job);
});

export const subscribeStandaloneVideo = store.subscribe;
export const getStandaloneVideoSnapshot = store.getSnapshot;
export const hydrateStandaloneVideo = store.hydrate;
export const deleteStandaloneVideoJob = store.deleteJob;
export const stopStandaloneVideoJob = store.stopJob;
export const setStandaloneVideoErrorHandler = store.setErrorHandler;

function nowIso() {
    return new Date().toISOString();
}

export async function runStandaloneVideoJob(options: {
    retryJob?: VideoGenerationJob;
    prompt: string;
    config: AiConfig;
    model: string;
    ratio: string;
    videoQuality: string;
    seconds: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    references: StandaloneMediaReference[];
}) {
    const prompt = options.prompt.trim();
    if (!prompt) throw new Error("请先填写提示词");
    const retryJob = options.retryJob;
    if (retryJob && store.hasTurn(retryJob.id)) return retryJob.id;
    const job: VideoGenerationJob = retryJob
        ? { ...retryJob, status: "running", updatedAt: nowIso(), error: undefined, generationErrorCode: undefined }
        : {
            id: crypto.randomUUID(),
            createdAt: nowIso(),
            updatedAt: nowIso(),
            prompt,
            model: options.model,
            ratio: options.ratio,
            videoQuality: options.videoQuality,
            seconds: options.seconds,
            videoGenerateAudio: options.videoGenerateAudio,
            videoWatermark: options.videoWatermark,
            status: "running",
            taskIds: [],
            assetIds: [],
            references: options.references,
        };
    const controller = store.beginTurn(job.id);
    if (!controller) return job.id;
    const expectedScope = captureUserScope();
    store.upsertJob(job);
    const references = job.references || [];
    try {
        const result = await runStandaloneVideoGeneration({
            prompt,
            config: options.config,
            model: job.model,
            ratio: job.ratio,
            videoQuality: job.videoQuality,
            seconds: job.seconds,
            videoGenerateAudio: job.videoGenerateAudio,
            videoWatermark: job.videoWatermark,
            referenceImages: referenceImagesFromStandalone(references),
            referenceVideos: referenceVideosFromStandalone(references),
            referenceAudios: referenceAudiosFromStandalone(references),
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
        const retrievable = videoGenerationErrorIsRetrievable(error, latest.taskIds);
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

export async function resumeStandaloneVideoJob(job: VideoGenerationJob) {
    if (!job.taskIds.length || store.hasTurn(job.id)) return job.id;
    const controller = store.beginTurn(job.id);
    if (!controller) return job.id;
    const expectedScope = captureUserScope();
    store.patchJob(job.id, (current) => ({ ...current, status: "running", updatedAt: nowIso() }));
    try {
        const assetIds = await resumeStandaloneVideoGeneration(job.taskIds, controller.signal, expectedScope);
        if (!userScopeMatches(expectedScope) || !store.job(job.id)) return job.id;
        store.patchJob(job.id, (current) => ({ ...current, status: "succeeded", assetIds, error: undefined, generationErrorCode: undefined, updatedAt: nowIso() }));
    } catch (error) {
        if (!userScopeMatches(expectedScope) || !store.job(job.id)) return job.id;
        if (isGenerationTaskCancelled(error, controller.signal)) {
            store.patchJob(job.id, (current) => ({ ...current, status: "retrievable", updatedAt: nowIso() }));
            return job.id;
        }
        const retrievable = videoGenerationErrorIsRetrievable(error, job.taskIds);
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
