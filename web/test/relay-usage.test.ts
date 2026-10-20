import { describe, expect, test } from "bun:test";

import {
    applyEstimatedQuota,
    estimateRelayQuota,
    formatRelayModelPrice,
    formatRelayLogCache,
    formatRelayLogCost,
    formatRelayMoney,
    formatRelayPercent,
    formatUsageDay,
    relayOverviewInsights,
    heatmapLevel,
    isRelayRateLimit,
    heatmapMonthLabels,
    hasRealRelayMeter,
    mergeRelaySitePricing,
    mergeUsageLogs,
    parseNewApiLogPage,
    parseNewApiLogs,
    parseNewApiTokenUsage,
    relayHeatmapWeeks,
    relayHttpError,
    parseNewApiUserSelf,
    parseOpenAIBilling,
    relaySiteRoot,
    shouldFetchNextLogPage,
    shouldSkipUsageCapture,
    summarizeRelayLogs,
    uniqueRelayErrors,
    usageLogFromChannelResponse,
    usageLogFromGenerationTask,
} from "@/lib/relay-usage";

describe("relay usage", () => {
    test("strips /v1 from the channel base url", () => {
        expect(relaySiteRoot("https://relay.example.com/v1")).toBe("https://relay.example.com");
        expect(relaySiteRoot("https://relay.example.com/v1/")).toBe("https://relay.example.com");
        expect(relaySiteRoot("https://relay.example.com")).toBe("https://relay.example.com");
    });

    test("parses New API user self quota", () => {
        expect(parseNewApiUserSelf({
            success: true,
            data: { quota: 800000, used_quota: 200000, request_count: 12 },
        })).toEqual({
            usedQuota: 200000,
            remainQuota: 800000,
            totalQuota: 1000000,
            requestCount: 12,
            source: "user_self",
            unit: "quota",
        });
        expect(parseNewApiTokenUsage({
            code: true,
            data: { object: "token_usage", total_granted: 1000000, total_used: 200000, total_available: 800000 },
        })).toMatchObject({ usedQuota: 200000, remainQuota: 800000, source: "token_usage", unit: "quota" });
        expect(parseNewApiTokenUsage({
            code: true,
            data: { object: "token_usage", total_used: 12, unlimited_quota: true },
        })).toMatchObject({ usedQuota: 12, unlimited: true, source: "token_usage" });
        expect(relayHttpError({}, 301)).toBe("HTTP 301");
    });

    test("parses billing fallback and detailed consumption logs", () => {
        expect(parseOpenAIBilling({ hard_limit_usd: 20 }, { total_usage: 5 })).toMatchObject({
            usedQuota: 5,
            remainQuota: 15,
            source: "billing",
            unit: "usd",
        });
        const page = parseNewApiLogPage({
            success: true,
            total: 120,
            data: [
                {
                    id: 9,
                    created_at: 1760875200,
                    model_name: "gpt-4.1",
                    token_name: "studio",
                    type: 2,
                    prompt_tokens: 100,
                    completion_tokens: 40,
                    quota: 500,
                    use_time: 3,
                    other: "{\"cache_tokens\":12}",
                },
            ],
        });
        expect(page.total).toBe(120);
        expect(page.logs[0]).toMatchObject({
            model: "gpt-4.1",
            tokenName: "studio",
            promptTokens: 100,
            completionTokens: 40,
            cacheTokens: 12,
            quota: 500,
            durationSec: 3,
        });
        expect(summarizeRelayLogs(page.logs)).toMatchObject({ promptTokens: 100, completionTokens: 40, cacheTokens: 12, quota: 500, requests: 1 });
        const insights = relayOverviewInsights([
            { ...page.logs[0], createdAt: "2026-10-20T07:20:28.000Z", model: "siflux::free-agnes-2.5-flash" },
            {
                ...page.logs[0],
                id: "10",
                createdAt: "2026-10-19T07:20:28.000Z",
                model: "gpt-4.1",
                promptTokens: 10,
                completionTokens: 2,
                cacheTokens: 0,
            },
        ]);
        expect(insights).toMatchObject({ tokens: 152, cacheHitRate: 12 / 110, activeDays: 2, longestStreak: 2, topModel: "free-agnes-2.5-flash", topModelTokens: 140 });
        expect(formatRelayPercent(insights.cacheHitRate)).toBe("10.9%");
        expect(formatUsageDay(insights.peakDay)).toMatch(/月/);
        expect(insights.dailyAvgTokens).toBe(76);
    });

    test("builds a year heatmap by local week", () => {
        const now = Date.parse("2026-10-19T12:00:00+08:00");
        const weeks = relayHeatmapWeeks([{
            id: "1",
            createdAt: "2026-10-19T04:00:00.000Z",
            model: "gpt-4.1",
            tokenName: "",
            type: 2,
            promptTokens: 100,
            completionTokens: 20,
            cacheTokens: 0,
            quota: 500,
            durationSec: 1,
            content: "",
            isStream: false,
            source: "local",
        }], now);
        expect(weeks[0]).toHaveLength(7);
        expect(weeks.length).toBeGreaterThanOrEqual(52);
        expect(weeks.length).toBeLessThanOrEqual(54);
        expect(weeks.flat().find((cell) => cell.tokens > 0)).toMatchObject({ tokens: 120, quota: 500, requests: 1 });
        expect(heatmapMonthLabels(weeks).some((item) => item.label.endsWith("月"))).toBe(true);
        expect(heatmapLevel(0, 100)).toBe(0);
        expect(heatmapLevel(100, 100)).toBe(4);
    });

    test("paginates until a short page or the advertised total", () => {
        expect(shouldFetchNextLogPage(1, 100, 100, 100, 250)).toBe(true);
        expect(shouldFetchNextLogPage(2, 100, 100, 200, 200)).toBe(false);
        expect(shouldFetchNextLogPage(1, 40, 100, 40, 40)).toBe(false);
        expect(shouldFetchNextLogPage(50, 100, 100, 5000, 8000)).toBe(false);
    });

    test("merges local capture without duplicating relay rows", () => {
        const relay = parseNewApiLogs({
            data: [{ id: 1, created_at: 1760875200, model_name: "gpt-4.1", prompt_tokens: 100, completion_tokens: 40, quota: 500 }],
        });
        const local = [{
            ...relay[0],
            id: "local:dup",
            source: "local" as const,
            createdAt: new Date(1760875200 * 1000 + 800).toISOString(),
        }, {
            id: "local:extra",
            createdAt: new Date(1760878800 * 1000).toISOString(),
            model: "gpt-4.1",
            tokenName: "",
            type: 2,
            promptTokens: 10,
            completionTokens: 4,
            cacheTokens: 0,
            quota: 0,
            durationSec: 0,
            content: "",
            isStream: false,
            source: "local" as const,
        }];
        const merged = mergeUsageLogs(relay, local);
        expect(merged).toHaveLength(2);
        expect(merged.some((row) => row.id === "local:extra")).toBe(true);
        const hollow = mergeUsageLogs([{
            id: "task:chat-1",
            createdAt: "2026-10-20T07:20:29.000Z",
            model: "siflux::free-agnes-2.5-flash",
            tokenName: "本机",
            type: 2,
            promptTokens: 1,
            completionTokens: 9,
            cacheTokens: 0,
            quota: 0,
            durationSec: 2,
            content: "你好",
            isStream: true,
            source: "local" as const,
        }], [{
            id: "88",
            createdAt: "2026-10-20T07:20:28.000Z",
            model: "free-agnes-2.5-flash",
            tokenName: "default",
            type: 2,
            promptTokens: 285,
            completionTokens: 56,
            cacheTokens: 256,
            quota: 0,
            durationSec: 2,
            content: "",
            isStream: true,
            source: "relay" as const,
        }]);
        expect(hollow).toHaveLength(1);
        expect(hollow[0]).toMatchObject({
            promptTokens: 285,
            completionTokens: 56,
            cacheTokens: 256,
            tokenName: "default",
            content: "你好",
            model: "free-agnes-2.5-flash",
        });
    });

    test("records usage from generation responses and skips billing reads", () => {
        expect(shouldSkipUsageCapture("https://relay.example.com/api/log/self")).toBe(true);
        expect(shouldSkipUsageCapture("https://relay.example.com/api/pricing")).toBe(true);
        expect(shouldSkipUsageCapture("https://relay.example.com/api/status")).toBe(true);
        const log = usageLogFromChannelResponse(
            "https://relay.example.com/v1/chat/completions",
            { model: "gpt-4.1" },
            { usage: { prompt_tokens: 20, completion_tokens: 8, prompt_tokens_details: { cached_tokens: 3 } } },
        );
        expect(log).toMatchObject({ model: "gpt-4.1", promptTokens: 20, completionTokens: 8, cacheTokens: 3, source: "local" });
        expect(hasRealRelayMeter({ account: null, logs: [] })).toBe(false);
        expect(hasRealRelayMeter({ account: null, logs: [log!] })).toBe(true);
        expect(hasRealRelayMeter({ account: parseNewApiTokenUsage({ data: { total_used: 1, total_available: 2, total_granted: 3 } }), logs: [] })).toBe(true);
        const imageLog = usageLogFromChannelResponse(
            "https://relay.example.com/v1/images/generations",
            { model: "gpt-image-2", n: 2, prompt: "cat" },
            { created: 1, data: [{ url: "https://cdn.example/a.png" }, { url: "https://cdn.example/b.png" }] },
        );
        expect(imageLog).toMatchObject({ model: "gpt-image-2", promptTokens: 0, completionTokens: 0, units: 2, source: "local" });
        expect(hasRealRelayMeter({ account: null, logs: [imageLog!] })).toBe(true);
        const taskLog = usageLogFromGenerationTask({
            id: "task-chat-1",
            status: "succeeded",
            model: "claude-haiku-4-5",
            prompt: "你好",
            type: "canvas_text",
            createdAt: "2026-10-19T08:00:00.000Z",
            completedAt: "2026-10-19T08:00:08.000Z",
            startedAt: "2026-10-19T08:00:01.000Z",
            resultJson: JSON.stringify({ mode: "text", text: "你好", usage: { prompt_tokens: 12, completion_tokens: 4 } }),
        });
        expect(taskLog).toMatchObject({
            id: "task:task-chat-1",
            model: "claude-haiku-4-5",
            promptTokens: 12,
            completionTokens: 4,
            content: "你好",
            isStream: true,
            durationSec: 7,
        });
        expect(usageLogFromGenerationTask({
            id: "queued",
            status: "running",
            createdAt: "2026-10-19T08:00:00.000Z",
        })).toBeNull();
    });

    test("estimates cost from the site price table without inventing a currency", () => {
        const pricing = mergeRelaySitePricing(
            { data: { quota_per_unit: 250000, display_in_currency: true, quota_display_type: "USD" } },
            { success: true, data: [
                { model_name: "gpt-4.1", quota_type: 0, model_ratio: 1, completion_ratio: 2, cache_ratio: 0.5 },
                { model_name: "gpt-image-2", quota_type: 1, model_price: 0.04 },
            ] },
        );
        expect(estimateRelayQuota({ model: "gpt-4.1", promptTokens: 100, completionTokens: 40, cacheTokens: 20, units: 1 }, pricing)).toBe(170);
        expect(estimateRelayQuota({ model: "gpt-image-2", promptTokens: 0, completionTokens: 0, cacheTokens: 0, units: 2 }, pricing)).toBe(20000);
        const priced = applyEstimatedQuota([{
            id: "local:img",
            createdAt: "2026-10-19T00:00:00.000Z",
            model: "gpt-image-2",
            tokenName: "",
            type: 2,
            promptTokens: 0,
            completionTokens: 0,
            cacheTokens: 0,
            quota: 0,
            durationSec: 0,
            content: "",
            isStream: false,
            source: "local",
            units: 2,
        }], pricing);
        expect(priced[0]).toMatchObject({ quota: 20000, estimatedQuota: true });
        expect(formatRelayMoney(priced[0].quota, pricing)).toBe("$0.080000");
        expect(hasRealRelayMeter({ account: null, logs: priced })).toBe(true);
        expect(uniqueRelayErrors("自定义渠道不允许访问该上游接口", "自定义渠道不允许访问该上游接口", "")).toBe("自定义渠道不允许访问该上游接口");
    });

    test("uses the relay site unit and published model prices", () => {
        const pricing = mergeRelaySitePricing(
            { data: { quota_per_unit: 250000, display_in_currency: true, quota_display_type: "USD" } },
            { success: true, data: [{ model_name: "gpt-4.1", quota_type: 0, model_ratio: 1, completion_ratio: 2 }] },
        );
        expect(pricing).toMatchObject({ quotaPerUnit: 250000, displayInCurrency: true, currency: "USD" });
        expect(formatRelayMoney(250000, pricing)).toBe("$1.0000");
        expect(formatRelayMoney(250000, null)).toBe("—");
        expect(formatRelayMoney(0, pricing)).toBe("$0");
        expect(formatRelayMoney(0, null)).toBe("$0");
        const relayZero = {
            id: "88",
            createdAt: "2026-10-20T07:20:28.000Z",
            model: "free-agnes-2.5-flash",
            tokenName: "default",
            type: 2,
            promptTokens: 285,
            completionTokens: 56,
            cacheTokens: 256,
            quota: 0,
            durationSec: 2,
            content: "",
            isStream: true,
            source: "relay" as const,
        };
        expect(applyEstimatedQuota([relayZero], pricing)[0].quota).toBe(0);
        expect(formatRelayLogCost(relayZero, pricing)).toBe("$0");
        expect(formatRelayLogCache(relayZero)).toBe("256");
        expect(formatRelayModelPrice(pricing!.models[0], pricing)).toContain("$4.0000/1M");
        expect(formatRelayModelPrice(pricing!.models[0], pricing)).toContain("$8.0000/1M");
        expect(relayHttpError({ code: true, message: "ok", data: { total_used: 1 } })).toBe("");
        expect(relayHttpError({ success: false, message: "未登录" }, 401)).toBe("未登录");
        expect(relayHttpError({ msg: "自定义渠道不允许访问该上游接口" }, 403)).toBe("自定义渠道不允许访问该上游接口");
        expect(isRelayRateLimit("HTTP 429")).toBe(true);
        expect(isRelayRateLimit("请求过于频繁")).toBe(true);
        expect(isRelayRateLimit("未登录")).toBe(false);
    });
});
