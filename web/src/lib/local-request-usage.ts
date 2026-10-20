import { localForageStorageForScope } from "@/lib/localforage-storage";
import type { RelaySitePricing, RelayUsageLog } from "@/lib/relay-usage";
import { getActiveUserScope } from "@/lib/user-scope";

export const LOCAL_REQUEST_USAGE_KEY = "relay-request-usage-v1";
export const LOCAL_RELAY_PRICING_KEY = "relay-site-pricing-v1";
export const LOCAL_RELAY_LOGS_KEY = "relay-site-logs-v1";
const MAX_LOCAL_LOGS = 2000;
const MAX_RELAY_LOG_CACHE = 3000;

function asLog(value: unknown): RelayUsageLog | null {
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    const model = typeof row.model === "string" && row.model.trim() ? row.model.trim() : "未记录模型";
    const createdAt = typeof row.createdAt === "string" && row.createdAt.trim() ? row.createdAt : "";
    if (!createdAt) return null;
    const promptTokens = Math.max(0, Number(row.promptTokens) || 0);
    const completionTokens = Math.max(0, Number(row.completionTokens) || 0);
    const quota = Math.max(0, Number(row.quota) || 0);
    const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : `local:${createdAt}:${model}:${promptTokens}:${completionTokens}`;
    return {
        id,
        createdAt,
        model,
        tokenName: typeof row.tokenName === "string" ? row.tokenName : "",
        type: Math.max(0, Math.floor(Number(row.type) || 2)),
        promptTokens,
        completionTokens,
        cacheTokens: Math.max(0, Number(row.cacheTokens) || 0),
        quota,
        durationSec: Math.max(0, Number(row.durationSec) || 0),
        content: typeof row.content === "string" ? row.content.slice(0, 160) : "",
        isStream: row.isStream === true,
        source: row.source === "relay" ? "relay" : "local",
        units: Math.max(1, Math.floor(Number(row.units) || 1)),
        estimatedQuota: row.estimatedQuota === true,
    };
}

export function parseLocalRequestUsage(raw: unknown): RelayUsageLog[] {
    let data = raw;
    if (typeof raw === "string") {
        try {
            data = JSON.parse(raw) as unknown;
        } catch {
            return [];
        }
    }
    return Array.isArray(data) ? data.flatMap((item) => {
        const log = asLog(item);
        return log ? [log] : [];
    }) : [];
}

export async function loadLocalRequestUsage(scope = getActiveUserScope()) {
    const storage = localForageStorageForScope(scope);
    const raw = await storage.getItem(LOCAL_REQUEST_USAGE_KEY);
    if (!raw) return [];
    return parseLocalRequestUsage(raw);
}

export async function appendLocalRequestUsage(log: RelayUsageLog, scope = getActiveUserScope()) {
    try {
        const storage = localForageStorageForScope(scope);
        const current = await loadLocalRequestUsage(scope);
        const next = [log, ...current.filter((row) => row.id !== log.id)].slice(0, MAX_LOCAL_LOGS);
        await storage.setItem(LOCAL_REQUEST_USAGE_KEY, JSON.stringify(next));
    } catch {
        // Usage capture must never fail a generation request.
    }
}

function asPricing(value: unknown): RelaySitePricing | null {
    if (!value || typeof value !== "object") return null;
    const row = value as Partial<RelaySitePricing>;
    if (!Array.isArray(row.models)) return null;
    return {
        quotaPerUnit: typeof row.quotaPerUnit === "number" && row.quotaPerUnit > 0 ? row.quotaPerUnit : null,
        displayInCurrency: row.displayInCurrency === true,
        currency: row.currency === "CNY" || row.currency === "TOKENS" ? row.currency : "USD",
        exchangeRate: typeof row.exchangeRate === "number" && row.exchangeRate > 0 ? row.exchangeRate : null,
        models: row.models.filter((item): item is RelaySitePricing["models"][number] => Boolean(item && typeof item.model === "string" && item.model.trim())),
    };
}

export async function loadCachedRelayPricing(siteRoot: string, scope = getActiveUserScope()) {
    try {
        const storage = localForageStorageForScope(scope);
        const raw = await storage.getItem(LOCAL_RELAY_PRICING_KEY);
        const data = typeof raw === "string" ? JSON.parse(raw) as unknown : raw;
        const table = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null;
        const entry = table?.[siteRoot];
        const pricing = asPricing(entry);
        if (!pricing) return null;
        const fetchedAt = entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as { fetchedAt?: unknown }).fetchedAt : 0;
        return { pricing, fetchedAt: typeof fetchedAt === "number" && fetchedAt > 0 ? fetchedAt : 0 };
    } catch {
        return null;
    }
}

export async function loadCachedRelayLogs(siteRoot: string, scope = getActiveUserScope()) {
    try {
        const storage = localForageStorageForScope(scope);
        const raw = await storage.getItem(LOCAL_RELAY_LOGS_KEY);
        const data = typeof raw === "string" ? JSON.parse(raw) as unknown : raw;
        const table = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null;
        const entry = table?.[siteRoot];
        const record = entry && typeof entry === "object" && !Array.isArray(entry) ? entry as Record<string, unknown> : null;
        if (!record) return null;
        const logs = parseLocalRequestUsage(record.logs).map((row) => ({ ...row, source: row.source === "relay" ? "relay" as const : row.source }));
        const fetchedAt = typeof record.fetchedAt === "number" && record.fetchedAt > 0 ? record.fetchedAt : 0;
        const style = typeof record.style === "string" ? record.style : "";
        return { logs, fetchedAt, style };
    } catch {
        return null;
    }
}

export async function saveCachedRelayLogs(siteRoot: string, logs: RelayUsageLog[], style: string, scope = getActiveUserScope()) {
    try {
        const storage = localForageStorageForScope(scope);
        const raw = await storage.getItem(LOCAL_RELAY_LOGS_KEY);
        const data = typeof raw === "string" ? JSON.parse(raw) as unknown : raw;
        const table = data && typeof data === "object" && !Array.isArray(data) ? { ...data as Record<string, unknown> } : {};
        table[siteRoot] = { logs: logs.slice(0, MAX_RELAY_LOG_CACHE), style, fetchedAt: Date.now() };
        await storage.setItem(LOCAL_RELAY_LOGS_KEY, JSON.stringify(table));
    } catch {
        // Log cache must never fail a usage read.
    }
}

export async function saveCachedRelayPricing(siteRoot: string, pricing: RelaySitePricing, scope = getActiveUserScope()) {
    try {
        const storage = localForageStorageForScope(scope);
        const raw = await storage.getItem(LOCAL_RELAY_PRICING_KEY);
        const data = typeof raw === "string" ? JSON.parse(raw) as unknown : raw;
        const table = data && typeof data === "object" && !Array.isArray(data) ? { ...data as Record<string, unknown> } : {};
        table[siteRoot] = { ...pricing, fetchedAt: Date.now() };
        await storage.setItem(LOCAL_RELAY_PRICING_KEY, JSON.stringify(table));
    } catch {
        // Pricing cache must never fail a usage read.
    }
}
