import { explainGenerationError, generationErrorMessage } from "@/lib/generation-error";
import { createStandaloneGenerationStore } from "@/lib/standalone-generation-store";
import { referenceImagesFromStandalone, type StandaloneMediaReference } from "@/lib/standalone-generation-reference";
import { captureUserScope, userScopeMatches } from "@/lib/user-scope-guard";
import { isGenerationTaskCancelled } from "@/services/api/generation-task";
import type { AiConfig } from "@/stores/use-config-store";

import {
    loadImageGenerationHistory,
    removeImageGenerationJob,
    saveImageGenerationHistory,
    upsertImageGenerationJob,
    type ImageGenerationJob,
} from "./generate-image-history";
import { imageGenerationErrorIsRetrievable, resumeStandaloneImageGeneration, runStandaloneImageGeneration } from "./generate-image-run";

const store = createStandaloneGenerationStore({
    load: loadImageGenerationHistory,
    save: saveImageGenerationHistory,
    upsert: upsertImageGenerationJob,
    remove: removeImageGenerationJob,
});

store.setResumeHandler((job) => {
    void resumeStandaloneImageJob(job);
});

export const subscribeStandaloneImage = store.subscribe;
export const getStandaloneImageSnapshot = store.getSnapshot;
export const hydrateStandaloneImage = store.hydrate;
export const deleteStandaloneImageJob = store.deleteJob;
export const stopStandaloneImageJob = store.stopJob;
export const setStandaloneImageErrorHandler = store.setErrorHandler;

function nowIso() {
    return new Date().toISOString();
}

export async function runStandaloneImageJob(options: {
    retryJob?: ImageGenerationJob;
    prompt: string;
    config: AiConfig;
    model: string;
    ratio: string;
    quality: string;
    count: number;
    references: StandaloneMediaReference[];
}) {
    const prompt = options.prompt.trim();
    if (!prompt) throw new Error("请先填写提示词");
    const retryJob = options.retryJob;
    if (retryJob && store.hasTurn(retryJob.id)) return retryJob.id;
    const job: ImageGenerationJob = retryJob
        ? { ...retryJob, status: "running", updatedAt: nowIso(), error: undefined, generationErrorCode: undefined }
        : {
            id: crypto.randomUUID(),
            createdAt: nowIso(),
            updatedAt: nowIso(),
            prompt,
            model: options.model,
            ratio: options.ratio,
            quality: options.quality,
            count: Math.max(1, Math.floor(options.count) || 1),
            status: "running",
            taskIds: [],
            assetIds: [],
            references: options.references,
        };
    const controller = store.beginTurn(job.id);
    if (!controller) return job.id;
    const expectedScope = captureUserScope();
    store.upsertJob(job);
    try {
        const result = await runStandaloneImageGeneration({
            prompt,
            config: options.config,
            model: job.model,
            ratio: job.ratio,
            quality: job.quality,
            count: job.count,
            referenceImages: referenceImagesFromStandalone(job.references || []),
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
        const retrievable = imageGenerationErrorIsRetrievable(error, latest.taskIds);
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

export async function resumeStandaloneImageJob(job: ImageGenerationJob) {
    if (!job.taskIds.length || store.hasTurn(job.id)) return job.id;
    const controller = store.beginTurn(job.id);
    if (!controller) return job.id;
    const expectedScope = captureUserScope();
    store.patchJob(job.id, (current) => ({ ...current, status: "running", updatedAt: nowIso() }));
    try {
        const assetIds = await resumeStandaloneImageGeneration(job.taskIds, controller.signal, expectedScope);
        if (!userScopeMatches(expectedScope) || !store.job(job.id)) return job.id;
        store.patchJob(job.id, (current) => ({ ...current, status: "succeeded", assetIds, error: undefined, generationErrorCode: undefined, updatedAt: nowIso() }));
    } catch (error) {
        if (!userScopeMatches(expectedScope) || !store.job(job.id)) return job.id;
        if (isGenerationTaskCancelled(error, controller.signal)) {
            store.patchJob(job.id, (current) => ({ ...current, status: "retrievable", updatedAt: nowIso() }));
            return job.id;
        }
        const retrievable = imageGenerationErrorIsRetrievable(error, job.taskIds);
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
