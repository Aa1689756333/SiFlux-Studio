import { expect, test } from "bun:test";

import { protocolForRelayCatalog } from "../src/lib/model-protocols";

// 自有中转站按 supported_endpoint_types 决定文本协议。顺序遵循中转站返回的数组：
// 数组是它的优先级声明，客户端不另立一套顺序。
test("follows the relay's own endpoint order", () => {
    expect(protocolForRelayCatalog(["openai", "openai-response", "anthropic"], "text")).toBe("chat-completion");
    expect(protocolForRelayCatalog(["openai-response", "anthropic"], "text")).toBe("openai-response");
    expect(protocolForRelayCatalog(["anthropic"], "text")).toBe("claude-api");
});

test("a single-protocol model keeps its only protocol", () => {
    expect(protocolForRelayCatalog(["openai"], "text")).toBe("chat-completion");
});

test("spells out the protocol from every accepted alias", () => {
    expect(protocolForRelayCatalog(["chat.completions"], "text")).toBe("chat-completion");
    expect(protocolForRelayCatalog(["responses"], "text")).toBe("openai-response");
    expect(protocolForRelayCatalog(["messages"], "text")).toBe("claude-api");
});

// 数组缺失、为空、或全是不认识的端点时不能凭空发明协议，
// 交给预设与用户配置决定（文本默认 chat-completion，等价于 chat 优先）。
test("never invents a protocol without a usable endpoint type", () => {
    expect(protocolForRelayCatalog([], "text")).toBeUndefined();
    expect(protocolForRelayCatalog(undefined, "text")).toBeUndefined();
    expect(protocolForRelayCatalog(["unknown-endpoint"], "text")).toBeUndefined();
});

// 图像、视频、音频的协议仍由预设或用户配置给出。
test("leaves non-text capabilities to presets and user configuration", () => {
    expect(protocolForRelayCatalog(["openai"], "image")).toBeUndefined();
    expect(protocolForRelayCatalog(["openai"], "video")).toBeUndefined();
    expect(protocolForRelayCatalog(["openai"], "audio")).toBeUndefined();
});
