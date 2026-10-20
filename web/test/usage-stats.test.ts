import { describe, expect, test } from "bun:test";

import { canvasTaskOutputs, imageJobOutputs, mediaJobOutputs, summarizeUsageJobs, usageDailyCounts, usageJobsFromCanvasTasks, usageJobsInRange, usageModelBreakdown, usageRangeStart } from "@/lib/usage-stats";

describe("usage stats", () => {
    test("counts succeeded image outputs from count or assets", () => {
        expect(imageJobOutputs({ status: "succeeded", count: 4, assetIds: ["a"] })).toBe(4);
        expect(imageJobOutputs({ status: "failed", count: 4, assetIds: ["a"] })).toBe(1);
        expect(mediaJobOutputs({ status: "succeeded", assetIds: [] })).toBe(1);
        expect(mediaJobOutputs({ status: "failed", assetIds: [] })).toBe(0);
    });

    test("filters jobs to the selected range", () => {
        const now = Date.parse("2026-10-19T12:00:00.000Z");
        const jobs = [
            { createdAt: "2026-10-18T01:00:00.000Z", status: "succeeded", model: "a", outputs: 2 },
            { createdAt: "2026-09-01T01:00:00.000Z", status: "succeeded", model: "a", outputs: 9 },
        ];
        expect(usageJobsInRange(jobs, "7d", now)).toHaveLength(1);
        expect(usageJobsInRange(jobs, "all", now)).toHaveLength(2);
        expect(usageJobsInRange(jobs, "today", now)).toHaveLength(0);
        expect(usageRangeStart("today", now)).toBe(new Date(now).setHours(0, 0, 0, 0));
        expect(usageRangeStart("90d", now)).toBe(now - 90 * 24 * 60 * 60 * 1000);
        expect(usageRangeStart("1y", now)).toBe(now - 365 * 24 * 60 * 60 * 1000);
        expect(summarizeUsageJobs(usageJobsInRange(jobs, "7d", now))).toEqual({
            jobs: 1, succeeded: 1, failed: 0, running: 0, outputs: 2,
        });
    });

    test("breaks down models and fills daily buckets", () => {
        const now = Date.parse("2026-10-19T12:00:00.000Z");
        const jobs = [
            { createdAt: "2026-10-19T01:00:00.000Z", status: "succeeded", model: "gpt-image-2", outputs: 2 },
            { createdAt: "2026-10-19T02:00:00.000Z", status: "failed", model: "gpt-image-2", outputs: 0 },
            { createdAt: "2026-10-18T02:00:00.000Z", status: "succeeded", model: "wan", outputs: 1 },
        ];
        expect(usageModelBreakdown(jobs).map((row) => row.model)).toEqual(["gpt-image-2", "wan"]);
        const days = usageDailyCounts(jobs, 3, now);
        expect(days.map((row) => row.day)).toEqual(["2026-10-17", "2026-10-18", "2026-10-19"]);
        expect(days[2]).toMatchObject({ jobs: 2, succeeded: 1, outputs: 2 });
    });

    test("maps canvas tasks into image/video/audio usage jobs", () => {
        expect(canvasTaskOutputs({ status: "succeeded", resultJson: JSON.stringify({ images: [{}, {}] }) }, "image")).toBe(2);
        const snapshot = usageJobsFromCanvasTasks([
            { createdAt: "2026-10-19T01:00:00.000Z", status: "queued", type: "canvas_image", model: "gpt-image-2" },
            { createdAt: "2026-10-19T02:00:00.000Z", status: "succeeded", type: "canvas_video", model: "wan", resultJson: JSON.stringify({ video: {} }) },
            { createdAt: "2026-10-19T03:00:00.000Z", status: "succeeded", type: "canvas_text", model: "gpt" },
            { createdAt: "2026-10-19T04:00:00.000Z", status: "succeeded", type: "canvas_image", operation: "cloud_agent_run", model: "agent" },
        ]);
        expect(snapshot.image).toHaveLength(1);
        expect(snapshot.image[0].status).toBe("pending");
        expect(snapshot.video).toEqual([{ createdAt: "2026-10-19T02:00:00.000Z", status: "succeeded", model: "wan", outputs: 1 }]);
        expect(snapshot.audio).toEqual([]);
    });
});
