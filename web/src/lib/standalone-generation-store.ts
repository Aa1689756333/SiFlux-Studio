import { getActiveUserScope } from "@/lib/user-scope";

export type StandaloneGenerationJobBase = {
    id: string;
    status: string;
    taskIds: string[];
    error?: string;
    updatedAt?: string;
};

export type StandaloneGenerationSnapshot<TJob> = {
    jobs: TJob[];
    liveIds: string[];
};

export function settleIncompleteGenerationJobs<TJob extends StandaloneGenerationJobBase>(jobs: TJob[], liveIds: Iterable<string>, now = () => new Date().toISOString()): TJob[] {
    const live = new Set(liveIds);
    let changed = false;
    const next = jobs.map((job) => {
        if (live.has(job.id)) return job;
        if (job.status !== "running" && job.status !== "pending") return job;
        if (job.taskIds.length) return job;
        changed = true;
        return { ...job, status: "failed", error: job.error || "生成已中断，请重新提交", updatedAt: now() };
    });
    return changed ? next : jobs;
}

export function createStandaloneGenerationStore<TJob extends StandaloneGenerationJobBase>(api: {
    load: (scope?: string) => Promise<TJob[]>;
    save: (jobs: TJob[], scope?: string) => Promise<void>;
    upsert: (jobs: TJob[], next: TJob) => TJob[];
    remove: (jobs: TJob[], id: string) => TJob[];
}) {
    let jobs: TJob[] = [];
    let snapshot: StandaloneGenerationSnapshot<TJob> = { jobs, liveIds: [] };
    let hydratedScope = "";
    let hydratePromise: Promise<void> | null = null;
    const turns = new Map<string, AbortController>();
    const listeners = new Set<() => void>();
    let persistTimer: ReturnType<typeof setTimeout> | null = null;
    let errorHandler: ((message: string) => void) | null = null;
    let resumeHandler: ((job: TJob) => void) | null = null;

    function emit() {
        snapshot = { jobs, liveIds: [...turns.keys()] };
        listeners.forEach((listener) => listener());
        if (persistTimer != null) return;
        persistTimer = setTimeout(() => {
            persistTimer = null;
            void api.save(jobs);
        }, 0);
    }

    function setJobs(next: TJob[]) {
        jobs = next;
        emit();
    }

    return {
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        getSnapshot() {
            return snapshot;
        },
        setErrorHandler(handler: ((message: string) => void) | null) {
            errorHandler = handler;
            return () => {
                if (errorHandler === handler) errorHandler = null;
            };
        },
        notifyError(message: string) {
            errorHandler?.(message);
        },
        setResumeHandler(handler: ((job: TJob) => void) | null) {
            resumeHandler = handler;
        },
        async hydrate(scope = getActiveUserScope()) {
            if (hydratedScope === scope && !hydratePromise) return;
            if (hydratePromise && hydratedScope === scope) {
                await hydratePromise;
                return;
            }
            hydratedScope = scope;
            hydratePromise = api.load(scope).then((history) => {
                const liveIds = [...turns.keys()];
                const liveById = new Map(jobs.filter((item) => turns.has(item.id)).map((item) => [item.id, item]));
                const merged = history.map((item) => liveById.get(item.id) || item);
                for (const item of liveById.values()) {
                    if (!merged.some((candidate) => candidate.id === item.id)) merged.unshift(item);
                }
                const settled = settleIncompleteGenerationJobs(merged, liveIds);
                setJobs(settled);
                for (const job of settled) {
                    if (!turns.has(job.id) && (job.status === "running" || job.status === "pending") && job.taskIds.length) {
                        resumeHandler?.(job);
                    }
                }
            }).finally(() => {
                hydratePromise = null;
            });
            await hydratePromise;
        },
        job(id: string) {
            return jobs.find((item) => item.id === id);
        },
        upsertJob(next: TJob) {
            setJobs(api.upsert(jobs, next));
        },
        patchJob(id: string, patch: (current: TJob) => TJob) {
            const current = jobs.find((item) => item.id === id);
            if (!current) return;
            setJobs(api.upsert(jobs, patch(current)));
        },
        deleteJob(id: string) {
            turns.get(id)?.abort();
            turns.delete(id);
            setJobs(api.remove(jobs, id));
        },
        stopJob(id: string) {
            turns.get(id)?.abort();
        },
        beginTurn(id: string) {
            if (turns.has(id)) return null;
            const controller = new AbortController();
            turns.set(id, controller);
            emit();
            return controller;
        },
        endTurn(id: string, controller: AbortController) {
            if (turns.get(id) === controller) turns.delete(id);
            emit();
        },
        hasTurn(id: string) {
            return turns.has(id);
        },
    };
}
