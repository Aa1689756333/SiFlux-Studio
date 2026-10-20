import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";

export const STANDALONE_CHAT_HISTORY_KEY = "standalone-chat-history-v1";
const MAX_CONVERSATIONS = 80;
const MAX_MESSAGES = 200;

export type ChatMessageStatus = "pending" | "streaming" | "succeeded" | "failed" | "cancelled";

export type ChatMessage = {
    id: string;
    role: "user" | "assistant";
    content: string;
    createdAt: string;
    status?: ChatMessageStatus;
    error?: string;
};

export type ChatConversation = {
    id: string;
    title: string;
    model: string;
    createdAt: string;
    updatedAt: string;
    messages: ChatMessage[];
};

function isStatus(value: unknown): value is ChatMessageStatus {
    return value === "pending" || value === "streaming" || value === "succeeded" || value === "failed" || value === "cancelled";
}

function parseMessage(value: unknown): ChatMessage | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const role = record.role === "assistant" ? "assistant" : record.role === "user" ? "user" : "";
    if (!id || !role) return null;
    const createdAt = typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString();
    return {
        id,
        role,
        content: typeof record.content === "string" ? record.content : "",
        createdAt,
        status: isStatus(record.status) ? record.status : "succeeded",
        error: typeof record.error === "string" ? record.error : undefined,
    };
}

export function parseChatHistory(raw: unknown): ChatConversation[] {
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const record = item as Record<string, unknown>;
        const id = typeof record.id === "string" ? record.id.trim() : "";
        if (!id) return [];
        const createdAt = typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString();
        const messages = Array.isArray(record.messages) ? record.messages.flatMap((message) => {
            const parsed = parseMessage(message);
            return parsed ? [parsed] : [];
        }).slice(-MAX_MESSAGES) : [];
        return [{
            id,
            title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : "新对话",
            model: typeof record.model === "string" ? record.model : "",
            createdAt,
            updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : createdAt,
            messages,
        }];
    }).slice(0, MAX_CONVERSATIONS);
}

export function conversationTitle(conversation: ChatConversation) {
    const first = conversation.messages.find((item) => item.role === "user" && item.content.trim());
    return first?.content.trim().slice(0, 28) || conversation.title || "新对话";
}

export function emptyChatConversation(model = ""): ChatConversation {
    const now = new Date().toISOString();
    return { id: crypto.randomUUID(), title: "新对话", model, createdAt: now, updatedAt: now, messages: [] };
}

export function upsertChatConversation(conversations: ChatConversation[], next: ChatConversation) {
    const remaining = conversations.filter((item) => item.id !== next.id);
    return [next, ...remaining].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, MAX_CONVERSATIONS);
}

export function removeChatConversation(conversations: ChatConversation[], conversationId: string) {
    return conversations.filter((item) => item.id !== conversationId);
}

export function isIncompleteChatStatus(status?: ChatMessageStatus) {
    return status === "pending" || status === "streaming";
}

export function settleIncompleteChatConversations(conversations: ChatConversation[], conversationId?: string, exceptIds?: Iterable<string>) {
    const except = exceptIds ? new Set(exceptIds) : null;
    let changed = false;
    const next = conversations.map((item) => {
        if (conversationId && item.id !== conversationId) return item;
        if (except?.has(item.id)) return item;
        let messagesChanged = false;
        const messages = item.messages.map((message) => {
            if (!isIncompleteChatStatus(message.status)) return message;
            messagesChanged = true;
            return { ...message, status: "cancelled" as const };
        });
        if (!messagesChanged) return item;
        changed = true;
        return { ...item, messages, updatedAt: new Date().toISOString() };
    });
    return changed ? next : conversations;
}

export function chatHistoryForRequest(messages: ChatMessage[]) {
    return messages
        .filter((item) => item.role !== "assistant" || item.status === "succeeded")
        .filter((item) => item.content.trim())
        .map((item) => ({ role: item.role, content: item.content }));
}

export async function loadChatHistory(scope = getActiveUserScope()) {
    const storage = localForageStorageForScope(scope);
    const raw = await storage.getItem(STANDALONE_CHAT_HISTORY_KEY);
    if (!raw) return [];
    try {
        return parseChatHistory(typeof raw === "string" ? JSON.parse(raw) as unknown : raw);
    } catch {
        return [];
    }
}

export async function saveChatHistory(conversations: ChatConversation[], scope = getActiveUserScope()) {
    const storage = localForageStorageForScope(scope);
    await storage.setItem(STANDALONE_CHAT_HISTORY_KEY, JSON.stringify(conversations.slice(0, MAX_CONVERSATIONS)));
}
