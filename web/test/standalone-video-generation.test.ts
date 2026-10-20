import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
    parseVideoGenerationHistory,
    removeVideoGenerationJob,
    upsertVideoGenerationJob,
    videoGenerationJobCanRetrieve,
    type VideoGenerationJob,
} from "../src/pages/generate-video/generate-video-history";
import {
    VIDEO_GENERATION_SOURCE,
    VIDEO_GENERATION_WAIT_MS,
    standaloneVideoRequestConfig,
    videoGenerationErrorIsRetrievable,
} from "../src/pages/generate-video/generate-video-run";

const root = resolve(import.meta.dir, "..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");

function sampleJob(overrides: Partial<VideoGenerationJob> = {}): VideoGenerationJob {
    return {
        id: "job-1",
        createdAt: "2026-10-19T01:00:00.000Z",
        updatedAt: "2026-10-19T01:00:00.000Z",
        prompt: "雨夜霓虹街道，镜头缓慢推进",
        model: "demo-video",
        ratio: "16:9",
        videoQuality: "720p",
        seconds: "5",
        videoGenerateAudio: "false",
        videoWatermark: "false",
        status: "succeeded",
        taskIds: ["task-1"],
        assetIds: ["asset-1"],
        ...overrides,
    };
}

describe("standalone video generation page", () => {
    test("home and sidebar open the standalone page instead of a new canvas", () => {
        const sidebar = read("src/components/layout/workspace-sidebar-nav.tsx");
        const router = read("src/router.tsx");
        expect(sidebar).toContain('to: "/generate/video"');
        expect(sidebar).not.toContain('to: "/canvas?mode=new&add=video"');
        expect(sidebar).toContain('title: "视频生成"');
        expect(sidebar).toContain('to: "/generate/video"');
        expect(sidebar).toContain('pathname.startsWith("/generate/video") ? "video"');
        expect(router).toContain('path: "/generate/video"');
        expect(router).toContain("loadGenerateVideoPage");
    });

    test("generation reuses the backend video task pipeline without creating a canvas", () => {
        const run = read("src/pages/generate-video/generate-video-run.ts");
        const page = read("src/pages/generate-video/index.tsx");
        expect(run).toContain("runBackendGenerationTask");
        expect(run).toContain('mode: "video"');
        expect(run).toContain("materializeGenerationTaskAssets");
        expect(run).toContain("timeoutMs: VIDEO_GENERATION_WAIT_MS");
        expect(run).not.toContain("createCanvas");
        expect(run).not.toContain("use-canvas-store");
        expect(page).not.toContain("/canvas?mode=new");
        expect(page).toContain("本页历史");
        expect(page).toContain("hydrateStandaloneVideo");
        expect(page).toContain("离开本页后仍会继续");
        expect(page).not.toContain("请保持页面打开");
        expect(page).toContain("liveIds");
        expect(read("src/lib/standalone-generation-store.ts")).toContain("liveIds");
        expect(VIDEO_GENERATION_WAIT_MS).toBe(30 * 60 * 1000);
        expect(VIDEO_GENERATION_SOURCE).toBe("standalone-video-page");
    });

    test("history parse, upsert and delete keep asset ids untouched", () => {
        const assets = [{ id: "asset-1" }, { id: "asset-2" }];
        const parsed = parseVideoGenerationHistory([
            { id: "job-1", prompt: "镜头", model: "m", status: "succeeded", taskIds: ["t1"], assetIds: ["asset-1"] },
            { id: "", prompt: "丢弃" },
        ]);
        expect(parsed).toHaveLength(1);
        expect(parsed[0]?.assetIds).toEqual(["asset-1"]);
        const next = upsertVideoGenerationJob(parsed, sampleJob({ id: "job-2", assetIds: ["asset-2"] }));
        expect(next.map((job) => job.id)).toEqual(["job-2", "job-1"]);
        const removed = removeVideoGenerationJob(next, "job-2");
        expect(removed.map((job) => job.id)).toEqual(["job-1"]);
        expect(assets).toEqual([{ id: "asset-1" }, { id: "asset-2" }]);
    });

    test("timeout with task ids is retrievable and does not look like a new submit", () => {
        expect(videoGenerationErrorIsRetrievable(new Error("任务执行超时，请稍后重试"), ["task-1"])).toBe(true);
        expect(videoGenerationErrorIsRetrievable(new Error("任务执行超时，请稍后重试"), [])).toBe(false);
        expect(videoGenerationJobCanRetrieve(sampleJob({ status: "retrievable", taskIds: ["task-1"] }))).toBe(true);
        expect(videoGenerationJobCanRetrieve(sampleJob({ status: "failed", taskIds: ["task-1"] }))).toBe(false);
        const run = read("src/pages/generate-video/generate-video-run.ts");
        expect(run).toContain("resumeStandaloneVideoGeneration");
        expect(run).toContain("queryGenerationTask");
        expect(run).not.toMatch(/resumeStandaloneVideoGeneration[\s\S]*runBackendGenerationTask/);
    });

    test("request config pins the selected video model and duration", () => {
        const config = standaloneVideoRequestConfig(
            {
                model: "other",
                videoModel: "other",
                size: "1:1",
                videoSeconds: "8",
                vquality: "480",
                channels: [],
            } as never,
            "picked-video",
            { ratio: "16:9", videoQuality: "720p", seconds: "5" },
        );
        expect(config.model).toBe("picked-video");
        expect(config.videoModel).toBe("picked-video");
        expect(config.size).toBe("16:9");
        expect(config.videoSeconds).toBe("5");
        expect(config.vquality).toBe("720");
    });
});
