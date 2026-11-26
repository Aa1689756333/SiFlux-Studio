import { describe, expect, test } from "bun:test";

import {
    formatGenerationElapsed,
    generationProgressDisplay,
    GENERATION_PROGRESS_STALL_MS,
    trackGenerationProgressChange,
} from "@/lib/generation-task-display";

const start = 1_000_000;

describe("generation progress display", () => {
    test("a freshly changed percentage draws the real bar", () => {
        const record = trackGenerationProgressChange(undefined, 50, start);
        const view = generationProgressDisplay({ status: "running", progress: 50, progressChangedAt: record.changedAt, now: start + 5_000 });
        expect(view).toEqual({ bar: "determinate", percent: 50 });
    });

    test("a percentage unchanged for 60 s switches to the indeterminate bar and hides the number", () => {
        let record = trackGenerationProgressChange(undefined, 50, start);
        record = trackGenerationProgressChange(record, 50, start + 30_000);
        expect(record.changedAt).toBe(start);
        const justBefore = generationProgressDisplay({ status: "running", progress: 50, progressChangedAt: record.changedAt, now: start + GENERATION_PROGRESS_STALL_MS - 1 });
        expect(justBefore.bar).toBe("determinate");
        const stalled = generationProgressDisplay({ status: "running", progress: 50, progressChangedAt: record.changedAt, now: start + GENERATION_PROGRESS_STALL_MS });
        expect(stalled).toEqual({ bar: "indeterminate", percent: null });
    });

    test("a new percentage after a stall goes back to the real bar", () => {
        const stale = trackGenerationProgressChange(undefined, 50, start);
        const moved = trackGenerationProgressChange(stale, 60, start + 120_000);
        expect(moved.changedAt).toBe(start + 120_000);
        const view = generationProgressDisplay({ status: "running", progress: 60, progressChangedAt: moved.changedAt, now: start + 121_000 });
        expect(view.bar).toBe("determinate");
        expect(view.percent).toBe(60);
    });

    test("no real percentage means no bar and no invented number", () => {
        const view = generationProgressDisplay({ status: "running", progress: null, now: start });
        expect(view).toEqual({ bar: "none", percent: null });
    });

    test("terminal states are unaffected by the stall rule", () => {
        for (const status of ["succeeded", "failed", "cancelled"] as const) {
            const view = generationProgressDisplay({ status, progress: 50, progressChangedAt: start, now: start + 600_000 });
            expect(view).toEqual({ bar: "determinate", percent: 50 });
        }
    });

    test("elapsed time reads as minutes and seconds", () => {
        expect(formatGenerationElapsed(-5)).toBe("0秒");
        expect(formatGenerationElapsed(42_000)).toBe("42秒");
        expect(formatGenerationElapsed(192_000)).toBe("3分12秒");
        expect(formatGenerationElapsed(3_900_000)).toBe("1时5分");
    });
});