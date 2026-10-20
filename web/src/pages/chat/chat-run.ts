import { runBackendGenerationTask } from "@/services/api/generation-task";
import { captureUserScope, type CapturedUserScope } from "@/lib/user-scope-guard";
import type { AiConfig } from "@/stores/use-config-store";

export const CHAT_SOURCE = "standalone-chat-page";

export function standaloneChatRequestConfig(config: AiConfig, model: string): AiConfig {
    return {
        ...config,
        model,
        textModel: model,
    };
}

export async function runStandaloneChatTurn(options: {
    prompt: string;
    history: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    config: AiConfig;
    model: string;
    conversationId: string;
    messageId: string;
    signal?: AbortSignal;
    expectedScope?: CapturedUserScope;
    onTextDelta?: (text: string) => void;
}) {
    const prompt = options.prompt.trim();
    if (!prompt) throw new Error("请先输入要发送的内容");
    if (!options.model.trim()) throw new Error("请先选择文本模型");
    return runBackendGenerationTask({
        mode: "text",
        prompt,
        config: standaloneChatRequestConfig(options.config, options.model),
        textHistory: options.history,
        signal: options.signal,
        metadata: { source: CHAT_SOURCE, conversationId: options.conversationId, messageId: options.messageId },
        streamText: true,
        onTextDelta: options.onTextDelta,
        expectedScope: options.expectedScope ?? captureUserScope(),
    });
}
