import { canvasImageReferenceLimitError } from "@/lib/canvas/canvas-project-generation";
import { explainGenerationError } from "@/lib/generation-error";
import { modelCapabilityConfigFor, normalizeImageValue } from "@/lib/model-capabilities";
import { mergedImageCapabilityConfig } from "@/lib/model-selection";
import { createGenerationTask, queryGenerationTask, waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { runBackendGenerationTaskBatch, type GenerationTaskDependencies } from "@/services/api/generation-task";
import { materializeGenerationTaskAssets } from "@/services/project-asset-sync";
import { captureUserScope, type CapturedUserScope } from "@/lib/user-scope-guard";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

export const IMAGE_GENERATION_WAIT_MS = 30 * 60 * 1000;
export const IMAGE_GENERATION_SOURCE = "standalone-image-page";

export function standaloneImageRequestConfig(config: AiConfig, model: string, ratio: string, quality: string, count: number): AiConfig {
    const profile = mergedImageCapabilityConfig(config, model);
    const normalized = normalizeImageValue(profile, { size: ratio, quality, count: String(count) });
    return {
        ...config,
        model,
        imageModel: model,
        size: normalized.size || ratio,
        quality: normalized.quality || quality,
        count: "1",
    };
}

export function standaloneImageReferenceLimitError(config: AiConfig, referenceImages: ReferenceImage[]) {
    return canvasImageReferenceLimitError(config, referenceImages);
}

export function imageGenerationWaitDependencies(): GenerationTaskDependencies {
    return {
        createTask: createGenerationTask,
        waitTask: (id, options) => waitForGenerationTask(id, { ...options, timeoutMs: IMAGE_GENERATION_WAIT_MS }),
        createId: () => crypto.randomUUID(),
    };
}

export function collectMaterializedImageAssetIds(task: Pick<GenerationTask, "outputs">) {
    return (task.outputs || []).flatMap((output) => (output.materializedAssetId ? [output.materializedAssetId] : []));
}

export function imageGenerationErrorIsRetrievable(error: unknown, taskIds: string[]) {
    if (!taskIds.length) return false;
    const explained = explainGenerationError(error);
    if (explained.category === "timeout" || explained.category === "download_failed" || explained.uncertain) return true;
    const text = error instanceof Error ? error.message : String(error);
    return text.includes("任务执行超时") || text.includes("任务状态同步失败");
}

export async function materializeStandaloneImageTasks(taskIds: string[], signal?: AbortSignal, expectedScope?: CapturedUserScope) {
    const scope = expectedScope ?? captureUserScope();
    const assetIds: string[] = [];
    for (const taskId of taskIds) {
        const waited = await waitForGenerationTask(taskId, { signal, expectedScope: scope, timeoutMs: IMAGE_GENERATION_WAIT_MS });
        const materialized = await materializeGenerationTaskAssets(waited, signal);
        assetIds.push(...collectMaterializedImageAssetIds(materialized));
    }
    return [...new Set(assetIds)];
}

export async function runStandaloneImageGeneration(options: {
    prompt: string;
    config: AiConfig;
    model: string;
    ratio: string;
    quality: string;
    count: number;
    referenceImages: ReferenceImage[];
    signal?: AbortSignal;
    expectedScope?: CapturedUserScope;
    onTaskIds?: (taskIds: string[]) => void;
}) {
    const prompt = options.prompt.trim();
    if (!prompt) throw new Error("请先填写提示词");
    const requestConfig = standaloneImageRequestConfig(options.config, options.model, options.ratio, options.quality, options.count);
    const limitError = standaloneImageReferenceLimitError(requestConfig, options.referenceImages);
    if (limitError) throw new Error(limitError);
    const expectedScope = options.expectedScope ?? captureUserScope();
    const taskIds: string[] = [];
    const count = Math.max(1, Math.min(modelCapabilityConfigFor(requestConfig, options.model).image?.maxOutputs || 1, Math.floor(options.count) || 1));
    try {
        await runBackendGenerationTaskBatch({
            mode: "image",
            prompt,
            config: requestConfig,
            referenceImages: options.referenceImages,
            signal: options.signal,
            expectedScope,
            metadata: { source: IMAGE_GENERATION_SOURCE },
            count,
            onTaskUpdate: (task) => {
                if (!taskIds.includes(task.id)) taskIds.push(task.id);
                options.onTaskIds?.([...taskIds]);
            },
        }, imageGenerationWaitDependencies());
        const assetIds = await materializeStandaloneImageTasks(taskIds, options.signal, expectedScope);
        return { taskIds, assetIds };
    } catch (error) {
        options.onTaskIds?.([...taskIds]);
        throw error;
    }
}

export async function resumeStandaloneImageGeneration(taskIds: string[], signal?: AbortSignal, expectedScope?: CapturedUserScope) {
    if (!taskIds.length) throw new Error("没有可取回的生成任务");
    const scope = expectedScope ?? captureUserScope();
    for (const taskId of taskIds) {
        await queryGenerationTask(taskId, { signal, expectedScope: scope });
    }
    return materializeStandaloneImageTasks(taskIds, signal, scope);
}
