import { useQuery } from "@tanstack/react-query";

import { localTaskHistoryFromProjects } from "@/lib/local-task-history";
import { getActiveUserScope } from "@/lib/user-scope";
import { imageJobOutputs, mediaJobOutputs, usageJobsFromCanvasTasks, type UsageJob } from "@/lib/usage-stats";
import { loadAudioGenerationHistory } from "@/pages/generate-audio/generate-audio-history";
import { loadImageGenerationHistory } from "@/pages/generate-image/generate-image-history";
import { loadVideoGenerationHistory } from "@/pages/generate-video/generate-video-history";
import { listGenerationTasks } from "@/services/api/task-center";
import { isLocalWorkspaceMode } from "@/services/workspace-mode";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";

export const generationUsageQueryKey = (scope = getActiveUserScope()) => ["generation-usage", scope] as const;

export type GenerationUsageSnapshot = {
    image: UsageJob[];
    video: UsageJob[];
    audio: UsageJob[];
};

function mergeUsageJobs(standalone: UsageJob[], canvas: UsageJob[]) {
    return [...standalone, ...canvas];
}

async function loadCanvasUsageTasks() {
    const localMode = isLocalWorkspaceMode() || useUserStore.getState().storageMode === "local";
    if (localMode) return localTaskHistoryFromProjects(useCanvasStore.getState().projects);
    try {
        return await listGenerationTasks(300, { activeOnly: false });
    } catch {
        return [];
    }
}

export async function loadGenerationUsage(): Promise<GenerationUsageSnapshot> {
    const [image, video, audio, canvasTasks] = await Promise.all([
        loadImageGenerationHistory(),
        loadVideoGenerationHistory(),
        loadAudioGenerationHistory(),
        loadCanvasUsageTasks(),
    ]);
    const canvas = usageJobsFromCanvasTasks(canvasTasks);
    return {
        image: mergeUsageJobs(image.map((job) => ({ createdAt: job.createdAt, status: job.status, model: job.model, outputs: imageJobOutputs(job) })), canvas.image),
        video: mergeUsageJobs(video.map((job) => ({ createdAt: job.createdAt, status: job.status, model: job.model, outputs: mediaJobOutputs(job) })), canvas.video),
        audio: mergeUsageJobs(audio.map((job) => ({ createdAt: job.createdAt, status: job.status, model: job.model, outputs: mediaJobOutputs(job) })), canvas.audio),
    };
}

export function useGenerationUsage() {
    const localHydrated = useCanvasStore((state) => state.hydrated);
    const storageMode = useUserStore((state) => state.storageMode);
    const localMode = isLocalWorkspaceMode() || storageMode === "local";
    const canvasRevision = useCanvasStore((state) => (localMode ? state.projects.map((project) => project.updatedAt).join("|") : ""));
    return useQuery({
        queryKey: [...generationUsageQueryKey(), localMode, localHydrated, canvasRevision],
        queryFn: loadGenerationUsage,
        staleTime: 15_000,
        enabled: !localMode || localHydrated,
    });
}
