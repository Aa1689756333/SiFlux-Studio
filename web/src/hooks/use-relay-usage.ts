import { useQuery } from "@tanstack/react-query";
import axios from "axios";

import { loadCachedRelayLogs, loadCachedRelayPricing, saveCachedRelayLogs, saveCachedRelayPricing } from "@/lib/local-request-usage";
import {
    isRelayRateLimit,
    mergeRelaySitePricing,
    parseNewApiLogPage,
    RELAY_LOG_MAX_PAGES,
    RELAY_LOG_PAGE_SIZE,
    RELAY_LOG_TTL_MS,
    relayHttpError,
    relaySiteRoot,
    mergeUsageLogs,
    shouldFetchNextLogPage,
    summarizeRelayLogs,
    type RelaySitePricing,
    type RelayUsageLog,
    type RelayUsageSnapshot,
} from "@/lib/relay-usage";
import { getActiveUserScope } from "@/lib/user-scope";
import { usageRangeStart } from "@/lib/usage-stats";
import { channelRequest } from "@/services/api/custom-channel-relay";
import { channelHasGenerationCredential, isBuiltinBeefAPIChannel, useConfigStore, type ModelChannel } from "@/stores/use-config-store";

export const relayUsageQueryKey = (scope = getActiveUserScope()) => ["relay-usage", scope] as const;
export const RELAY_PRICING_TTL_MS = 60 * 60 * 1000;

export function usageRelayChannel(channels: ModelChannel[]) {
    return channels.find((channel) => channel.enabled !== false && !isBuiltinBeefAPIChannel(channel) && channelHasGenerationCredential(channel) && channel.baseUrl.trim()) ?? null;
}

type RelayLogStyle = "token-p" | "token-page" | "self-p" | "self-page";
const rememberedLogStyle = new Map<string, RelayLogStyle>();

function rangeWindow(now = Date.now()) {
    const end = new Date(now);
    return { start: new Date(usageRangeStart("1y", now)), end };
}

function latestLogTime(logs: RelayUsageLog[]) {
    let latest = 0;
    for (const row of logs) {
        const at = Date.parse(row.createdAt);
        if (Number.isFinite(at) && at > latest) latest = at;
    }
    return latest;
}

async function readRelayJson(channel: ModelChannel, path: string): Promise<{ payload: unknown; error: string }> {
    try {
        const request = channelRequest({
            baseUrl: channel.baseUrl,
            apiKey: channel.apiKey,
            apiFormat: "openai",
            headers: channel.headers,
            credentialRef: channel.credentialRef,
        }, `${relaySiteRoot(channel.baseUrl)}${path}`, channel.apiKey ? { Authorization: `Bearer ${channel.apiKey}` } : {});
        const response = await axios.request({
            method: "get",
            url: request.url,
            headers: request.headers,
            withCredentials: request.credentials === "include",
            validateStatus: () => true,
        });
        return { payload: response.data, error: relayHttpError(response.data, response.status) };
    } catch (error) {
        return { payload: null, error: error instanceof Error ? error.message : "中转站用量读取失败" };
    }
}

function relayLogPath(page: number, start: Date, end: Date, style: RelayLogStyle) {
    const params = new URLSearchParams({
        page_size: String(RELAY_LOG_PAGE_SIZE),
        type: "2",
        end_timestamp: String(Math.ceil(end.getTime() / 1000)),
    });
    const startSec = Math.floor(start.getTime() / 1000);
    if (startSec > 0) params.set("start_timestamp", String(startSec));
    const endpoint = style.startsWith("token") ? "/api/log/token" : "/api/log/self";
    if (style.endsWith("-page")) {
        params.set("page", String(page));
        return `${endpoint}?${params}`;
    }
    params.set("p", String(page));
    return `${endpoint}?${params}`;
}

async function fetchRelayConsumptionLogs(channel: ModelChannel, start: Date, end: Date, siteRoot: string): Promise<{ logs: RelayUsageLog[]; style: string; rateLimited: boolean }> {
    const styles: RelayLogStyle[] = ["token-p", "token-page", "self-p", "self-page"];
    const preferred = rememberedLogStyle.get(siteRoot);
    const order = preferred ? [preferred, ...styles.filter((style) => style !== preferred)] : styles;
    let last: RelayUsageLog[] = [];
    let lastStyle = preferred || "";
    for (const style of order) {
        const first = await readRelayJson(channel, relayLogPath(1, start, end, style));
        if (isRelayRateLimit(first.error)) return { logs: last, style: lastStyle, rateLimited: true };
        if (first.error) continue;
        const firstPage = parseNewApiLogPage(first.payload);
        const collected = [...firstPage.logs];
        let total = firstPage.total;
        let page = 1;
        let pageLogs = firstPage.logs.length;
        while (shouldFetchNextLogPage(page, pageLogs, RELAY_LOG_PAGE_SIZE, collected.length, total, RELAY_LOG_MAX_PAGES)) {
            page += 1;
            const next = await readRelayJson(channel, relayLogPath(page, start, end, style));
            if (isRelayRateLimit(next.error)) {
                rememberedLogStyle.set(siteRoot, style);
                return { logs: collected, style, rateLimited: true };
            }
            if (next.error) break;
            const nextPage = parseNewApiLogPage(next.payload);
            collected.push(...nextPage.logs);
            total = nextPage.total || total;
            pageLogs = nextPage.logs.length;
        }
        rememberedLogStyle.set(siteRoot, style);
        if (collected.length || preferred === style) return { logs: collected, style, rateLimited: false };
        last = collected;
        lastStyle = style;
    }
    return { logs: last, style: lastStyle, rateLimited: false };
}

async function refreshRelayPricing(channel: ModelChannel, siteRoot: string): Promise<RelaySitePricing | null> {
    const status = await readRelayJson(channel, "/api/status");
    if (status.error) return null;
    const pricingPayload = await readRelayJson(channel, "/api/pricing");
    if (pricingPayload.error) return null;
    const livePricing = mergeRelaySitePricing(status.payload, pricingPayload.payload);
    if (livePricing?.models.length || livePricing?.quotaPerUnit) {
        await saveCachedRelayPricing(siteRoot, livePricing);
        return livePricing;
    }
    return null;
}

export async function fetchRelayUsage(channel: ModelChannel | null, now = Date.now()): Promise<RelayUsageSnapshot> {
    const { start, end } = rangeWindow(now);
    const empty: RelayUsageSnapshot = {
        account: null,
        pricing: null,
        logs: [],
        promptTokens: 0,
        completionTokens: 0,
        cacheTokens: 0,
        quota: 0,
        requests: 0,
    };
    const siteRoot = channel?.baseUrl ? relaySiteRoot(channel.baseUrl) : "";
    const [cached, cachedLogs] = await Promise.all([
        siteRoot ? loadCachedRelayPricing(siteRoot) : Promise.resolve(null),
        siteRoot ? loadCachedRelayLogs(siteRoot) : Promise.resolve(null),
    ]);
    if (cachedLogs?.style) rememberedLogStyle.set(siteRoot, cachedLogs.style as RelayLogStyle);
    const cacheFresh = Boolean(cached && now - cached.fetchedAt < RELAY_PRICING_TTL_MS);
    const logsFresh = Boolean(cachedLogs && now - cachedLogs.fetchedAt < RELAY_LOG_TTL_MS);
    const pricing = channel
        ? (cacheFresh ? cached!.pricing : (await refreshRelayPricing(channel, siteRoot)) ?? cached?.pricing ?? null)
        : cached?.pricing ?? null;
    let relayLogs = (cachedLogs?.logs ?? []).filter((row) => row.source === "relay");
    if (channel && !logsFresh) {
        const latest = latestLogTime(relayLogs);
        const fetchStart = new Date(Math.max(start.getTime(), latest > 0 ? latest - 120_000 : 0));
        const fetched = await fetchRelayConsumptionLogs(channel, fetchStart, end, siteRoot);
        if (fetched.logs.length) {
            relayLogs = mergeUsageLogs(relayLogs, fetched.logs).filter((row) => row.source === "relay");
            if (fetched.style) await saveCachedRelayLogs(siteRoot, relayLogs, fetched.style);
        } else if (!fetched.rateLimited && fetched.style && !relayLogs.length) {
            await saveCachedRelayLogs(siteRoot, [], fetched.style);
        }
    }
    const tokens = summarizeRelayLogs(relayLogs);
    return {
        ...empty,
        pricing,
        logs: relayLogs,
        promptTokens: tokens.promptTokens,
        completionTokens: tokens.completionTokens,
        cacheTokens: tokens.cacheTokens,
        quota: tokens.quota,
        requests: tokens.requests,
    };
}

export function useRelayUsage() {
    const channel = useConfigStore((state) => usageRelayChannel(state.config.channels));
    return useQuery({
        queryKey: [...relayUsageQueryKey(), channel?.id, channel?.baseUrl],
        queryFn: () => fetchRelayUsage(channel),
        staleTime: RELAY_LOG_TTL_MS,
        refetchInterval: false,
        refetchOnWindowFocus: false,
    });
}
