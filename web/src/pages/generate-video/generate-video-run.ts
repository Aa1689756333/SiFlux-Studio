import { explainGenerationError } from "@/lib/generation-error";
import { modelCapabilityConfigFor, normalizeVideoValue } from "@/lib/model-capabilities";
import { captureUserScope, type CapturedUserScope } from "@/lib/user-scope-guard";
import { runBackendGenerationTask, type GenerationTaskDependencies } from "@/services/api/generation-task";
import { createGenerationTask, queryGenerationTask, waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { materializeGenerationTaskAssets } from "@/services/project-asset-sync";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export const VIDEO_GENERATION_WAIT_MS = 30 * 60 * 1000;
export const VIDEO_GENERATION_SOURCE = "standalone-video-page";

export function standaloneVideoRequestConfig(config: AiConfig, model: string, settings: {
    ratio: string;
    videoQuality: string;
    seconds: string;
    videoGenerateAudio?: string;
    videoWatermark?: string;
}): AiConfig {
    const profile = modelCapabilityConfigFor(config, model).video!;
    const normalized = normalizeVideoValue(profile, { seconds: settings.seconds, ratio: settings.ratio, resolution: settings.videoQuality });
    return {
        ...config,
        model,
        videoModel: model,
        size: normalized.ratio,
        videoSeconds: normalized.seconds,
        vquality: normalized.resolution.replace(/p$/i, ""),
        videoGenerateAudio: profile.generateAudio.supported ? String(settings.videoGenerateAudio ?? profile.generateAudio.default) : "false",
        videoWatermark: profile.watermark.supported ? String(settings.videoWatermark ?? profile.watermark.default) : "false",
    };
}

export function videoGenerationWaitDependencies(): GenerationTaskDependencies {
    return {
        createTask: createGenerationTask,
        waitTask: (id, options) => waitForGenerationTask(id, { ...options, timeoutMs: VIDEO_GENERATION_WAIT_MS }),
        createId: () => crypto.randomUUID(),
    };
}

export function collectMaterializedVideoAssetIds(task: Pick<GenerationTask, "outputs">) {
    return (task.outputs || []).flatMap((output) => (output.materializedAssetId ? [output.materializedAssetId] : []));
}

export function videoGenerationErrorIsRetrievable(error: unknown, taskIds: string[]) {
    if (!taskIds.length) return false;
    const explained = explainGenerationError(error);
    if (explained.category === "timeout" || explained.category === "download_failed" || explained.uncertain) return true;
    const text = error instanceof Error ? error.message : String(error);
    return text.includes("任务执行超时") || text.includes("任务状态同步失败");
}

export async function materializeStandaloneVideoTasks(taskIds: string[], signal?: AbortSignal, expectedScope?: CapturedUserScope) {
    const scope = expectedScope ?? captureUserScope();
    const assetIds: string[] = [];
    for (const taskId of taskIds) {
        const waited = await waitForGenerationTask(taskId, { signal, expectedScope: scope, timeoutMs: VIDEO_GENERATION_WAIT_MS });
        const materialized = await materializeGenerationTaskAssets(waited, signal);
        assetIds.push(...collectMaterializedVideoAssetIds(materialized));
    }
    return [...new Set(assetIds)];
}

export async function runStandaloneVideoGeneration(options: {
    prompt: string;
    config: AiConfig;
    model: string;
    ratio: string;
    videoQuality: string;
    seconds: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    referenceImages?: ReferenceImage[];
    referenceVideos?: ReferenceVideo[];
    referenceAudios?: ReferenceAudio[];
    signal?: AbortSignal;
    expectedScope?: CapturedUserScope;
    onTaskIds?: (taskIds: string[]) => void;
}) {
    const prompt = options.prompt.trim();
    if (!prompt) throw new Error("请先填写提示词");
    const requestConfig = standaloneVideoRequestConfig(options.config, options.model, options);
    const expectedScope = options.expectedScope ?? captureUserScope();
    const taskIds: string[] = [];
    try {
        await runBackendGenerationTask({
            mode: "video",
            prompt,
            config: requestConfig,
            referenceImages: options.referenceImages,
            referenceVideos: options.referenceVideos,
            referenceAudios: options.referenceAudios,
            signal: options.signal,
            expectedScope,
            metadata: { source: VIDEO_GENERATION_SOURCE },
            onTaskUpdate: (task) => {
                if (!taskIds.includes(task.id)) taskIds.push(task.id);
                options.onTaskIds?.([...taskIds]);
            },
        }, videoGenerationWaitDependencies());
        const assetIds = await materializeStandaloneVideoTasks(taskIds, options.signal, expectedScope);
        return { taskIds, assetIds };
    } catch (error) {
        options.onTaskIds?.([...taskIds]);
        throw error;
    }
}

export async function resumeStandaloneVideoGeneration(taskIds: string[], signal?: AbortSignal, expectedScope?: CapturedUserScope) {
    if (!taskIds.length) throw new Error("没有可取回的生成任务");
    const scope = expectedScope ?? captureUserScope();
    for (const taskId of taskIds) {
        await queryGenerationTask(taskId, { signal, expectedScope: scope });
    }
    return materializeStandaloneVideoTasks(taskIds, signal, scope);
}
