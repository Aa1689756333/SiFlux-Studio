export type UsageRange = "today" | "7d" | "30d" | "90d" | "1y" | "all";

export type UsageJob = {
    createdAt: string;
    status: string;
    model: string;
    outputs: number;
};

export type UsageKindSummary = {
    jobs: number;
    succeeded: number;
    failed: number;
    running: number;
    outputs: number;
};

export type UsageModelRow = {
    model: string;
    jobs: number;
    succeeded: number;
    outputs: number;
};

export type UsageDayRow = {
    day: string;
    jobs: number;
    succeeded: number;
    outputs: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function usageRangeStart(range: UsageRange, now = Date.now()) {
    if (range === "all") return 0;
    if (range === "today") {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        return start.getTime();
    }
    const days = range === "7d" ? 7 : range === "90d" ? 90 : range === "1y" ? 365 : 30;
    return now - days * DAY_MS;
}

export function usageCreatedAtInRange(createdAt: string, range: UsageRange, now = Date.now()) {
    const start = usageRangeStart(range, now);
    if (start <= 0) return true;
    const at = Date.parse(createdAt);
    return Number.isFinite(at) && at >= start;
}

export function usageJobsInRange(jobs: UsageJob[], range: UsageRange, now = Date.now()) {
    if (usageRangeStart(range, now) <= 0) return jobs;
    return jobs.filter((job) => usageCreatedAtInRange(job.createdAt, range, now));
}

export function summarizeUsageJobs(jobs: UsageJob[]): UsageKindSummary {
    const summary: UsageKindSummary = { jobs: jobs.length, succeeded: 0, failed: 0, running: 0, outputs: 0 };
    for (const job of jobs) {
        if (job.status === "succeeded") summary.succeeded += 1;
        else if (job.status === "failed") summary.failed += 1;
        else if (job.status === "pending" || job.status === "running" || job.status === "retrievable") summary.running += 1;
        summary.outputs += Math.max(0, job.outputs);
    }
    return summary;
}

export function usageModelBreakdown(jobs: UsageJob[]): UsageModelRow[] {
    const rows = new Map<string, UsageModelRow>();
    for (const job of jobs) {
        const model = job.model.trim() || "未记录模型";
        const row = rows.get(model) ?? { model, jobs: 0, succeeded: 0, outputs: 0 };
        row.jobs += 1;
        if (job.status === "succeeded") row.succeeded += 1;
        row.outputs += Math.max(0, job.outputs);
        rows.set(model, row);
    }
    return [...rows.values()].sort((a, b) => b.jobs - a.jobs || a.model.localeCompare(b.model, "zh-CN"));
}

function utcDayKey(value: Date) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

export function usageDailyCounts(jobs: UsageJob[], days: number, now = Date.now()): UsageDayRow[] {
    const end = new Date(now);
    const endUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
    const rows: UsageDayRow[] = [];
    for (let offset = days - 1; offset >= 0; offset -= 1) {
        rows.push({ day: utcDayKey(new Date(endUtc - offset * DAY_MS)), jobs: 0, succeeded: 0, outputs: 0 });
    }
    const index = new Map(rows.map((row, i) => [row.day, i]));
    for (const job of jobs) {
        const at = new Date(job.createdAt);
        if (Number.isNaN(at.getTime())) continue;
        const i = index.get(utcDayKey(at));
        if (i == null) continue;
        rows[i].jobs += 1;
        if (job.status === "succeeded") rows[i].succeeded += 1;
        rows[i].outputs += Math.max(0, job.outputs);
    }
    return rows;
}

export function imageJobOutputs(job: { status: string; count?: number; assetIds?: string[] }) {
    const assets = Array.isArray(job.assetIds) ? job.assetIds.length : 0;
    if (job.status === "succeeded") return Math.max(1, Number(job.count) || 0, assets);
    return assets;
}

export function mediaJobOutputs(job: { status: string; assetIds?: string[] }) {
    const assets = Array.isArray(job.assetIds) ? job.assetIds.length : 0;
    if (job.status === "succeeded") return Math.max(1, assets);
    return assets;
}

export type CanvasUsageKind = "image" | "video" | "audio";

export type CanvasUsageTask = {
    createdAt: string;
    status: string;
    model?: string;
    type?: string;
    operation?: string;
    inputJson?: string;
    resultJson?: string;
    outputs?: Array<{ mediaType?: string }>;
};

export function canvasUsageKind(task: CanvasUsageTask): CanvasUsageKind | null {
    if (task.operation?.startsWith("cloud_agent")) return null;
    try {
        const mode = task.inputJson ? (JSON.parse(task.inputJson) as { mode?: string }).mode : undefined;
        if (mode === "image" || mode === "video" || mode === "audio") return mode;
        if (mode === "text") return null;
    } catch {
        // Fall through to task.type.
    }
    if (task.type === "canvas_video" || task.type?.includes("video")) return "video";
    if (task.type === "canvas_audio" || task.type?.includes("audio")) return "audio";
    if (task.type === "canvas_text" || task.type?.includes("text") || task.type?.includes("storyboard") || task.type?.includes("agent")) return null;
    if (task.type === "canvas_image" || task.type?.includes("image")) return "image";
    return null;
}

export function canvasUsageStatus(status: string) {
    if (status === "queued") return "pending";
    if (status === "success") return "succeeded";
    if (status === "error") return "failed";
    if (status === "loading") return "running";
    return status;
}

export function canvasTaskOutputs(task: CanvasUsageTask, kind: CanvasUsageKind) {
    const fromOutputs = Array.isArray(task.outputs) ? task.outputs.filter((item) => item.mediaType === kind).length : 0;
    let fromResult = 0;
    if (task.resultJson?.trim()) {
        try {
            const result = JSON.parse(task.resultJson) as { images?: unknown[]; video?: unknown; audio?: unknown };
            if (kind === "image") fromResult = Array.isArray(result.images) ? result.images.length : 0;
            else if (kind === "video") fromResult = result.video ? 1 : 0;
            else if (kind === "audio") fromResult = result.audio ? 1 : 0;
        } catch {
            fromResult = 0;
        }
    }
    if (canvasUsageStatus(task.status) === "succeeded") return Math.max(1, fromOutputs, fromResult);
    return Math.max(fromOutputs, fromResult);
}

export function usageJobsFromCanvasTasks(tasks: CanvasUsageTask[]) {
    const snapshot: Record<CanvasUsageKind, UsageJob[]> = { image: [], video: [], audio: [] };
    for (const task of tasks) {
        const kind = canvasUsageKind(task);
        if (!kind) continue;
        snapshot[kind].push({
            createdAt: task.createdAt,
            status: canvasUsageStatus(task.status),
            model: task.model?.trim() || "未记录模型",
            outputs: canvasTaskOutputs(task, kind),
        });
    }
    return snapshot;
}
