import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { appChangelogZh } from "../src/components/layout/app-changelog.zh";

const root = resolve(import.meta.dir, "..");

function read(path: string) {
    return readFileSync(resolve(root, path), "utf8");
}

describe("desktop update UI contract", () => {
    test("installed release has published notes in both the release and in-app changelogs", () => {
        const version = read("../VERSION").trim();
        expect(read("../CHANGELOG.md")).toContain(`## ${version}\n`);
        expect(appChangelogZh.find((entry) => entry.version === version)?.changes.length).toBeGreaterThan(0);
        expect(new Set(appChangelogZh.map((entry) => entry.version)).size).toBe(appChangelogZh.length);
    });
    test("版本号区域提示更新并可立即更新", () => {
        const sidebar = read("src/components/layout/workspace-sidebar-nav.tsx");
        const entry = read("src/components/layout/app-update-entry.tsx");
        const changelog = read("src/components/layout/app-changelog-modal.tsx");
        const shell = read("src/components/layout/app-top-nav.tsx");

        expect(sidebar).toContain("AppUpdateEntry");
        expect(sidebar).toContain("app-workspace-sidebar-footer");
        expect(changelog).toContain("查看更新日志");
        // 启动即检查更新，不再依赖侧栏按钮触发。
        expect(shell).toContain("useDesktopUpdateBootstrap");
        expect(entry).toContain("AppModal");
        expect(entry).toContain("立即更新");
        expect(entry).toContain("releaseNotes");
        expect(entry).toContain("downloadAndInstall");
        expect(entry).toContain("isNewerDesktopVersion");
        expect(entry).toContain("已是最新版本");
        expect(entry).not.toContain("Modal.confirm");
        expect(entry).not.toContain("github.com");
        expect(entry).not.toContain("desktop-update.json");
        expect(entry).not.toContain("Wails");
        expect(entry).not.toContain("BeefAPI");
    });


    test("frontend update client never fetches a release origin", () => {
        const service = read("src/services/desktop-update.ts");
        const hook = read("src/hooks/use-desktop-update.ts");
        const runtime = read("src/services/desktop-runtime.ts");
        for (const source of [service, hook, runtime]) {
            expect(source).not.toContain("github.com");
            expect(source).not.toContain("desktop-update.json");
        }
        expect(service).not.toContain("fetch(");
        expect(hook).not.toContain("fetch(");
        expect(service).toContain("CheckForUpdate");
        expect(service).toContain("DownloadUpdate");
        expect(service).toContain("InstallUpdate");
        expect(hook).toContain("DESKTOP_UPDATE_CHECK_INTERVAL_MS");
        expect(hook).toContain("controller.check()");
        expect(service).toContain("flushCanvasStorePersistence");
        expect(runtime).toContain("UpdateStatus");
        expect(runtime).toContain("currentVersion");
        expect(runtime).toContain("downloadedBytes");
    });

    test("installed version stays visible even without an available update", () => {
        const entry = read("src/components/layout/app-update-entry.tsx");
        expect(entry).toContain("currentVersion");
        expect(entry).toContain("installed");
        expect(entry).toContain("已是最新版本");
        expect(entry).not.toContain("shouldShowDesktopUpdaterControls");
    });
});
