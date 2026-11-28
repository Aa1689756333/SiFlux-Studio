import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

describe("BeefTV canvas top bar", () => {
    test("maps an empty canvas title to the default canvas label", () => {
        const source = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/project.tsx"), "utf8");
        expect(source).toContain('? "未命名画布" : workspaceProject.title');
        expect(source).toContain("title === " + '"未命名项目"');
    });
});
