import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");

describe("standalone usage page", () => {
    test("sidebar and router open /usage", () => {
        const sidebar = read("src/components/layout/workspace-sidebar-nav.tsx");
        const router = read("src/router.tsx");
        expect(sidebar).toContain('title: "用量统计"');
        expect(sidebar).toContain('to: "/usage"');
        expect(router).toContain('path: "/usage"');
        expect(router).toContain("loadUsagePage");
    });

    test("home shows usage overview above recents", () => {
        const dashboard = read("src/pages/home/home-dashboard.tsx");
        expect(dashboard.indexOf("用量概览")).toBeLessThan(dashboard.indexOf("最近项目"));
        expect(dashboard).toContain('to="/usage"');
        expect(dashboard).not.toContain("新建画布创作");
    });

    test("usage page reads standalone and canvas generation history", () => {
        const page = read("src/pages/usage/index.tsx");
        const hook = read("src/hooks/use-generation-usage.ts");
        expect(page).toContain("用量统计");
        expect(page).toContain("useGenerationUsage");
        expect(page).not.toContain("不包含画布内生成");
        expect(hook).toContain("loadImageGenerationHistory");
        expect(hook).toContain("localTaskHistoryFromProjects");
        expect(hook).toContain("listGenerationTasks");
        expect(page).not.toContain("createCanvas");
        expect(page).toContain('id: "today"');
        expect(page).toContain('useState<UsageRange>("today")');
        expect(page).toContain("调用记录");
        expect(page).toContain("每日活动");
        expect(page).toContain("成本");
        expect(page).toContain("tokenName");
        expect(read("src/hooks/use-relay-usage.ts")).toContain("fetchRelayUsage");
        expect(read("src/hooks/use-relay-usage.ts")).toContain("loadCachedRelayLogs");
        expect(read("src/hooks/use-relay-usage.ts")).toContain("saveCachedRelayLogs");
        expect(read("src/hooks/use-relay-usage.ts")).not.toContain("listGenerationTasks");
        expect(read("src/hooks/use-relay-usage.ts")).not.toContain("appendLocalRequestUsage");
        expect(read("src/services/api/generation-task.ts")).not.toContain("appendLocalRequestUsage");
        expect(read("src/hooks/use-relay-usage.ts")).not.toContain("/api/usage/token");
        expect(read("src/pages/usage/index.tsx")).not.toContain("剩余费用");
        expect(read("src/hooks/use-relay-usage.ts")).toContain("/api/log/token");
        expect(read("src/hooks/use-relay-usage.ts")).toContain('apiFormat: "openai"');
        expect(read("src/hooks/use-relay-usage.ts")).toContain("/api/status");
        expect(read("src/hooks/use-relay-usage.ts")).toContain("/api/pricing");
        expect(read("src/hooks/use-relay-usage.ts")).toContain("/api/log/self");
        expect(read("src/hooks/use-relay-usage.ts")).toContain("fetchRelayConsumptionLogs");
        expect(read("src/hooks/use-relay-usage.ts")).toContain("RELAY_PRICING_TTL_MS");
        expect(read("src/hooks/use-relay-usage.ts")).toContain("RELAY_LOG_TTL_MS");
        expect(read("src/hooks/use-relay-usage.ts")).not.toContain("/api/user/self");
        expect(page).toContain("缓存命中率");
        expect(page).toContain("用量最高模型");
        expect(page).toContain("日均 Token");
        expect(page).not.toContain("中转站用量读取失败：");
        expect(page).not.toContain("额度");
        expect(page).not.toContain("约 $");
        expect(read("src/services/api/channel-transport.ts")).not.toContain("appendLocalRequestUsage");
    });
});
