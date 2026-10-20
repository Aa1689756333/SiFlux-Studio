import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useAccountFileStorageUsage } from "@/hooks/use-account-file-storage-usage";
import { useGenerationUsage } from "@/hooks/use-generation-usage";
import { accountStorageMeter } from "@/lib/account-storage-usage";
import { listCanvasWorkspaceProjectRoots, previewNodesForWorkspaceProject } from "@/lib/canvas/canvas-workspace-project";
import { summarizeUsageJobs, usageJobsInRange } from "@/lib/usage-stats";
import { listWorkspaceCanvasProjectsPage, type CanvasLibrarySummary } from "@/services/api/workspace-data";
import { isLocalWorkspaceMode } from "@/services/workspace-mode";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";
import { HomeDashboard } from "./home-dashboard";
import "./home-dashboard.css";

export default function HomePage() {
    const userId = useUserStore((state) => state.user?.id);
    const storageMode = useUserStore((state) => state.storageMode);
    const sessionHydrated = useUserStore((state) => state.hydrated);
    const localProjects = useCanvasStore((state) => state.projects);
    const localHydrated = useCanvasStore((state) => state.hydrated);
    const localMode = isLocalWorkspaceMode() || storageMode === "local";
    const query = useQuery({
        queryKey: ["siflux-home-canvases", userId],
        queryFn: () => listWorkspaceCanvasProjectsPage({ page: 1, pageSize: 4, sort: "updated" }),
        enabled: !localMode && Boolean(userId) && sessionHydrated,
    });
    const localSummaries = useMemo<CanvasLibrarySummary[]>(() => listCanvasWorkspaceProjectRoots(localProjects)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 4)
        .map((project) => ({
            ...project,
            nodeCount: project.nodes.length,
            previewNodes: previewNodesForWorkspaceProject(localProjects, project.id),
        })), [localProjects]);
    const projects = localMode ? localSummaries : query.data?.projects || [];
    const generation = useGenerationUsage();
    const storageQuery = useAccountFileStorageUsage();
    const meter = accountStorageMeter(storageQuery.data);
    const image = summarizeUsageJobs(usageJobsInRange(generation.data?.image ?? [], "7d"));
    const video = summarizeUsageJobs(usageJobsInRange(generation.data?.video ?? [], "7d"));
    const audio = summarizeUsageJobs(usageJobsInRange(generation.data?.audio ?? [], "7d"));

    return <HomeDashboard
        projects={projects}
        loading={!sessionHydrated || !localHydrated || (!localMode && Boolean(userId) && query.isPending)}
        error={!localMode && query.isError}
        onRetry={() => void query.refetch()}
        usage={{
            imageOutputs: image.outputs,
            videoOutputs: video.outputs,
            audioOutputs: audio.outputs,
            storageUsed: meter.usedLabel,
            storageHint: `${meter.percentLabel} · ${meter.totalLabel}`,
            loading: generation.isPending || (storageQuery.isPending && !storageQuery.data),
        }}
    />;
}
