import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const exportScript = join(repoRoot, "scripts/public-release-export.sh");
const auditScript = join(repoRoot, "scripts/public-release-audit.sh");

// 这些发布脚本是 POSIX shell + rsync，Windows 开发机没有可执行环境。
// 这里改为校验脚本契约本身：导出必须排除私密状态，审计必须拒绝禁用产物。
describe("public release boundary", () => {
    test("export script excludes private state and generated artifacts", () => {
        const script = readFileSync(exportScript, "utf8");
        expect(script).toContain("source is missing required file");
        for (const requiredFile of ["README.md", "LICENSE", "NOTICE", "backend/go.mod", "web/package.json"]) {
            expect(script).toContain(requiredFile);
        }
        for (const excluded of [
            "--exclude='.git/'",
            "--exclude='.worktrees/'",
            "--exclude='.playwright-mcp/'",
            "--exclude='artifacts/'",
            "--exclude='test-evidence/'",
            "--exclude='data/'",
            "--exclude='backend/data/'",
            "--exclude='backend/server'",
            "--exclude='backend/cmd/desktop/build/'",
            "--exclude='backend/desktop'",
            "--exclude='web/.playwright/'",
            "--exclude='web/node_modules/'",
            "--exclude='*.db'",
            "--exclude='*.sqlite3'",
            "--exclude='*.log'",
            "--exclude='*.app'",
            "--exclude='*.dmg'",
            "--exclude='plugin-packages/*.siflux-plugin'",
        ]) {
            expect(script).toContain(excluded);
        }
        // 生成的 frontend/dist 只保留 git 跟踪的占位文件，其余构建产物必须排除。
        expect(script).toContain("--include='backend/cmd/desktop/frontend/dist/.gitkeep'");
        expect(script).toContain("--exclude='backend/cmd/desktop/frontend/dist/***'");
        // 本地网络审计脚本是公开验证入口，不能被通用 audit 排除规则吞掉。
        expect(script).toContain("--include='web/scripts/siflux-local-network-audit.mjs'");
        expect(script).toContain("--exclude='web/scripts/*audit*'");
    });

    test("audit rejects forbidden artifacts, secrets, and developer paths", () => {
        const script = readFileSync(auditScript, "utf8");
        expect(script).toContain("missing required public-release file");
        expect(script).toContain("forbidden public-release path");
        for (const forbidden of ["*/.worktrees/*", "*/.playwright-mcp/*", "*/artifacts/*", "*/test-evidence/*", "*/data/*", "*/backend/data/*", "*/backend/cmd/desktop/build/*", "backend/server", "backend/desktop", "plugin-packages/*.siflux-plugin"]) {
            expect(script).toContain(forbidden);
        }
        for (const suffix of ["*.db", "*.sqlite", "*.sqlite3", "*.log", "*.app", "*.dmg", "*.p12", "*.mobileprovision", "*.pem", "*.key"]) {
            expect(script).toContain(suffix);
        }
        expect(script).toContain("possible secret");
        expect(script).toContain("absolute developer path");
        expect(script).toContain('if [ "$failed" -ne 0 ]');
    });

    test("export refuses to merge into an existing destination", () => {
        const script = readFileSync(exportScript, "utf8");
        expect(script).toContain('if [ -e "$destination_directory" ]');
        expect(script).toContain("destination already exists: $destination_directory");
        expect(script).toContain("exit 73");
        const guard = script.indexOf('if [ -e "$destination_directory" ]');
        expect(guard).toBeLessThan(script.indexOf('mkdir -p "$destination_directory"'));
    });
});