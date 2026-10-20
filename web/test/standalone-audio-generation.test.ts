import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
    audioGenerationJobCanRetrieve,
    parseAudioGenerationHistory,
    removeAudioGenerationJob,
    upsertAudioGenerationJob,
    type AudioGenerationJob,
} from "../src/pages/generate-audio/generate-audio-history";
import {
    AUDIO_GENERATION_SOURCE,
    AUDIO_GENERATION_WAIT_MS,
    audioGenerationErrorIsRetrievable,
    standaloneAudioRequestConfig,
} from "../src/pages/generate-audio/generate-audio-run";

const root = resolve(import.meta.dir, "..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");

function sampleJob(overrides: Partial<AudioGenerationJob> = {}): AudioGenerationJob {
    return {
        id: "job-1",
        createdAt: "2026-10-19T01:00:00.000Z",
        updatedAt: "2026-10-19T01:00:00.000Z",
        prompt: "请用温和的旁白读这段话",
        model: "demo-audio",
        audioVoice: "alloy",
        audioFormat: "mp3",
        audioSpeed: "1",
        audioPitch: "0",
        audioVolume: "1",
        audioInstructions: "",
        status: "succeeded",
        taskIds: ["task-1"],
        assetIds: ["asset-1"],
        ...overrides,
    };
}

describe("standalone audio generation page", () => {
    test("home and sidebar open the standalone page instead of a new canvas", () => {
        const sidebar = read("src/components/layout/workspace-sidebar-nav.tsx");
        const router = read("src/router.tsx");
        expect(sidebar).toContain('to: "/generate/audio"');
        expect(sidebar).not.toContain('to: "/canvas?mode=new&add=audio"');
        expect(sidebar).toContain('title: "音频生成"');
        expect(sidebar).toContain('to: "/generate/audio"');
        expect(sidebar).toContain('pathname.startsWith("/generate/audio") ? "audio"');
        expect(router).toContain('path: "/generate/audio"');
        expect(router).toContain("loadGenerateAudioPage");
    });

    test("generation reuses the backend audio task pipeline without creating a canvas", () => {
        const run = read("src/pages/generate-audio/generate-audio-run.ts");
        const page = read("src/pages/generate-audio/index.tsx");
        expect(run).toContain("runBackendGenerationTask");
        expect(run).toContain('mode: "audio"');
        expect(run).toContain("materializeGenerationTaskAssets");
        expect(run).toContain("timeoutMs: AUDIO_GENERATION_WAIT_MS");
        expect(run).not.toContain("createCanvas");
        expect(run).not.toContain("use-canvas-store");
        expect(page).not.toContain("/canvas?mode=new");
        expect(page).toContain("本页历史");
        expect(page).toContain("hydrateStandaloneAudio");
        expect(page).toContain("离开本页后仍会继续");
        expect(page).not.toContain("请保持页面打开");
        expect(page).toContain("liveIds");
        expect(read("src/lib/standalone-generation-store.ts")).toContain("liveIds");
        expect(AUDIO_GENERATION_WAIT_MS).toBe(30 * 60 * 1000);
        expect(AUDIO_GENERATION_SOURCE).toBe("standalone-audio-page");
    });

    test("history parse, upsert and delete keep asset ids untouched", () => {
        const assets = [{ id: "asset-1" }, { id: "asset-2" }];
        const parsed = parseAudioGenerationHistory([
            { id: "job-1", prompt: "旁白", model: "m", status: "succeeded", taskIds: ["t1"], assetIds: ["asset-1"] },
            { id: "", prompt: "丢弃" },
        ]);
        expect(parsed).toHaveLength(1);
        expect(parsed[0]?.assetIds).toEqual(["asset-1"]);
        const next = upsertAudioGenerationJob(parsed, sampleJob({ id: "job-2", assetIds: ["asset-2"] }));
        expect(next.map((job) => job.id)).toEqual(["job-2", "job-1"]);
        const removed = removeAudioGenerationJob(next, "job-2");
        expect(removed.map((job) => job.id)).toEqual(["job-1"]);
        expect(assets).toEqual([{ id: "asset-1" }, { id: "asset-2" }]);
    });

    test("timeout with task ids is retrievable and does not look like a new submit", () => {
        expect(audioGenerationErrorIsRetrievable(new Error("任务执行超时，请稍后重试"), ["task-1"])).toBe(true);
        expect(audioGenerationErrorIsRetrievable(new Error("任务执行超时，请稍后重试"), [])).toBe(false);
        expect(audioGenerationJobCanRetrieve(sampleJob({ status: "retrievable", taskIds: ["task-1"] }))).toBe(true);
        expect(audioGenerationJobCanRetrieve(sampleJob({ status: "failed", taskIds: ["task-1"] }))).toBe(false);
        const run = read("src/pages/generate-audio/generate-audio-run.ts");
        expect(run).toContain("resumeStandaloneAudioGeneration");
        expect(run).toContain("queryGenerationTask");
        expect(run).not.toMatch(/resumeStandaloneAudioGeneration[\s\S]*runBackendGenerationTask/);
    });

    test("request config pins the selected audio model and speech settings", () => {
        const config = standaloneAudioRequestConfig(
            {
                model: "other",
                audioModel: "other",
                audioVoice: "echo",
                audioFormat: "wav",
                audioSpeed: "1.5",
                channels: [],
            } as never,
            "picked-audio",
            { audioVoice: "alloy", audioFormat: "mp3", audioSpeed: "1" },
        );
        expect(config.model).toBe("picked-audio");
        expect(config.audioModel).toBe("picked-audio");
        expect(config.audioVoice).toBe("alloy");
        expect(config.audioFormat).toBe("mp3");
        expect(config.audioSpeed).toBe("1");
    });
});
