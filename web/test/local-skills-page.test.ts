import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");

test("sidebar opens an independent local skill manager, not the marketplace or chat", () => {
    const sidebar = read("src/components/layout/workspace-sidebar-nav.tsx");
    const router = read("src/router.tsx");
    const page = read("src/pages/skills/local.tsx");
    const agent = read("src/pages/agent/agent-workspace.tsx");
    expect(sidebar).toContain('toolItem("skills", "/skills")');
    expect(sidebar).toContain('"/skills"');
    expect(router).toContain("loadSkillsPage");
    expect(router).toContain("LocalSkillsPage");
    expect(router).not.toContain('from "@/pages/skills"');
    expect(read("src/lib/workspace-route-modules.ts")).toContain('import("@/pages/skills/local")');
    expect(page).toContain("listAddedSkills");
    expect(page).toContain("SkillInstallModal");
    expect(page).toContain("供 Agent 选用");
    expect(page).toContain("不经过技能广场");
    expect(page).not.toContain('scope: "public"');
    expect(page).not.toContain('label: "技能广场"');
    expect(agent).toContain("listAddedSkills");
});
