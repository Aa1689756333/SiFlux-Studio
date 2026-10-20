import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { chatHistoryForRequest, parseChatHistory, removeChatConversation, settleIncompleteChatConversations, upsertChatConversation } from "../src/pages/chat/chat-history";
import { CHAT_SOURCE, standaloneChatRequestConfig } from "../src/pages/chat/chat-run";

const root = resolve(import.meta.dir, "..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");

describe("standalone chat page", () => {
    test("home and sidebar open /chat instead of a new canvas", () => {
        const sidebar = read("src/components/layout/workspace-sidebar-nav.tsx");
        const router = read("src/router.tsx");
        expect(sidebar).toContain('title: "文本对话"');
        expect(sidebar).toContain('to: "/chat"');
        expect(router).toContain('path: "/chat"');
        expect(router).toContain("loadChatPage");
    });

    test("chat is a standalone text generation page, not the agent host", () => {
        const page = read("src/pages/chat/index.tsx");
        const run = read("src/pages/chat/chat-run.ts");
        const session = read("src/pages/chat/chat-session.ts");
        expect(page).not.toContain("AgentWorkspace");
        expect(page).not.toContain("useCanvasAssistant");
        expect(page).not.toContain("/assistant/chat");
        expect(page).not.toContain("restartHost");
        expect(page).toContain("runStandaloneChatConversationTurn");
        expect(page).toContain("hydrateStandaloneChat");
        expect(page).toContain("AIMessageMarkdown");
        expect(page).toContain("重新生成");
        expect(page).toContain("siflux-chat-top");
        expect(page).toContain("configuredModelDisplayName");
        expect(page).not.toContain("不经过 Agent");
        expect(page).not.toContain("{active.model || model");
        expect(page).not.toContain("stopActiveTurn");
        expect(session).toContain("runStandaloneChatTurn");
        expect(session).not.toContain("abortRef.current?.abort()");
        expect(run).toContain("runBackendGenerationTask");
        expect(read("src/services/api/generation-task.ts")).not.toContain("appendLocalRequestUsage");
        expect(run).toContain('mode: "text"');
        expect(run).toContain(CHAT_SOURCE);
        expect(page).not.toContain("/canvas?mode=new");
        expect(page).not.toContain("createCanvas");
    });

    test("stores conversations and builds request history from completed turns", () => {
        const parsed = parseChatHistory([{
            id: "c1",
            title: "润色",
            model: "demo-text",
            createdAt: "2026-10-19T01:00:00.000Z",
            updatedAt: "2026-10-19T01:01:00.000Z",
            messages: [
                { id: "m1", role: "user", content: "你好", createdAt: "2026-10-19T01:00:00.000Z" },
                { id: "m2", role: "assistant", content: "你好，需要什么帮助？", createdAt: "2026-10-19T01:00:02.000Z", status: "succeeded" },
                { id: "m3", role: "assistant", content: "", createdAt: "2026-10-19T01:00:03.000Z", status: "streaming" },
            ],
        }]);
        expect(parsed[0]?.title).toBe("润色");
        expect(chatHistoryForRequest(parsed[0].messages)).toEqual([
            { role: "user", content: "你好" },
            { role: "assistant", content: "你好，需要什么帮助？" },
        ]);
        const next = upsertChatConversation(parsed, { ...parsed[0], title: "新标题", updatedAt: "2026-10-19T02:00:00.000Z" });
        expect(next[0].title).toBe("新标题");
        expect(removeChatConversation(next, "c1")).toEqual([]);
        expect(standaloneChatRequestConfig({ textModel: "old", model: "old" } as never, "demo-text")).toMatchObject({ model: "demo-text", textModel: "demo-text" });
    });

    test("stale waiting replies settle, but live turns keep streaming", () => {
        const page = read("src/pages/chat/index.tsx");
        const session = read("src/pages/chat/chat-session.ts");
        expect(page).toContain("createStandaloneChatConversation");
        expect(page).not.toContain("stopActiveTurn");
        expect(session).toContain("settleIncompleteChatConversations");
        expect(session).toContain("liveIds");
        const parsed = parseChatHistory([{
            id: "c1",
            title: "润色",
            model: "demo-text",
            createdAt: "2026-10-19T01:00:00.000Z",
            updatedAt: "2026-10-19T01:01:00.000Z",
            messages: [
                { id: "m1", role: "user", content: "你好", createdAt: "2026-10-19T01:00:00.000Z" },
                { id: "m2", role: "assistant", content: "一半", createdAt: "2026-10-19T01:00:03.000Z", status: "streaming" },
                { id: "m3", role: "assistant", content: "", createdAt: "2026-10-19T01:00:04.000Z", status: "pending" },
            ],
        }]);
        const settled = settleIncompleteChatConversations(parsed);
        expect(settled[0]?.messages.map((item) => item.status)).toEqual(["succeeded", "cancelled", "cancelled"]);
        const kept = settleIncompleteChatConversations(parsed, undefined, ["c1"]);
        expect(kept[0]?.messages.map((item) => item.status)).toEqual(["succeeded", "streaming", "pending"]);
        expect(settleIncompleteChatConversations(settled)).toBe(settled);
    });
});
