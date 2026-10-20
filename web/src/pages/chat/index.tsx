import { App } from "antd";
import { Copy, MessageSquarePlus, RotateCcw, Square, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";

import { AIMessageMarkdown } from "@/components/ai/ai-message-markdown";
import { WorkingDots } from "@/components/ai/working-indicator";
import { GenerationFailureNotice } from "@/components/generation/generation-failure-notice";
import { ModelPicker } from "@/components/model-picker";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { explainGenerationError } from "@/lib/generation-error";
import { configuredModelDisplayName } from "@/lib/model-selection";
import { selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";

import {
    conversationTitle,
    emptyChatConversation,
    isIncompleteChatStatus,
    type ChatConversation,
    type ChatMessage,
} from "./chat-history";
import {
    createStandaloneChatConversation,
    deleteStandaloneChatConversation,
    getStandaloneChatSnapshot,
    hydrateStandaloneChat,
    runStandaloneChatConversationTurn,
    setStandaloneChatErrorHandler,
    stopStandaloneChatTurn,
    subscribeStandaloneChat,
} from "./chat-session";
import "./chat.css";

const STARTERS = ["帮我润色这段文案", "把这段话写得更口语", "总结下面的内容", "把要点整理成条目"];

function conversationSummary(conversation: ChatConversation, live: boolean) {
    const last = conversation.messages.at(-1);
    if (!last) return "还没有消息";
    if (live) return "正在回复…";
    if (last.status === "failed") return "回复失败";
    if (last.status === "cancelled") return "已停止";
    return last.content.trim().slice(0, 36) || "空回复";
}

function elapsedLabel(startedAt: string, now: number) {
    const start = Date.parse(startedAt);
    if (!Number.isFinite(start)) return "";
    const seconds = Math.max(0, Math.floor((now - start) / 1000));
    if (seconds < 60) return `${seconds} 秒`;
    return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function ChatWorkingLabel({ startedAt }: { startedAt: string }) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(id);
    }, []);
    const elapsed = elapsedLabel(startedAt, now);
    return (
        <span className="siflux-chat-generating">
            <WorkingDots dotSize={5} gap={2} />
            <span>正在生成回复</span>
            {elapsed ? <span className="siflux-chat-generating-time">{elapsed}</span> : null}
        </span>
    );
}

function formatTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function messageText(item: ChatMessage, live: boolean) {
    if (item.content.trim()) return item.content;
    if (isIncompleteChatStatus(item.status) && live) return "";
    if (item.status === "cancelled" || isIncompleteChatStatus(item.status)) return "已停止";
    return item.error || "";
}

export default function ChatPage() {
    const { message: toast } = App.useApp();
    const navigate = useNavigate();
    const config = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const textModels = useMemo(() => selectableModelsByCapability(config, "text"), [config]);
    const [model, setModel] = useState(config.textModel || textModels[0] || "");
    const [prompt, setPrompt] = useState("");
    const snapshot = useSyncExternalStore(subscribeStandaloneChat, getStandaloneChatSnapshot, getStandaloneChatSnapshot);
    const conversations = snapshot.conversations;
    const [activeId, setActiveId] = useState("");
    const [hydrated, setHydrated] = useState(false);
    const logRef = useRef<HTMLDivElement | null>(null);

    const active = conversations.find((item) => item.id === activeId) || conversations[0];
    const live = Boolean(active && snapshot.liveIds.includes(active.id));

    useEffect(() => {
        if (model && textModels.includes(model)) return;
        setModel(config.textModel && textModels.includes(config.textModel) ? config.textModel : textModels[0] || "");
    }, [config.textModel, model, textModels]);

    useEffect(() => setStandaloneChatErrorHandler((text) => toast.error(text)), [toast]);

    useEffect(() => {
        let cancelled = false;
        void hydrateStandaloneChat().then(() => {
            if (!cancelled) setHydrated(true);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!hydrated) return;
        if (activeId && conversations.some((item) => item.id === activeId)) return;
        setActiveId(conversations[0]?.id || "");
    }, [activeId, conversations, hydrated]);

    useEffect(() => {
        const node = logRef.current;
        if (!node) return;
        node.scrollTop = node.scrollHeight;
    }, [active?.messages]);

    const startConversation = () => {
        const next = createStandaloneChatConversation(model);
        setActiveId(next.id);
        setPrompt("");
    };

    const sendFrom = async (text: string, conversation: ChatConversation) => {
        const id = await runStandaloneChatConversationTurn({ text, conversation, config, model });
        if (id) setActiveId(id);
    };

    const send = async (raw?: string) => {
        const text = (raw ?? prompt).trim();
        if (!text) {
            toast.warning("请先输入要发送的内容");
            return;
        }
        if (!model) {
            toast.warning("请先在模型配置中添加文本模型");
            navigate("/settings?section=channels");
            return;
        }
        await sendFrom(text, active || emptyChatConversation(model));
    };

    const regenerate = (assistantId: string) => {
        if (!active || live) return;
        const index = active.messages.findIndex((item) => item.id === assistantId);
        if (index < 0) return;
        const previous = active.messages.slice(0, index);
        const user = [...previous].reverse().find((item) => item.role === "user" && item.content.trim());
        if (!user) return;
        void sendFrom(user.content, { ...active, messages: previous });
    };

    const copyMessage = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            toast.success("已复制");
        } catch {
            toast.error("复制失败");
        }
    };

    const failed = [...(active?.messages || [])].reverse().find((item) => item.role === "assistant" && item.status === "failed");

    return (
        <WorkspacePage className="siflux-chat-page" fluid scroll={false} sectionPage={false}>
            <div className="siflux-chat">
                <aside className="siflux-chat-sidebar" aria-label="对话列表">
                    <div className="siflux-chat-brand">
                        <strong>文本对话</strong>
                        <span>本地会话，直接走文本模型</span>
                    </div>
                    <button type="button" className="siflux-chat-new" onClick={startConversation}>
                        <MessageSquarePlus size={16} />新对话
                    </button>
                    {conversations.length ? (
                        <ul>
                            {conversations.map((item) => (
                                <li key={item.id} className={`siflux-chat-history-item${item.id === active?.id ? " is-active" : ""}`}>
                                    <button type="button" onClick={() => setActiveId(item.id)}>
                                        <strong>{conversationTitle(item)}</strong>
                                        <small>{conversationSummary(item, snapshot.liveIds.includes(item.id))}</small>
                                    </button>
                                    <button type="button" className="siflux-chat-history-delete" aria-label="删除这段对话" onClick={() => {
                                        deleteStandaloneChatConversation(item.id);
                                        if (activeId === item.id) setActiveId("");
                                    }}><Trash2 size={14} /></button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="siflux-chat-sidebar-empty">还没有会话。发一条就会出现在这里。</p>
                    )}
                </aside>
                <section className="siflux-chat-main">
                    <header className="siflux-chat-top">
                        <h1>{active ? conversationTitle(active) : "文本对话"}</h1>
                    </header>
                    <div ref={logRef} className="siflux-chat-thread" aria-label="对话内容">
                        {!active?.messages.length ? (
                            <div className="siflux-chat-empty">
                                <strong>开始一段纯文本对话</strong>
                                <div className="siflux-chat-starters">
                                    {STARTERS.map((item) => (
                                        <button key={item} type="button" onClick={() => void send(item)}>{item}</button>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="siflux-chat-messages">
                                {active.messages.map((item) => {
                                    const streaming = live && isIncompleteChatStatus(item.status);
                                    const text = messageText(item, live);
                                    return (
                                        <article key={item.id} className={`siflux-chat-row is-${item.role}${item.status === "failed" ? " is-failed" : ""}${streaming ? " is-streaming" : ""}`}>
                                            <div className="siflux-chat-avatar" aria-hidden="true">{item.role === "user" ? "你" : "AI"}</div>
                                            <div className="siflux-chat-row-main">
                                                <header>
                                                    {item.role === "assistant" ? <strong>{configuredModelDisplayName(config, active.model || model) || "模型"}</strong> : null}
                                                    <time dateTime={item.createdAt}>{formatTime(item.createdAt)}</time>
                                                    {streaming ? <ChatWorkingLabel startedAt={item.createdAt} /> : null}
                                                    {item.status === "failed" ? <span>失败</span> : null}
                                                    {item.status === "cancelled" || (!streaming && isIncompleteChatStatus(item.status)) ? <span>已停止</span> : null}
                                                </header>
                                                {item.role === "assistant" ? (
                                                    text ? <AIMessageMarkdown isStreaming={streaming}>{text}</AIMessageMarkdown> : streaming ? (
                                                        <div className="siflux-chat-placeholder is-working" aria-live="polite">
                                                            <span className="siflux-chat-skeleton" aria-hidden="true"><span /><span /><span /></span>
                                                        </div>
                                                    ) : <p className="siflux-chat-placeholder">没有文本</p>
                                                ) : (
                                                    <p className="siflux-chat-user-text">{text}</p>
                                                )}
                                                {item.role === "assistant" && !streaming ? (
                                                    <div className="siflux-chat-row-actions">
                                                        {text && text !== "已停止" ? <button type="button" onClick={() => void copyMessage(text)}><Copy size={13} />复制</button> : null}
                                                        <button type="button" disabled={live} onClick={() => regenerate(item.id)}><RotateCcw size={13} />重新生成</button>
                                                    </div>
                                                ) : null}
                                            </div>
                                        </article>
                                    );
                                })}
                                {failed?.error ? <GenerationFailureNotice explanation={explainGenerationError(failed.error)} /> : null}
                            </div>
                        )}
                    </div>
                    <form className="siflux-chat-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
                        <textarea
                            className="siflux-chat-prompt"
                            value={prompt}
                            onChange={(event) => setPrompt(event.target.value)}
                            placeholder="输入要发给模型的内容，Enter 发送，Shift+Enter 换行"
                            rows={3}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" && !event.shiftKey) {
                                    event.preventDefault();
                                    void send();
                                }
                            }}
                        />
                        <div className="siflux-chat-toolbar">
                            <ModelPicker
                                className="siflux-chat-model min-w-0"
                                config={config}
                                value={model}
                                capability="text"
                                onChange={(value) => {
                                    setModel(value);
                                    updateConfig("textModel", value);
                                    updateConfig("model", value);
                                }}
                                onMissingConfig={() => navigate("/settings?section=channels")}
                            />
                            {live ? (
                                <button type="button" className="siflux-chat-action" onClick={() => stopStandaloneChatTurn(active.id)}>
                                    <Square size={12} />停止
                                </button>
                            ) : (
                                <button type="submit" className="siflux-chat-action is-primary" disabled={!prompt.trim()}>发送</button>
                            )}
                        </div>
                    </form>
                </section>
            </div>
        </WorkspacePage>
    );
}
