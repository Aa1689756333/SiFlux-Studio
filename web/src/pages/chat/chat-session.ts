import { generationErrorMessage } from "@/lib/generation-error";
import { getActiveUserScope } from "@/lib/user-scope";
import { captureUserScope, userScopeMatches } from "@/lib/user-scope-guard";
import type { AiConfig } from "@/stores/use-config-store";

import {
    chatHistoryForRequest,
    conversationTitle,
    emptyChatConversation,
    loadChatHistory,
    removeChatConversation,
    saveChatHistory,
    settleIncompleteChatConversations,
    upsertChatConversation,
    type ChatConversation,
    type ChatMessage,
} from "./chat-history";
import { runStandaloneChatTurn } from "./chat-run";

type LiveTurn = {
    controller: AbortController;
    messageId: string;
};

let conversations: ChatConversation[] = [];
let snapshot = { conversations, liveIds: [] as string[] };
let hydratedScope = "";
let hydratePromise: Promise<void> | null = null;
const turns = new Map<string, LiveTurn>();
const listeners = new Set<() => void>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let errorHandler: ((message: string) => void) | null = null;

function emit() {
    snapshot = { conversations, liveIds: [...turns.keys()] };
    listeners.forEach((listener) => listener());
    if (persistTimer != null) return;
    persistTimer = setTimeout(() => {
        persistTimer = null;
        void saveChatHistory(conversations);
    }, 0);
}

function setConversations(next: ChatConversation[]) {
    conversations = next;
    emit();
}

function patchConversation(conversationId: string, patch: (current: ChatConversation) => ChatConversation) {
    const current = conversations.find((item) => item.id === conversationId);
    if (!current) return;
    setConversations(upsertChatConversation(conversations, patch(current)));
}

export function subscribeStandaloneChat(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getStandaloneChatSnapshot() {
    return snapshot;
}

export function getStandaloneChatConversations() {
    return snapshot.conversations;
}

export function isStandaloneChatTurnActive(conversationId: string) {
    return turns.has(conversationId);
}

export function setStandaloneChatErrorHandler(handler: ((message: string) => void) | null) {
    errorHandler = handler;
    return () => {
        if (errorHandler === handler) errorHandler = null;
    };
}

export async function hydrateStandaloneChat(scope = getActiveUserScope()) {
    if (hydratedScope === scope && !hydratePromise) return;
    if (hydratePromise && hydratedScope === scope) {
        await hydratePromise;
        return;
    }
    hydratedScope = scope;
    hydratePromise = loadChatHistory(scope).then((history) => {
        const liveIds = [...turns.keys()];
        const liveById = new Map(conversations.filter((item) => turns.has(item.id)).map((item) => [item.id, item]));
        const merged = history.map((item) => liveById.get(item.id) || item);
        for (const item of liveById.values()) {
            if (!merged.some((candidate) => candidate.id === item.id)) merged.unshift(item);
        }
        setConversations(settleIncompleteChatConversations(merged, undefined, liveIds));
    }).finally(() => {
        hydratePromise = null;
    });
    await hydratePromise;
}

export function createStandaloneChatConversation(model = "") {
    const next = emptyChatConversation(model);
    setConversations(upsertChatConversation(conversations, next));
    return next;
}

export function deleteStandaloneChatConversation(conversationId: string) {
    const turn = turns.get(conversationId);
    turn?.controller.abort();
    turns.delete(conversationId);
    setConversations(removeChatConversation(conversations, conversationId));
}

export function stopStandaloneChatTurn(conversationId: string) {
    turns.get(conversationId)?.controller.abort();
}

export async function runStandaloneChatConversationTurn(options: {
    text: string;
    conversation: ChatConversation;
    config: AiConfig;
    model: string;
}) {
    if (turns.has(options.conversation.id)) return options.conversation.id;
    const expectedScope = captureUserScope();
    const controller = new AbortController();
    const now = new Date().toISOString();
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: options.text, createdAt: now, status: "succeeded" };
    const assistantMessage: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content: "", createdAt: now, status: "streaming" };
    const draft: ChatConversation = {
        ...options.conversation,
        model: options.model,
        title: conversationTitle({ ...options.conversation, messages: [...options.conversation.messages, userMessage] }),
        updatedAt: now,
        messages: [...options.conversation.messages, userMessage, assistantMessage],
    };
    turns.set(draft.id, { controller, messageId: assistantMessage.id });
    setConversations(upsertChatConversation(conversations, draft));
    try {
        const result = await runStandaloneChatTurn({
            prompt: options.text,
            history: chatHistoryForRequest(options.conversation.messages),
            config: options.config,
            model: options.model,
            conversationId: draft.id,
            messageId: assistantMessage.id,
            signal: controller.signal,
            expectedScope,
            onTextDelta: (value) => {
                if (!userScopeMatches(expectedScope)) return;
                patchConversation(draft.id, (current) => ({
                    ...current,
                    updatedAt: new Date().toISOString(),
                    messages: current.messages.map((item) => item.id === assistantMessage.id ? { ...item, content: value, status: "streaming" } : item),
                }));
            },
        });
        if (!userScopeMatches(expectedScope)) return draft.id;
        const reply = result.text?.trim() || "";
        if (!reply) throw new Error("模型没有返回文本");
        patchConversation(draft.id, (current) => ({
            ...current,
            updatedAt: new Date().toISOString(),
            messages: current.messages.map((item) => item.id === assistantMessage.id ? { ...item, content: reply, status: "succeeded", error: undefined } : item),
        }));
    } catch (error) {
        if (!userScopeMatches(expectedScope)) return draft.id;
        const cancelled = controller.signal.aborted;
        patchConversation(draft.id, (current) => ({
            ...current,
            updatedAt: new Date().toISOString(),
            messages: current.messages.map((item) => item.id === assistantMessage.id
                ? { ...item, status: cancelled ? "cancelled" : "failed", error: cancelled ? undefined : generationErrorMessage(error) }
                : item),
        }));
        if (!cancelled) errorHandler?.(generationErrorMessage(error));
    } finally {
        const current = turns.get(draft.id);
        if (current?.controller === controller) turns.delete(draft.id);
        emit();
    }
    return draft.id;
}
