import { resolveAudioSpeechSettings } from "@/lib/audio-generation";
import { explainGenerationError } from "@/lib/generation-error";
import { captureUserScope, type CapturedUserScope } from "@/lib/user-scope-guard";
import { runBackendGenerationTask, type GenerationTaskDependencies } from "@/services/api/generation-task";
import { createGenerationTask, queryGenerationTask, waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { materializeGenerationTaskAssets } from "@/services/project-asset-sync";
import type { AiConfig } from "@/stores/use-config-store";

export const AUDIO_GENERATION_WAIT_MS = 30 * 60 * 1000;
export const AUDIO_GENERATION_SOURCE = "standalone-audio-page";

export function standaloneAudioRequestConfig(config: AiConfig, model: string, settings: {
    audioVoice?: string;
    audioFormat?: string;
    audioSpeed?: string;
    audioPitch?: string;
    audioVolume?: string;
    audioInstructions?: string;
}): AiConfig {
    const resolved = resolveAudioSpeechSettings(model, settings);
    return {
        ...config,
        model,
        audioModel: model,
        audioVoice: resolved.audioVoice,
        audioFormat: resolved.audioFormat,
        audioSpeed: resolved.audioSpeed,
        audioPitch: resolved.audioPitch,
        audioVolume: resolved.audioVolume,
        audioInstructions: resolved.audioInstructions,
    };
}

export function audioGenerationWaitDependencies(): GenerationTaskDependencies {
    return {
        createTask: createGenerationTask,
        waitTask: (id, options) => waitForGenerationTask(id, { ...options, timeoutMs: AUDIO_GENERATION_WAIT_MS }),
        createId: () => crypto.randomUUID(),
    };
}

export function collectMaterializedAudioAssetIds(task: Pick<GenerationTask, "outputs">) {
    return (task.outputs || []).flatMap((output) => (output.materializedAssetId ? [output.materializedAssetId] : []));
}

export function audioGenerationErrorIsRetrievable(error: unknown, taskIds: string[]) {
    if (!taskIds.length) return false;
    const explained = explainGenerationError(error);
    if (explained.category === "timeout" || explained.category === "download_failed" || explained.uncertain) return true;
    const text = error instanceof Error ? error.message : String(error);
    return text.includes("任务执行超时") || text.includes("任务状态同步失败");
}

export async function materializeStandaloneAudioTasks(taskIds: string[], signal?: AbortSignal, expectedScope?: CapturedUserScope) {
    const scope = expectedScope ?? captureUserScope();
    const assetIds: string[] = [];
    for (const taskId of taskIds) {
        const waited = await waitForGenerationTask(taskId, { signal, expectedScope: scope, timeoutMs: AUDIO_GENERATION_WAIT_MS });
        const materialized = await materializeGenerationTaskAssets(waited, signal);
        assetIds.push(...collectMaterializedAudioAssetIds(materialized));
    }
    return [...new Set(assetIds)];
}

export async function runStandaloneAudioGeneration(options: {
    prompt: string;
    config: AiConfig;
    model: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioPitch: string;
    audioVolume: string;
    audioInstructions: string;
    signal?: AbortSignal;
    expectedScope?: CapturedUserScope;
    onTaskIds?: (taskIds: string[]) => void;
}) {
    const prompt = options.prompt.trim();
    if (!prompt) throw new Error("请先填写提示词");
    const requestConfig = standaloneAudioRequestConfig(options.config, options.model, options);
    const expectedScope = options.expectedScope ?? captureUserScope();
    const taskIds: string[] = [];
    try {
        await runBackendGenerationTask({
            mode: "audio",
            prompt,
            config: requestConfig,
            signal: options.signal,
            expectedScope,
            metadata: { source: AUDIO_GENERATION_SOURCE },
            onTaskUpdate: (task) => {
                if (!taskIds.includes(task.id)) taskIds.push(task.id);
                options.onTaskIds?.([...taskIds]);
            },
        }, audioGenerationWaitDependencies());
        const assetIds = await materializeStandaloneAudioTasks(taskIds, options.signal, expectedScope);
        return { taskIds, assetIds };
    } catch (error) {
        options.onTaskIds?.([...taskIds]);
        throw error;
    }
}

export async function resumeStandaloneAudioGeneration(taskIds: string[], signal?: AbortSignal, expectedScope?: CapturedUserScope) {
    if (!taskIds.length) throw new Error("没有可取回的生成任务");
    const scope = expectedScope ?? captureUserScope();
    for (const taskId of taskIds) {
        await queryGenerationTask(taskId, { signal, expectedScope: scope });
    }
    return materializeStandaloneAudioTasks(taskIds, signal, scope);
}
