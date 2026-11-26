import { expect, test } from "bun:test";
import { testChannelModelConnection } from "@/lib/model-connection-test";
import { createModelChannel } from "@/stores/use-config-store";

const channel = createModelChannel({ id: "test", apiKey: "fake", baseUrl: "https://example.invalid", models: ["test-model"] });

test("text requires final nonempty content", async () => {
    expect(await testChannelModelConnection(channel, "test-model", "text", "chat-completion", async () => ({ text: "OK" }))).toContain("文本响应");
    await expect(testChannelModelConnection(channel, "test-model", "text", "chat-completion", async () => ({ text: " " }))).rejects.toThrow("没有返回可用结果");
});
test("media requires a final result, not only a submitted task", async () => {
    expect(await testChannelModelConnection(channel, "test-model", "image", "openai-image", async () => ({ images: [{ dataUrl: "https://example.invalid/image.png" }] }))).toContain("已完成图片生成");
    await expect(testChannelModelConnection(channel, "test-model", "image", "openai-image", async () => ({}))).rejects.toThrow("没有返回可用结果");
});