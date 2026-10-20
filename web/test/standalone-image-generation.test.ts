import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
    imageGenerationJobCanRetrieve,
    parseImageGenerationHistory,
    removeImageGenerationJob,
    upsertImageGenerationJob,
    type ImageGenerationJob,
} from "../src/pages/generate-image/generate-image-history";
import {
    IMAGE_GENERATION_SOURCE,
    IMAGE_GENERATION_WAIT_MS,
    imageGenerationErrorIsRetrievable,
    standaloneImageRequestConfig,
} from "../src/pages/generate-image/generate-image-run";

const root = resolve(import.meta.dir, "..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");

function sampleJob(overrides: Partial<ImageGenerationJob> = {}): ImageGenerationJob {
    return {
        id: "job-1",
        createdAt: "2026-10-19T01:00:00.000Z",
        updatedAt: "2026-10-19T01:00:00.000Z",
        prompt: "一只橘猫坐在窗边",
        model: "demo-image",
        ratio: "1:1",
        quality: "auto",
        count: 1,
        status: "succeeded",
        taskIds: ["task-1"],
        assetIds: ["asset-1"],
        ...overrides,
    };
}

describe("standalone image generation page", () => {
    test("home and sidebar open the standalone page instead of a new canvas", () => {
        const sidebar = read("src/components/layout/workspace-sidebar-nav.tsx");
        const router = read("src/router.tsx");
        expect(sidebar).toContain('to: "/generate/image"');
        expect(sidebar).not.toContain('to: "/canvas?mode=new&add=image"');
        expect(sidebar).toContain('title: "图片生成"');
        expect(sidebar).toContain('to: "/generate/image"');
        expect(sidebar).toContain('pathname.startsWith("/generate/image") ? "image"');
        expect(router).toContain('path: "/generate/image"');
        expect(router).toContain("loadGenerateImagePage");
    });

    test("new project and canvas entries still open the infinite canvas", () => {
        const sidebar = read("src/components/layout/workspace-sidebar-nav.tsx");
        expect(sidebar).toContain('to: "/canvas?mode=new"');
        expect(sidebar).toContain('title: "新建画布"');
    });

    test("generation reuses the backend image task pipeline without creating a canvas", () => {
        const run = read("src/pages/generate-image/generate-image-run.ts");
        const page = read("src/pages/generate-image/index.tsx");
        expect(run).toContain("runBackendGenerationTaskBatch");
        expect(run).toContain("materializeGenerationTaskAssets");
        expect(run).toContain("timeoutMs: IMAGE_GENERATION_WAIT_MS");
        expect(run).not.toContain("createCanvas");
        expect(run).not.toContain("use-canvas-store");
        expect(page).not.toContain("/canvas?mode=new");
        expect(page).toContain("本页历史");
        expect(page).toContain("hydrateStandaloneImage");
        expect(page).toContain("离开本页后仍会继续");
        expect(page).not.toContain("请保持页面打开");
        expect(page).toContain("liveIds");
        expect(read("src/lib/standalone-generation-store.ts")).toContain("liveIds");
        expect(IMAGE_GENERATION_WAIT_MS).toBe(30 * 60 * 1000);
        expect(IMAGE_GENERATION_SOURCE).toBe("standalone-image-page");
    });

    test("history parse, upsert and delete keep asset ids untouched", () => {
        const assets = [{ id: "asset-1" }, { id: "asset-2" }];
        const parsed = parseImageGenerationHistory([
            { id: "job-1", prompt: "猫", model: "m", status: "succeeded", taskIds: ["t1"], assetIds: ["asset-1"], references: [{ id: "ref-1", name: "猫.png", type: "image/png", storageKey: "resource:cat", url: "https://cdn.example/cat.png" }] },
            { id: "", prompt: "丢弃" },
        ]);
        expect(parsed).toHaveLength(1);
        expect(parsed[0]?.assetIds).toEqual(["asset-1"]);
        expect(parsed[0]?.references).toEqual([{ id: "ref-1", name: "猫.png", type: "image/png", url: "https://cdn.example/cat.png", storageKey: "resource:cat" }]);
        const next = upsertImageGenerationJob(parsed, sampleJob({ id: "job-2", assetIds: ["asset-2"] }));
        expect(next.map((job) => job.id)).toEqual(["job-2", "job-1"]);
        const removed = removeImageGenerationJob(next, "job-2");
        expect(removed.map((job) => job.id)).toEqual(["job-1"]);
        expect(assets).toEqual([{ id: "asset-1" }, { id: "asset-2" }]);
    });

    test("timeout with task ids is retrievable and does not look like a new submit", () => {
        expect(imageGenerationErrorIsRetrievable(new Error("任务执行超时，请稍后重试"), ["task-1"])).toBe(true);
        expect(imageGenerationErrorIsRetrievable(new Error("任务执行超时，请稍后重试"), [])).toBe(false);
        expect(imageGenerationJobCanRetrieve(sampleJob({ status: "retrievable", taskIds: ["task-1"] }))).toBe(true);
        expect(imageGenerationJobCanRetrieve(sampleJob({ status: "failed", taskIds: ["task-1"] }))).toBe(false);
        const run = read("src/pages/generate-image/generate-image-run.ts");
        expect(run).toContain("resumeStandaloneImageGeneration");
        expect(run).toContain("queryGenerationTask");
        expect(run).not.toMatch(/resumeStandaloneImageGeneration[\s\S]*runBackendGenerationTaskBatch/);
    });

    test("request config pins the selected image model and single-task count", () => {
        const config = standaloneImageRequestConfig(
            {
                model: "other",
                imageModel: "other",
                size: "16:9",
                quality: "auto",
                count: "4",
                channels: [],
            } as never,
            "picked-model",
            "1:1",
            "2k",
            4,
        );
        expect(config.model).toBe("picked-model");
        expect(config.imageModel).toBe("picked-model");
        expect(config.count).toBe("1");
    });

    test("history keeps uploaded reference images and drops unsavable data urls", async () => {
        const { persistableMediaReferences, parseStandaloneMediaReferences } = await import("../src/lib/standalone-generation-reference");
        const { settleIncompleteGenerationJobs } = await import("../src/lib/standalone-generation-store");
        const kept = persistableMediaReferences([
            { id: "a", name: "a.png", type: "image/png", dataUrl: "https://cdn.example/a.png", url: "https://cdn.example/a.png", storageKey: "resource:a", previewUrl: "https://cdn.example/a.png" },
            { id: "b", name: "b.png", type: "image/png", dataUrl: "data:image/png;base64,aaa", previewUrl: "data:image/png;base64,aaa" },
        ]);
        expect(kept).toEqual([{ id: "a", name: "a.png", type: "image/png", url: "https://cdn.example/a.png", storageKey: "resource:a" }]);
        expect(parseStandaloneMediaReferences([{ id: "x", name: "x.png", type: "image/png", url: "data:image/png;base64,aaa" }])).toEqual([]);
        expect(settleIncompleteGenerationJobs([
            sampleJob({ id: "live", status: "running", taskIds: [] }),
            sampleJob({ id: "stale", status: "running", taskIds: [] }),
            sampleJob({ id: "wait", status: "running", taskIds: ["task-1"] }),
        ], ["live"]).map((job) => [job.id, job.status])).toEqual([
            ["live", "running"],
            ["stale", "failed"],
            ["wait", "running"],
        ]);
    });
});
