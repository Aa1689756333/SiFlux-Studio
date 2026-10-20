export const RELAY_LOG_PAGE_SIZE = 100;
export const RELAY_LOG_MAX_PAGES = 20;
export const RELAY_LOG_TTL_MS = 10 * 60 * 1000;

export function isRelayRateLimit(error: string) {
    return /429|rate.?limit|too many requests|过于频繁|请求过多|quota exceeded/i.test(error);
}

export type RelayUsageLog = {
    id: string;
    createdAt: string;
    model: string;
    tokenName: string;
    type: number;
    promptTokens: number;
    completionTokens: number;
    cacheTokens: number;
    quota: number;
    durationSec: number;
    content: string;
    isStream: boolean;
    source: "relay" | "local";
    units?: number;
    estimatedQuota?: boolean;
};

export type RelayAccountUsage = {
    usedQuota: number;
    remainQuota: number;
    totalQuota: number;
    requestCount?: number;
    source: "token_usage" | "user_self" | "billing";
    unit: "quota" | "usd";
    unlimited?: boolean;
};

export type RelayLogSummary = {
    promptTokens: number;
    completionTokens: number;
    cacheTokens: number;
    quota: number;
    requests: number;
    consume: number;
    errors: number;
};

export type RelayModelPrice = {
    model: string;
    quotaType: 0 | 1;
    modelRatio: number;
    completionRatio: number;
    cacheRatio: number;
    modelPrice: number;
};

export type RelaySitePricing = {
    quotaPerUnit: number | null;
    displayInCurrency: boolean;
    currency: "USD" | "CNY" | "TOKENS";
    exchangeRate: number | null;
    models: RelayModelPrice[];
};

export type RelayUsageSnapshot = {
    account: RelayAccountUsage | null;
    pricing: RelaySitePricing | null;
    logs: RelayUsageLog[];
    promptTokens: number;
    completionTokens: number;
    cacheTokens: number;
    quota: number;
    requests: number;
    remoteTotal?: number;
    truncated?: boolean;
    error?: string;
};

export function relaySiteRoot(baseUrl: string) {
    const url = new URL(baseUrl.trim());
    url.hash = "";
    url.search = "";
    let path = url.pathname.replace(/\/+$/u, "");
    path = path.replace(/\/(?:api\/plan\/v3|api\/v3|v1beta|v1|v2|v3)$/iu, "");
    url.pathname = path || "/";
    return url.toString().replace(/\/+$/u, "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

export function parseNewApiUserSelf(payload: unknown): RelayAccountUsage | null {
    const root = asRecord(payload);
    if (!root) return null;
    const source = asRecord(root.data) ?? root;
    const remain = asNumber(source.quota);
    const used = asNumber(source.used_quota ?? source.usedQuota);
    if (remain == null && used == null) return null;
    const remainQuota = remain ?? 0;
    const usedQuota = used ?? 0;
    return {
        usedQuota,
        remainQuota,
        totalQuota: remainQuota + usedQuota,
        requestCount: asNumber(source.request_count ?? source.requestCount) ?? undefined,
        source: "user_self",
        unit: "quota",
    };
}

export function relayHttpError(payload: unknown, status?: number) {
    const root = asRecord(payload);
    const nested = asRecord(root?.error);
    const text = String(root?.message ?? root?.msg ?? (typeof root?.error === "string" ? root.error : nested?.message) ?? "").trim();
    if (status && (status < 200 || status >= 300)) return text || `HTTP ${status}`;
    if (root?.success === false) return text || "中转站拒绝";
    return "";
}

export function parseNewApiTokenUsage(payload: unknown): RelayAccountUsage | null {
    const root = asRecord(payload);
    if (!root) return null;
    const nested = asRecord(root.data);
    const source = asRecord(nested?.data) ?? nested ?? root;
    const used = asNumber(source.total_used ?? source.used_quota ?? source.usedQuota);
    const remain = asNumber(source.total_available ?? source.remaining ?? source.remain_quota ?? source.quota);
    const granted = asNumber(source.total_granted);
    const unlimited = source.unlimited_quota === true;
    if (!unlimited && used == null && remain == null && granted == null) return null;
    const usedQuota = used ?? 0;
    const remainQuota = remain ?? Math.max(0, (granted ?? 0) - usedQuota);
    return {
        usedQuota,
        remainQuota,
        totalQuota: granted ?? (usedQuota + remainQuota),
        source: "token_usage",
        unit: "quota",
        unlimited,
    };
}

export function parseOpenAIBilling(subscription: unknown, usage: unknown): RelayAccountUsage | null {
    const sub = asRecord(subscription);
    const usedPayload = asRecord(usage);
    const hard = asNumber(sub?.hard_limit_usd ?? sub?.hard_limit ?? sub?.system_hard_limit_usd);
    const totalUsage = asNumber(usedPayload?.total_usage ?? usedPayload?.totalUsage);
    if (hard == null && totalUsage == null) return null;
    const usedQuota = totalUsage ?? 0;
    const remainQuota = hard == null ? 0 : Math.max(0, hard - usedQuota);
    return {
        usedQuota,
        remainQuota,
        totalQuota: hard ?? usedQuota,
        source: "billing",
        unit: "usd",
    };
}

export function hasRealRelayMeter(snapshot: Pick<RelayUsageSnapshot, "account" | "logs"> | null | undefined) {
    if (!snapshot) return false;
    if (snapshot.account) return true;
    return snapshot.logs.length > 0;
}

function logCreatedAt(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) {
        const ms = value > 1e12 ? value : value * 1000;
        return new Date(ms).toISOString();
    }
    if (typeof value === "string" && value.trim()) {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
        const asUnix = Number(value);
        if (Number.isFinite(asUnix) && asUnix > 0) return logCreatedAt(asUnix);
    }
    return "";
}

function parseOtherCache(value: unknown) {
    const record = asRecord(value);
    if (record) {
        const nested = asRecord(record.admin_info);
        return Math.max(0, asNumber(
            record.cache_tokens
            ?? record.cached_tokens
            ?? record.cacheTokens
            ?? record.cache_read_input_tokens
            ?? record.prompt_cache_hit_tokens
            ?? nested?.cache_tokens
            ?? nested?.cached_tokens,
        ) ?? 0);
    }
    if (typeof value !== "string" || !value.trim()) return 0;
    try {
        return parseOtherCache(JSON.parse(value) as unknown);
    } catch {
        return 0;
    }
}

function logRecords(payload: unknown): unknown[] {
    const root = asRecord(payload);
    const data = root?.data;
    if (Array.isArray(data)) return data;
    const nested = asRecord(data);
    if (Array.isArray(nested?.items)) return nested.items as unknown[];
    if (Array.isArray(nested?.data)) return nested.data as unknown[];
    if (Array.isArray(root?.items)) return root.items as unknown[];
    return [];
}

export function parseNewApiLogs(payload: unknown): RelayUsageLog[] {
    const logs: RelayUsageLog[] = [];
    for (const item of logRecords(payload)) {
        const row = asRecord(item);
        if (!row) continue;
        const model = String(row.model_name ?? row.model ?? "").trim() || "未记录模型";
        const createdAt = logCreatedAt(row.created_at ?? row.createdAt ?? row.created_time) || new Date(0).toISOString();
        const promptTokens = Math.max(0, asNumber(row.prompt_tokens ?? row.promptTokens) ?? 0);
        const completionTokens = Math.max(0, asNumber(row.completion_tokens ?? row.completionTokens) ?? 0);
        const quota = Math.max(0, asNumber(row.quota ?? row.quota_used) ?? 0);
        const id = String(row.id ?? row.request_id ?? "").trim() || `${createdAt}|${model}|${promptTokens}|${completionTokens}|${quota}`;
        logs.push({
            id,
            createdAt,
            model,
            tokenName: String(row.token_name ?? row.tokenName ?? "").trim(),
            type: Math.max(0, Math.floor(asNumber(row.type) ?? 2)),
            promptTokens,
            completionTokens,
            cacheTokens: parseOtherCache(row.other) || Math.max(0, asNumber(row.cache_tokens ?? row.cached_tokens) ?? 0),
            quota,
            durationSec: Math.max(0, asNumber(row.use_time ?? row.useTime ?? row.duration) ?? 0),
            content: String(row.content ?? "").trim().slice(0, 160),
            isStream: row.is_stream === true || row.isStream === true,
            source: "relay",
            units: 1,
        });
    }
    return logs;
}

export function parseNewApiLogPage(payload: unknown) {
    const logs = parseNewApiLogs(payload);
    const root = asRecord(payload);
    const nested = asRecord(root?.data);
    const total = asNumber(root?.total) ?? asNumber(nested?.total) ?? logs.length;
    return { logs, total: Math.max(0, total) };
}

export function shouldFetchNextLogPage(pageIndex: number, pageLogs: number, pageSize: number, collected: number, total: number, maxPages = RELAY_LOG_MAX_PAGES) {
    if (pageIndex >= maxPages) return false;
    if (pageLogs < pageSize) return false;
    if (total > 0 && collected >= total) return false;
    return true;
}

export function relayLogKey(row: Pick<RelayUsageLog, "id" | "createdAt" | "model" | "promptTokens" | "completionTokens" | "quota">) {
    return row.id || `${row.createdAt}|${row.model}|${row.promptTokens}|${row.completionTokens}|${row.quota}`;
}

function usageMeter(row: Pick<RelayUsageLog, "quota" | "promptTokens" | "completionTokens" | "cacheTokens">) {
    return row.quota + row.promptTokens + row.completionTokens + row.cacheTokens;
}

export function usageModelKey(model: string) {
    return usageModelLabel(model).toLowerCase();
}

export function usageModelLabel(model: string) {
    const trimmed = model.trim();
    const sep = trimmed.lastIndexOf("::");
    return sep >= 0 ? trimmed.slice(sep + 2) : trimmed;
}

function sameGenerationCall(left: RelayUsageLog, right: RelayUsageLog) {
    if (usageModelKey(left.model) !== usageModelKey(right.model)) return false;
    const delta = Math.abs(Date.parse(left.createdAt) - Date.parse(right.createdAt));
    if (!Number.isFinite(delta) || delta > 12_000) return false;
    if (left.source !== right.source) return true;
    const leftMeter = usageMeter(left);
    const rightMeter = usageMeter(right);
    if (leftMeter === 0 || rightMeter === 0) return true;
    return left.promptTokens === right.promptTokens && left.completionTokens === right.completionTokens;
}

function preferUsageLog(left: RelayUsageLog, right: RelayUsageLog) {
    if (left.source !== right.source) {
        const relay = left.source === "relay" ? left : right;
        const local = left.source === "relay" ? right : left;
        return {
            ...relay,
            model: usageModelLabel(relay.model) || usageModelLabel(local.model),
            tokenName: relay.tokenName || local.tokenName,
            content: relay.content || local.content,
            durationSec: relay.durationSec || local.durationSec,
            quota: Math.max(relay.quota, local.quota),
            cacheTokens: Math.max(relay.cacheTokens, local.cacheTokens),
            promptTokens: relay.promptTokens || local.promptTokens,
            completionTokens: relay.completionTokens || local.completionTokens,
        };
    }
    const preferRight = usageMeter(right) > usageMeter(left);
    const winner = preferRight ? right : left;
    const other = preferRight ? left : right;
    return {
        ...winner,
        tokenName: winner.tokenName || other.tokenName,
        content: winner.content || other.content,
        durationSec: winner.durationSec || other.durationSec,
        quota: Math.max(winner.quota, other.quota),
        cacheTokens: Math.max(winner.cacheTokens, other.cacheTokens),
        promptTokens: Math.max(winner.promptTokens, other.promptTokens),
        completionTokens: Math.max(winner.completionTokens, other.completionTokens),
    };
}

export function mergeUsageLogs(primary: RelayUsageLog[], extra: RelayUsageLog[]) {
    const merged: RelayUsageLog[] = [];
    const consider = (row: RelayUsageLog) => {
        const key = relayLogKey(row);
        const sameKey = merged.findIndex((existing) => relayLogKey(existing) === key);
        if (sameKey >= 0) {
            merged[sameKey] = preferUsageLog(merged[sameKey], row);
            return;
        }
        const near = merged.findIndex((existing) => sameGenerationCall(existing, row));
        if (near >= 0) {
            merged[near] = preferUsageLog(merged[near], row);
            return;
        }
        merged.push(row);
    };
    for (const row of primary) consider(row);
    for (const row of extra) consider(row);
    return merged.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function summarizeRelayLogs(logs: RelayUsageLog[]): RelayLogSummary {
    return logs.reduce((sum, row) => {
        sum.promptTokens += row.promptTokens;
        sum.completionTokens += row.completionTokens;
        sum.cacheTokens += row.cacheTokens;
        sum.quota += row.quota;
        sum.requests += 1;
        if (row.type === 5) sum.errors += 1;
        else sum.consume += 1;
        return sum;
    }, { promptTokens: 0, completionTokens: 0, cacheTokens: 0, quota: 0, requests: 0, consume: 0, errors: 0 });
}

export function relaySuccessRate(summary: RelayLogSummary) {
    const total = summary.consume + summary.errors;
    if (!total) return null;
    return summary.consume / total;
}

export function formatUsageDay(day: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    if (!match) return day || "—";
    return `${Number(match[2])}月${Number(match[3])}日`;
}

export function formatRelayPercent(rate: number | null) {
    if (rate == null || !Number.isFinite(rate)) return "—";
    return `${(rate * 100).toFixed(1)}%`;
}

export type RelayOverviewInsights = {
    tokens: number;
    cacheHitRate: number | null;
    activeDays: number;
    longestStreak: number;
    peakDay: string;
    peakTokens: number;
    topModel: string;
    topModelTokens: number;
    dailyAvgTokens: number;
};

export function relayOverviewInsights(logs: RelayUsageLog[]): RelayOverviewInsights {
    const summary = summarizeRelayLogs(logs);
    const tokens = summary.promptTokens + summary.completionTokens;
    const cacheHitRate = summary.promptTokens > 0 ? Math.min(1, summary.cacheTokens / summary.promptTokens) : null;
    const byDay = new Map<string, number>();
    for (const log of logs) {
        const at = new Date(log.createdAt);
        if (Number.isNaN(at.getTime())) continue;
        const day = localDayKey(at);
        byDay.set(day, (byDay.get(day) || 0) + log.promptTokens + log.completionTokens);
    }
    let peakDay = "";
    let peakTokens = 0;
    for (const [day, value] of byDay) {
        if (value > peakTokens || (value === peakTokens && (!peakDay || day > peakDay))) {
            peakDay = day;
            peakTokens = value;
        }
    }
    const models = [...relayModelBreakdown(logs)].sort((a, b) => {
        const left = a.promptTokens + a.completionTokens;
        const right = b.promptTokens + b.completionTokens;
        return right - left || b.requests - a.requests || a.model.localeCompare(b.model, "zh-CN");
    });
    const top = models[0];
    const topModelTokens = top ? top.promptTokens + top.completionTokens : 0;
    return {
        tokens,
        cacheHitRate,
        activeDays: byDay.size,
        longestStreak: longestActiveStreak(byDay.keys()),
        peakDay,
        peakTokens,
        topModel: top ? usageModelLabel(top.model) : "",
        topModelTokens,
        dailyAvgTokens: byDay.size ? tokens / byDay.size : 0,
    };
}

function longestActiveStreak(days: Iterable<string>) {
    const sorted = [...days].filter(Boolean).sort();
    let best = 0;
    let run = 0;
    let previous = "";
    for (const day of sorted) {
        if (previous && nextLocalDay(previous) === day) run += 1;
        else run = 1;
        if (run > best) best = run;
        previous = day;
    }
    return best;
}

function nextLocalDay(day: string) {
    const at = new Date(`${day}T00:00:00`);
    if (Number.isNaN(at.getTime())) return "";
    at.setDate(at.getDate() + 1);
    return localDayKey(at);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDayKey(value: Date) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

export type RelayDayMeter = {
    day: string;
    quota: number;
    tokens: number;
    requests: number;
};

function localDayKey(value: Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function relayHeatmapWeeks(logs: RelayUsageLog[], now = Date.now()) {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - 52 * 7);
    start.setDate(start.getDate() - start.getDay());
    const byDay = new Map<string, RelayDayMeter>();
    for (const log of logs) {
        const at = new Date(log.createdAt);
        if (Number.isNaN(at.getTime())) continue;
        const key = localDayKey(at);
        const row = byDay.get(key) ?? { day: key, quota: 0, tokens: 0, requests: 0 };
        row.quota += log.quota;
        row.tokens += log.promptTokens + log.completionTokens + log.cacheTokens;
        row.requests += 1;
        byDay.set(key, row);
    }
    const weeks: RelayDayMeter[][] = [];
    const cursor = new Date(start);
    while (weeks.length < 54) {
        const week: RelayDayMeter[] = [];
        for (let weekday = 0; weekday < 7; weekday += 1) {
            const key = localDayKey(cursor);
            week.push(byDay.get(key) ?? { day: key, quota: 0, tokens: 0, requests: 0 });
            cursor.setDate(cursor.getDate() + 1);
        }
        weeks.push(week);
        if (cursor > today) break;
    }
    return weeks;
}

export function heatmapMonthLabels(weeks: RelayDayMeter[][]) {
    const labels: Array<{ week: number; label: string }> = [];
    let lastMonth = -1;
    weeks.forEach((week, index) => {
        const first = week.find((cell) => cell.day.endsWith("-01")) ?? (index === 0 ? week[0] : null);
        if (!first) return;
        const month = Number(first.day.slice(5, 7));
        if (!month || month === lastMonth) return;
        lastMonth = month;
        labels.push({ week: index, label: `${month}月` });
    });
    return labels;
}

export function heatmapLevel(value: number, max: number) {
    if (value <= 0 || max <= 0) return 0;
    const ratio = value / max;
    if (ratio <= 0.25) return 1;
    if (ratio <= 0.5) return 2;
    if (ratio <= 0.75) return 3;
    return 4;
}

export function relayDailyQuota(logs: RelayUsageLog[], days: number, now = Date.now()) {
    const end = new Date(now);
    const endUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
    const rows = Array.from({ length: days }, (_, offset) => ({
        day: utcDayKey(new Date(endUtc - (days - 1 - offset) * DAY_MS)),
        quota: 0,
        tokens: 0,
        requests: 0,
    }));
    const index = new Map(rows.map((row, i) => [row.day, i]));
    for (const log of logs) {
        const at = new Date(log.createdAt);
        if (Number.isNaN(at.getTime())) continue;
        const i = index.get(utcDayKey(at));
        if (i == null) continue;
        rows[i].quota += log.quota;
        rows[i].tokens += log.promptTokens + log.completionTokens + log.cacheTokens;
        rows[i].requests += 1;
    }
    return rows;
}

export function relayModelBreakdown(logs: RelayUsageLog[]) {
    const rows = new Map<string, { model: string; requests: number; promptTokens: number; completionTokens: number; quota: number }>();
    for (const log of logs) {
        const row = rows.get(log.model) ?? { model: log.model, requests: 0, promptTokens: 0, completionTokens: 0, quota: 0 };
        row.requests += 1;
        row.promptTokens += log.promptTokens;
        row.completionTokens += log.completionTokens;
        row.quota += log.quota;
        rows.set(log.model, row);
    }
    return [...rows.values()].sort((a, b) => b.quota - a.quota || b.requests - a.requests || a.model.localeCompare(b.model, "zh-CN"));
}

export function relayLogTypeLabel(type: number) {
    if (type === 1) return "充值";
    if (type === 2) return "消耗";
    if (type === 3) return "管理";
    if (type === 5) return "失败";
    return "其他";
}

export function formatRelayQuota(value: number) {
    if (!Number.isFinite(value)) return "—";
    return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

function formatSiteCurrency(amount: number, pricing?: RelaySitePricing | null) {
    if (!Number.isFinite(amount)) return "—";
    const digits = Math.abs(amount) >= 1 ? 4 : 6;
    if (pricing?.currency === "CNY" && pricing.exchangeRate && pricing.exchangeRate > 0) {
        return `¥${(amount * pricing.exchangeRate).toFixed(digits)}`;
    }
    if (pricing?.currency === "CNY") return `¥${amount.toFixed(digits)}`;
    return `$${amount.toFixed(digits)}`;
}

function formatZeroMoney(pricing?: RelaySitePricing | null) {
    if (pricing?.currency === "CNY") return "¥0";
    return "$0";
}

export function formatRelayMoney(quota: number, pricing?: RelaySitePricing | null, alreadyUsd = false) {
    if (!Number.isFinite(quota)) return "—";
    if (quota === 0) return formatZeroMoney(pricing);
    if (alreadyUsd) return formatSiteCurrency(quota, pricing);
    if (!pricing?.displayInCurrency || !pricing.quotaPerUnit || pricing.quotaPerUnit <= 0) {
        return "—";
    }
    return formatSiteCurrency(quota / pricing.quotaPerUnit, pricing);
}

export function formatRelayLogCost(row: Pick<RelayUsageLog, "quota" | "source" | "estimatedQuota">, pricing?: RelaySitePricing | null) {
    if (row.source !== "relay" && !row.estimatedQuota && !(row.quota > 0)) return "—";
    return formatRelayMoney(row.quota, pricing);
}

export function formatRelayLogCache(row: Pick<RelayUsageLog, "cacheTokens" | "source">) {
    if (row.source !== "relay" && !(row.cacheTokens > 0)) return "—";
    return formatRelayQuota(row.cacheTokens);
}

export function formatRelayModelPrice(model: RelayModelPrice, pricing?: RelaySitePricing | null) {
    if (model.quotaType === 1) return `每次 ${formatSiteCurrency(model.modelPrice, pricing)}`;
    if (!pricing?.quotaPerUnit || pricing.quotaPerUnit <= 0) {
        return `输入倍率 ${model.modelRatio}${model.completionRatio && model.completionRatio !== 1 ? ` · 输出 ${model.completionRatio}×` : ""}`;
    }
    const input = model.modelRatio * 1_000_000 / pricing.quotaPerUnit;
    const output = input * (model.completionRatio || 1);
    return `输入 ${formatSiteCurrency(input, pricing)}/1M · 输出 ${formatSiteCurrency(output, pricing)}/1M`;
}

export function lookupRelayModelPrice(model: string, pricing?: RelaySitePricing | null) {
    if (!model || !pricing?.models.length) return null;
    const key = usageModelKey(model);
    return pricing.models.find((row) => row.model === model)
        ?? pricing.models.find((row) => row.model.toLowerCase() === model.toLowerCase())
        ?? pricing.models.find((row) => usageModelKey(row.model) === key)
        ?? null;
}

export function parseNewApiStatus(payload: unknown): Pick<RelaySitePricing, "quotaPerUnit" | "displayInCurrency" | "currency" | "exchangeRate"> | null {
    const root = asRecord(payload);
    if (!root) return null;
    const source = asRecord(root.data) ?? root;
    const quotaPerUnit = asNumber(source.quota_per_unit ?? source.quotaPerUnit);
    const displayRaw = source.display_in_currency ?? source.displayInCurrency;
    const type = String(source.quota_display_type ?? source.quotaDisplayType ?? source.currency ?? "").trim().toUpperCase();
    const currency: RelaySitePricing["currency"] = type.includes("CNY") || type.includes("RMB") || type === "¥" ? "CNY" : type.includes("TOKEN") ? "TOKENS" : "USD";
    const exchangeRate = asNumber(source.usd_exchange_rate ?? source.usdExchangeRate ?? source.usd_exchange ?? source.exchange_rate);
    if (quotaPerUnit == null && displayRaw == null && !type) return null;
    const displayInCurrency = displayRaw === undefined || displayRaw === null
        ? quotaPerUnit != null && currency !== "TOKENS"
        : displayRaw === true || displayRaw === "true" || displayRaw === 1;
    return { quotaPerUnit, displayInCurrency, currency, exchangeRate };
}

function parsePricingItem(item: unknown): RelayModelPrice | null {
    const row = asRecord(item);
    if (!row) return null;
    const model = String(row.model_name ?? row.modelName ?? row.model ?? "").trim();
    if (!model) return null;
    const quotaType = asNumber(row.quota_type ?? row.quotaType) === 1 ? 1 : 0;
    return {
        model,
        quotaType,
        modelRatio: asNumber(row.model_ratio ?? row.modelRatio) ?? 0,
        completionRatio: asNumber(row.completion_ratio ?? row.completionRatio) ?? 1,
        cacheRatio: asNumber(row.cache_ratio ?? row.cacheRatio) ?? 0,
        modelPrice: asNumber(row.model_price ?? row.modelPrice) ?? 0,
    };
}

export function parseNewApiPricing(payload: unknown): RelayModelPrice[] {
    const root = asRecord(payload);
    const data = root ? (root.data ?? root) : payload;
    if (Array.isArray(data)) return data.map(parsePricingItem).filter((row): row is RelayModelPrice => Boolean(row));
    const table = asRecord(data);
    if (!table) return [];
    const models: RelayModelPrice[] = [];
    const ratios = asRecord(table.model_ratio ?? table.modelRatio);
    const prices = asRecord(table.model_price ?? table.modelPrice);
    const completions = asRecord(table.completion_ratio ?? table.completionRatio);
    const caches = asRecord(table.cache_ratio ?? table.cacheRatio);
    const names = new Set([...Object.keys(ratios ?? {}), ...Object.keys(prices ?? {})]);
    for (const model of names) {
        const modelPrice = asNumber(prices?.[model]) ?? 0;
        models.push({
            model,
            quotaType: modelPrice > 0 ? 1 : 0,
            modelRatio: asNumber(ratios?.[model]) ?? 0,
            completionRatio: asNumber(completions?.[model]) ?? 1,
            cacheRatio: asNumber(caches?.[model]) ?? 0,
            modelPrice,
        });
    }
    return models.sort((a, b) => a.model.localeCompare(b.model, "zh-CN"));
}

export function mergeRelaySitePricing(statusPayload: unknown, pricingPayload: unknown): RelaySitePricing | null {
    const status = parseNewApiStatus(statusPayload);
    const models = parseNewApiPricing(pricingPayload);
    if (!status && !models.length) return null;
    return {
        quotaPerUnit: status?.quotaPerUnit ?? null,
        displayInCurrency: status?.displayInCurrency ?? Boolean(status?.quotaPerUnit),
        currency: status?.currency ?? "USD",
        exchangeRate: status?.exchangeRate ?? null,
        models,
    };
}

export function shouldSkipUsageCapture(url: string) {
    try {
        const path = new URL(url, "https://local.invalid").pathname;
        return /\/api\/log(?:\/|$)|\/api\/user(?:\/|$)|\/api\/status(?:\/|$)|\/api\/pricing(?:\/|$)|dashboard\/billing/i.test(path);
    } catch {
        return /\/api\/log|\/api\/user|\/api\/status|\/api\/pricing|dashboard\/billing/i.test(url);
    }
}

function extractUsageNumbers(payload: unknown): { promptTokens: number; completionTokens: number; cacheTokens: number } | null {
    const root = asRecord(payload);
    if (!root) return null;
    const nestedData = asRecord(root.data);
    const usage = asRecord(root.usage)
        ?? asRecord(root.usageMetadata)
        ?? asRecord(nestedData?.usage)
        ?? asRecord(asRecord(root.response)?.usage)
        ?? asRecord(asRecord(root.result)?.usage);
    if (!usage) return null;
    const promptTokens = Math.max(0, asNumber(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokenCount) ?? 0);
    const completionTokens = Math.max(0, asNumber(usage.completion_tokens ?? usage.output_tokens ?? usage.candidatesTokenCount) ?? 0);
    const promptDetails = asRecord(usage.prompt_tokens_details);
    const inputDetails = asRecord(usage.input_tokens_details);
    const cacheTokens = Math.max(
        0,
        asNumber(
            usage.cache_read_input_tokens
            ?? usage.cached_tokens
            ?? usage.cachedContentTokenCount
            ?? usage.prompt_cache_hit_tokens
            ?? promptDetails?.cached_tokens
            ?? inputDetails?.cached_tokens
            ?? inputDetails?.cache_read_input_tokens
        ) ?? 0,
    );
    if (promptTokens <= 0 && completionTokens <= 0 && cacheTokens <= 0) return null;
    return { promptTokens, completionTokens, cacheTokens };
}

export function isGenerationUsageUrl(url: string) {
    try {
        const path = new URL(url, "https://local.invalid").pathname;
        return /\/(?:chat\/completions|responses|images\/generations|images\/edits|audio\/speech|messages|video\/generations|videos\/generations|videos)$/iu.test(path)
            || /:(?:generateContent|streamGenerateContent)$/u.test(path);
    } catch {
        return /chat\/completions|images\/generations|generateContent/iu.test(url);
    }
}

function extractUsageUnits(body: unknown, payload: unknown) {
    const fromBody = asNumber(asRecord(body)?.n);
    if (fromBody && fromBody > 0) return Math.min(16, Math.floor(fromBody));
    const data = asRecord(payload)?.data;
    if (Array.isArray(data) && data.length > 0) return Math.min(16, data.length);
    return 1;
}

function extractModel(body: unknown, payload: unknown, url: string) {
    const fromBody = asRecord(body)?.model;
    if (typeof fromBody === "string" && fromBody.trim()) return fromBody.trim();
    const fromPayload = asRecord(payload)?.model;
    if (typeof fromPayload === "string" && fromPayload.trim()) return fromPayload.trim();
    try {
        const match = new URL(url, "https://local.invalid").pathname.match(/\/models\/([^/:]+)/u);
        if (match?.[1]) return decodeURIComponent(match[1]);
    } catch {
        // Keep empty model.
    }
    return "";
}

export function estimateTextTokens(text: string) {
    const value = text.trim();
    if (!value) return 0;
    let cjk = 0;
    for (const char of value) {
        const code = char.codePointAt(0) ?? 0;
        if ((code >= 0x3400 && code <= 0x9fff) || (code >= 0x3040 && code <= 0x30ff) || (code >= 0xac00 && code <= 0xd7af)) cjk += 1;
    }
    const other = Math.max(0, [...value].length - cjk);
    return Math.max(1, Math.round(cjk / 1.5 + other / 4));
}

export function usageLogFromApiCallLog(log: {
    id: string;
    taskId?: string;
    model?: string;
    channelName?: string;
    status?: string;
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    durationMs?: number;
    createdAt: string;
    requestKind?: string;
}): RelayUsageLog | null {
    const kind = (log.requestKind || "create").trim().toLowerCase();
    if (kind && kind !== "create") return null;
    const createdAt = logCreatedAt(log.createdAt) || new Date().toISOString();
    const promptTokens = Math.max(0, Math.trunc(log.inputTokens || 0));
    const completionTokens = Math.max(0, Math.trunc(log.outputTokens || 0));
    const cacheTokens = Math.max(0, Math.trunc(log.cachedTokens || 0));
    return {
        id: log.taskId ? `task:${log.taskId}` : `api:${log.id}`,
        createdAt,
        model: log.model?.trim() || "未记录模型",
        tokenName: log.channelName?.trim() || "本机",
        type: 2,
        promptTokens,
        completionTokens,
        cacheTokens,
        quota: 0,
        durationSec: Math.max(0, Math.round(Math.max(0, log.durationMs || 0) / 1000)),
        content: "",
        isStream: false,
        source: "local",
        units: 1,
    };
}

export function usageLogFromGenerationTask(task: {
    id: string;
    status?: string;
    model?: string;
    prompt?: string;
    resultJson?: string;
    createdAt: string;
    completedAt?: string;
    startedAt?: string;
    type?: string;
    operation?: string;
}): RelayUsageLog | null {
    if (task.status !== "succeeded" && task.status !== "failed") return null;
    let payload: unknown = null;
    if (task.resultJson) {
        try {
            payload = JSON.parse(task.resultJson) as unknown;
        } catch {
            payload = null;
        }
    }
    const kind = `${task.type || ""} ${task.operation || ""}`.toLowerCase();
    const path = kind.includes("video") ? "/videos/generations" : kind.includes("audio") ? "/audio/speech" : kind.includes("image") ? "/images/generations" : "/chat/completions";
    const log = usageLogFromChannelResponse(`https://local.invalid/v1${path}`, { model: task.model || "" }, payload);
    if (!log) return null;
    const started = Date.parse(task.startedAt || task.createdAt);
    const ended = Date.parse(task.completedAt || task.createdAt);
    return {
        ...log,
        id: `task:${task.id}`,
        createdAt: task.completedAt || task.createdAt,
        model: task.model?.trim() || log.model,
        tokenName: log.tokenName || "本机",
        promptTokens: log.promptTokens,
        completionTokens: log.completionTokens,
        content: (task.prompt || "").trim().slice(0, 160),
        durationSec: Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, Math.round((ended - started) / 1000)) : log.durationSec,
        isStream: /text|chat/.test(kind),
    };
}

export function usageLogFromChannelResponse(url: string, body: unknown, payload: unknown): RelayUsageLog | null {
    if (shouldSkipUsageCapture(url)) return null;
    const usage = extractUsageNumbers(payload);
    if (!usage && !isGenerationUsageUrl(url)) return null;
    const model = extractModel(body, payload, url) || "未记录模型";
    const createdAt = new Date().toISOString();
    const promptTokens = usage?.promptTokens ?? 0;
    const completionTokens = usage?.completionTokens ?? 0;
    const cacheTokens = usage?.cacheTokens ?? 0;
    const units = extractUsageUnits(body, payload);
    const root = asRecord(payload);
    const nested = asRecord(root?.data);
    const requestId = String(root?.id ?? root?.request_id ?? nested?.id ?? nested?.request_id ?? "").trim();
    return {
        id: requestId ? `local:${requestId}` : `local:${createdAt}:${model}:${promptTokens}:${completionTokens}:${units}`,
        createdAt,
        model,
        tokenName: "本机",
        type: 2,
        promptTokens,
        completionTokens,
        cacheTokens,
        quota: 0,
        durationSec: 0,
        content: "",
        isStream: false,
        source: "local",
        units,
    };
}

export function uniqueRelayErrors(...parts: Array<string | undefined | false | null>) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of parts) {
        if (!part) continue;
        const text = String(part).trim();
        if (!text || seen.has(text)) continue;
        seen.add(text);
        out.push(text);
    }
    return out.join("；");
}

export function estimateRelayQuota(
    log: Pick<RelayUsageLog, "model" | "promptTokens" | "completionTokens" | "cacheTokens" | "units">,
    pricing?: RelaySitePricing | null,
) {
    const price = lookupRelayModelPrice(log.model, pricing);
    if (!price) return null;
    const units = Math.max(1, Math.floor(log.units || 1));
    if (price.quotaType === 1) {
        if (price.modelPrice <= 0 || !pricing?.quotaPerUnit || pricing.quotaPerUnit <= 0) return null;
        return price.modelPrice * pricing.quotaPerUnit * units;
    }
    if (price.modelRatio <= 0) return null;
    const cacheTokens = Math.max(0, log.cacheTokens);
    const promptTokens = Math.max(0, log.promptTokens - cacheTokens);
    const completionTokens = Math.max(0, log.completionTokens);
    if (promptTokens <= 0 && completionTokens <= 0 && cacheTokens <= 0) return null;
    return promptTokens * price.modelRatio
        + completionTokens * price.modelRatio * (price.completionRatio || 1)
        + cacheTokens * price.modelRatio * Math.max(0, price.cacheRatio);
}

export function withEstimatedQuota(log: RelayUsageLog, pricing?: RelaySitePricing | null): RelayUsageLog {
    if (log.source === "relay" || log.quota > 0) return log;
    const estimated = estimateRelayQuota(log, pricing);
    if (estimated == null || estimated <= 0) return log;
    return { ...log, quota: estimated, estimatedQuota: true };
}

export function applyEstimatedQuota(logs: RelayUsageLog[], pricing?: RelaySitePricing | null) {
    return logs.map((log) => withEstimatedQuota(log, pricing));
}
