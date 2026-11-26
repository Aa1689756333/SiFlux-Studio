import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, server: ReturnType<typeof Bun.serve>;
let scratch: string;
const resources = new Map<string, { bytes: Buffer; kind: string; mimeType: string }>();
const chats: Record<string, any>[] = [], supplements: Record<string, any>[] = [];
const undoRequests: Record<string, any>[] = [];
let rejectNextUndo = false;
let running = false, cancelled = false, nextId = 0, failNextAsset = false;
let activePermissionMode: string | undefined;
let holdNextAsset = false, releaseAsset: (() => void) | null = null;
let assetHeld: (() => void) | null = null;
const uploadKeys: string[] = [];
const uploadMetadata: { name: string; width: string | null; height: string | null; durationMs: string | null }[] = [];
const registeredAssets: Record<string, any>[] = [];
let assetScope = "guest";
const turns: Record<string, any>[] = [];
let png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAYAAAChS3wfAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAB0SURBVGhD5cgxAQAADMOg+TfdGYgDDh7ubrNlSjIlmZJMSaYkU5IpyZRkSjIlmZJMSaYkU5IpyZRkSjIlmZJMSaYkU5IpyZRkSjIlmZJMSaYkU5IpyZRkSjIlmZJMSaYkU5IpyZRkSjIlmZJMSaYkU5Kp2B7ImelaTkonqgAAAABJRU5ErkJggg==", "base64");
let jpeg = Buffer.from("/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAwAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDxyiiiv3E8wKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/9k=", "base64");
const mediaRequests: { path: string; token: string | null }[] = [];
let holdFirstPreview = true, releaseFirstPreview: (() => void) | null = null;
const selectedSkill = { skillId: "story", versionId: "story-v1", contentHash: "a".repeat(64), skillName: "分镜", version: "1.0", status: 1, isAdded: true };
let installedSkills = [selectedSkill];
const skillInstalls: { sourceType: string; isPrivate: string; fileName: string }[] = [];
let holdSkillInstall = false, releaseSkillInstall: (() => void) | null = null;
beforeAll(async () => {
    scratch = mkdtempSync(tmpdir() + "/assistant-input-");
    const build = await Bun.build({ entrypoints: [import.meta.dir + "/fixtures/assistant-input-harness.tsx"], target: "browser", define: {
        "import.meta.env.DEV": "false", "import.meta.env.PROD": "true", "import.meta.env.MODE": '"production"', "import.meta.env.VITE_CANVAS_LOCAL_MODE": '"true"',
        "import.meta.env.VITE_CANVAS_BACKEND_URL": '"/api"', "process.env.NODE_ENV": '"production"',
    }, plugins: [{ name: "test-source", setup(builder) {
        builder.onResolve({ filter: /^@\/components\/model-logo$/ }, () => ({ path: "model-logo", namespace: "test-icons" }));
        builder.onLoad({ filter: /.*/, namespace: "test-icons" }, () => ({ contents: "export function ModelLogo() { return null; }", loader: "js" }));
        builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) }));
    } }] });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const js = await build.outputs.find(output => output.path.endsWith(".js"))!.text(), css = await build.outputs.find(output => output.path.endsWith(".css"))?.text() || "";
    const ok = (data: unknown) => Response.json({ code: 0, data });
    server = Bun.serve({ port: 0, async fetch(req) {
        const pathname = new URL(req.url).pathname;
        if (pathname === "/harness.js") return new Response(js, { headers: { "content-type": "application/javascript" } });
        if (pathname === "/harness.css") return new Response(css, { headers: { "content-type": "text/css" } });
        if (pathname === "/api/resources" && req.method === "POST") {
            uploadKeys.push(req.headers.get("X-Idempotency-Key") || "");
            const form = await req.formData(), file = form.get("file") as File, kind = String(form.get("kind"));
            uploadMetadata.push({ name: file.name, width: form.get("width") as string | null, height: form.get("height") as string | null, durationMs: form.get("durationMs") as string | null });
            const id = "r" + (++nextId); resources.set(id, { bytes: Buffer.from(await file.arrayBuffer()), kind, mimeType: file.type });
            // The real local resource service can omit dimensions/duration in a ready receipt.
            return ok({ resource: { id, status: "ready", kind, mimeType: file.type, size: file.size } });
        }
        if (pathname.startsWith("/api/resources/") && pathname.endsWith("/file")) {
            mediaRequests.push({ path: new URL(req.url).pathname + new URL(req.url).search, token: req.headers.get("X-Desktop-Token") });
            if (req.headers.get("X-Desktop-Token") !== "synthetic-desktop-preview") return Response.json({ code: 403 }, { status: 403 });
            if (holdFirstPreview && pathname.includes("/r1/")) { holdFirstPreview = false; await new Promise<void>(resolve => { releaseFirstPreview = resolve; }); }
            const file = resources.get(pathname.split("/")[3]) || { bytes: png, mimeType: "image/png" };
            return new Response(file.bytes, { headers: { "content-type": file.mimeType } });
        }
        if (/^\/api\/resources\/[^/]+$/.test(pathname)) {
            const id = pathname.split("/")[3], file = resources.get(id);
            return ok({ resource: { id, status: "ready", provider: "local", kind: file?.kind || "image", playbackStatus: "none" } });
        }
        if (pathname.startsWith("/api/assets/") && req.method === "PUT") {
            if (failNextAsset) { failNextAsset = false; return Response.json({ code: 500, message: "素材登记失败" }, { status: 500 }); }
            const body = await req.json();
            if (holdNextAsset) { holdNextAsset = false; await new Promise<void>(resolve => { releaseAsset = resolve; assetHeld?.(); }); }
            registeredAssets.push(body.asset);
            return ok({ asset: { id: body.asset.id } });
        }
        if (pathname === "/test/asset-scope") { assetScope = (await req.json()).scope; return ok({}); }
        if (pathname === "/api/assets" && req.method === "GET") {
            const assets = assetScope === "guest" ? registeredAssets : [];
            return ok({ assets, page: 1, pageSize: 100, total: assets.length, hasMore: false });
        }
        if (pathname.endsWith("/skills/install")) {
            const form = await req.formData();
            skillInstalls.push({ sourceType: String(form.get("sourceType")), isPrivate: String(form.get("isPrivate")), fileName: (form.get("file") as File).name });
            if (holdSkillInstall) await new Promise<void>(resolve => { releaseSkillInstall = resolve; });
            const skill = { ...selectedSkill, skillId: "coffee", skillName: "咖啡审片", versionId: "coffee-v2", version: "2.0", contentHash: "b".repeat(64) };
            installedSkills = [skill];
            return ok({ skill });
        }
        if (pathname.endsWith("/skills/added")) return ok({ skills: installedSkills });
        if (pathname.endsWith("/assistant/ui-session")) return ok({ token: "synthetic-only", expiresAt: new Date(Date.now() + 1800000).toISOString() });
        if (pathname.endsWith("/assistant/status")) return ok({ available: true });
        if (pathname.endsWith("/assistant/sessions")) return ok({ currentSessionId: "s1", sessions: [] });
        if (pathname.endsWith("/assistant/history")) return ok({ sessionId: "s1", turns, active: running && !cancelled ? { turnId: "busy", userText: "继续创作", permissionMode: activePermissionMode, selectedNodeIds: [], attachments: [], skills: [], supplements: [], status: "running", createdAt: "2026-10-08" } : null });
        if (pathname.endsWith("/assistant/steer")) { supplements.push(await req.json()); return ok({ accepted: true }); }
        if (pathname.endsWith("/assistant/cancel")) { cancelled = true; running = false; return ok({ accepted: true }); }
        if (pathname.includes("/assistant/turns/") && pathname.endsWith("/undo")) {
            undoRequests.push(await req.json());
            if (rejectNextUndo) { rejectNextUndo = false; return Response.json({ code: 409, reason: "canvas_changed_since_turn" }, { status: 409 }); }
            return ok({ revision: 3 });
        }
        if (pathname.endsWith("/assistant/chat")) {
            const body = await req.json(); chats.push(body);
            const mainChange = { revisionBefore: 1, revisionAfter: 2, createdNodeIds: ["main-new"], updatedNodeIds: [], deletedNodeIds: ["gone"], createdEdgeIds: [], deletedEdgeIds: ["old-edge"] };
            const change = body.message === "改两个画布" ? { ...mainChange, canvasChanges: [
                { ...mainChange, canvasId: "input-canvas", operationIds: ["op1"] },
                { revisionBefore: 4, revisionAfter: 5, createdNodeIds: ["other-new"], updatedNodeIds: [], createdEdgeIds: [], timelineUpdated: true, canvasId: "other-canvas", operationIds: ["op2"] },
            ] } : null;
            const turn = { turnId: "t" + chats.length, userText: body.message, permissionMode: body.permissionMode, selectedNodeIds: [], reply: "已读取提供的参考素材。", attachments: body.attachments, skills: body.skills,
                toolCalls: [], proposals: [], change, error: null, cancelled: false, createdAt: "2026-10-08" };
            turns.push(turn);
            return new Response(JSON.stringify({ type: "turn_end", ...turn }) + "\n", { headers: { "content-type": "application/x-ndjson" } });
        }
        if (pathname.startsWith("/api/")) return ok({});
        return new Response('<html><meta name="viewport" content="width=device-width"><style>:root{--background:#fff;--foreground:#222;--muted:#f4f4f4;--muted-foreground:#666;--border:#ddd;--card:#fff;--fs-body:14px}*{box-sizing:border-box}body{margin:0}</style><link rel="stylesheet" href="/harness.css"><div id="root"></div><script type="module" src="/harness.js"></script></html>', { headers: { "content-type": "text/html" } });
    } });
    await ensureBrowser();
}, 60000);
afterAll(async () => { await browser?.close(); server?.stop(true); if (scratch) rmSync(scratch, { recursive: true, force: true }); });
/** 浏览器在单条用例里崩溃后，后续用例仍应能各跑一遍，而不是整体连锁失败。 */
async function ensureBrowser() {
    if (browser?.isConnected()) return;
    const executablePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((item): item is string => Boolean(item && existsSync(item)));
    browser = await chromium.launch({ executablePath, headless: true });
}
beforeEach(async () => { registeredAssets.length = 0; assetScope = "guest"; await ensureBrowser(); });
const openPages: Page[] = [];
async function newPage(options?: Parameters<Browser["newPage"]>[0]) { const page = await browser.newPage(options); openPages.push(page); return page; }
afterEach(async () => { for (const page of openPages.splice(0)) await page.close().catch(() => undefined); });

test("real Sidebar handles file, paste, drop, attachment-only, purpose, draft restore and busy supplement", async () => {
    const page = await newPage({ viewport: { width: 390, height: 900 } }); await page.goto(server.url.toString().replace("localhost", "127.0.0.1"));
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('button[aria-label="添加参考素材"]')?.disabled);
    await page.locator('input[type="file"]').setInputFiles({ name: "portrait.jpg", mimeType: "image/jpeg", buffer: jpeg });
    await page.getByRole("combobox", { name: "portrait.jpg 的用途" }).waitFor();
    await page.getByText("正在读取预览…", { exact: true }).waitFor({ timeout: 3000 }).catch(async error => { throw new Error(error.message + " BODY " + await page.locator("body").innerText() + " MEDIA " + JSON.stringify(mediaRequests)); });
    expect(releaseFirstPreview).not.toBeNull(); releaseFirstPreview!();
    await page.waitForFunction(() => { const image = document.querySelector<HTMLImageElement>('img[alt="portrait.jpg"]'); return image?.src.startsWith("blob:") && image.complete && image.naturalWidth === 64; });
    expect(mediaRequests.some(item => item.token === "synthetic-desktop-preview" && item.path.includes("proxy=1"))).toBe(true);
    await page.getByRole("combobox", { name: "portrait.jpg 的用途" }).click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText("首帧", { exact: true }).waitFor();
    const imagePurposes = await (await page.waitForFunction(() => { const labels = [...document.querySelectorAll(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content")].map(item => item.textContent); return labels.length === 6 ? labels : null; })).jsonValue();
    expect(imagePurposes).toContain("首帧"); expect(imagePurposes).toContain("人物参考");
    expect(imagePurposes).not.toContain("声音参考"); expect(imagePurposes).not.toContain("节奏参考");
    await page.getByRole("combobox", { name: "portrait.jpg 的用途" }).press("Escape");
    await page.getByRole("button", { name: "选择技能", exact: true }).click(); await page.getByRole("button", { name: "分镜 · 1.0", exact: true }).click();
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.getByText("已读取提供的参考素材。", { exact: true }).waitFor();
    expect(chats[0]?.message).toBe(""); expect(chats[0]?.attachments[0]?.assetId).toBeDefined();
    expect(chats[0]?.references).toEqual([{ kind: "asset", id: chats[0]?.attachments[0]?.assetId }]);
    expect(chats[0]?.skills).toEqual([{ skillId: "story", versionId: "story-v1", contentHash: "a".repeat(64) }]);
    await page.evaluate(bytes => { const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(bytes)], "paste.png", { type: "image/png" })); document.querySelector('.canvas-assistant-composer')!.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer })); }, [...png]);
    await page.getByRole("combobox", { name: "paste.png 的用途" }).waitFor();
    await page.evaluate(bytes => { const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(bytes)], "drop.png", { type: "image/png" })); document.querySelector('.canvas-assistant-composer')!.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer })); }, [...png]);
    await page.getByRole("combobox", { name: "drop.png 的用途" }).waitFor();
    await page.waitForFunction(() => { const image = document.querySelector<HTMLImageElement>('img[alt="drop.png"]'); return image?.src.startsWith("blob:") && image.complete && image.naturalWidth === 64; });
    await page.getByRole("combobox", { name: "drop.png 的用途" }).click(); await page.locator('.ant-select-item-option-content').getByText("风格参考", { exact: true }).click();
    await page.waitForFunction(async () => (await (window as any).assistantInputFixture.draft())?.attachments.some((item: any) => item.name === "drop.png" && item.purpose === "style"));
    await page.reload(); await page.getByRole("combobox", { name: "drop.png 的用途" }).waitFor();
    expect(await page.locator('.canvas-assistant-attachment').filter({ hasText: "drop.png" }).locator('.ant-select').innerText()).toBe("风格参考");
    await page.getByRole("button", { name: "画布素材", exact: true }).click(); await page.getByRole("button", { name: "画布人像", exact: true }).click();
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.canvas-assistant-log .canvas-assistant-reply').length === 2);
    expect(chats[1]?.attachments.some((item: any) => item.name === "drop.png" && item.purpose === "style")).toBe(true);
    expect(chats[1]?.attachments.some((item: any) => item.nodeId === "n1" && item.resourceId === "existing")).toBe(true);
    running = true; await page.reload(); await page.getByRole("button", { name: "停止", exact: true }).waitFor();
    await page.locator('input[type="file"]').setInputFiles({ name: "beat.png", mimeType: "image/png", buffer: png });
    await page.getByRole("combobox", { name: "beat.png 的用途" }).waitFor();
    await page.waitForFunction(() => { const image = document.querySelector<HTMLImageElement>('img[alt="beat.png"]'); return image?.src.startsWith("blob:") && image.complete && image.naturalWidth === 64; });
    await page.getByRole("combobox", { name: "beat.png 的用途" }).click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText("首帧", { exact: true }).waitFor();
    const supplementPurposes = await (await page.waitForFunction(() => { const labels = [...document.querySelectorAll(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content")].map(item => item.textContent); return labels.length === 6 ? labels : null; })).jsonValue();
    expect(supplementPurposes).toEqual(["仅分析", "人物参考", "场景参考", "风格参考", "首帧", "尾帧"]);
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText("首帧", { exact: true }).click();
    await page.getByRole("button", { name: /^补\s*充$/ }).click({ timeout: 8000 }).catch(async error => { throw new Error(error.message + " UI " + await page.locator('body').innerText()); }); await page.getByText("助手已收到补充要求。", { exact: true }).waitFor({ timeout: 8000 });
    expect(supplements).toHaveLength(1); expect(supplements[0]?.message).toBe(""); expect(supplements[0]?.attachments[0]?.kind).toBe("image"); expect(supplements[0]?.attachments[0]?.purpose).toBe("first-frame");
    expect(chats).toHaveLength(2);
    running = false;
    turns.push({ turnId: "busy", userText: "继续创作", selectedNodeIds: [], reply: "补充的图片已加入本次创作。", attachments: [], skills: [], supplements: [], supplementInputs: supplements.map(item => ({ message: item.message, attachments: item.attachments, skills: item.skills })), toolCalls: [], proposals: [], change: null, error: null, cancelled: false, createdAt: "2026-10-08" });
    await page.getByText("补充的图片已加入本次创作。", { exact: true }).waitFor({ timeout: 8000 });
    expect(await page.getByRole("button", { name: "停止", exact: true }).count()).toBe(0);
    expect(chats).toHaveLength(2);
    expect(await page.evaluate(() => { const width = document.documentElement.clientWidth; return [...document.querySelectorAll<HTMLElement>("body *")].filter(node => node.getBoundingClientRect().right > width + 1).slice(0, 6).map(node => `${node.tagName.toLowerCase()}.${String(node.className)} right=${Math.round(node.getBoundingClientRect().right)} width=${width}`); })).toEqual([]);
    await page.screenshot({ path: "/tmp/beeftv-assistant-input-ui.png" }); await page.close();
}, 30000);

test("asset registration failure remains unsent and an explicit upload retry keeps its idempotency key", async () => {
    const page = await newPage({ viewport: { width: 390, height: 900 } });
    await page.goto(server.url.toString().replace("localhost", "127.0.0.1"));
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('button[aria-label="添加参考素材"]')?.disabled);
    const before = chats.length, firstKey = uploadKeys.length;
    failNextAsset = true;
    await page.locator('input[type="file"]').setInputFiles({ name: "retry.png", mimeType: "image/png", buffer: png });
    await page.getByRole("button", { name: "重试上传", exact: true }).waitFor();
    expect(await page.evaluate(() => (window as any).assistantInputFixture.assets())).toEqual([]);
    expect(await page.evaluate(() => (window as any).assistantInputFixture.libraryInvalidated())).toBe(false);
    expect(await page.getByRole("button", { name: "发送", exact: true }).isDisabled()).toBe(true);
    expect(chats).toHaveLength(before);
    await page.getByRole("button", { name: "重试上传", exact: true }).click();
    await page.getByRole("combobox", { name: "retry.png 的用途" }).waitFor();
    expect(uploadKeys[firstKey]).not.toBe(""); expect(uploadKeys[firstKey + 1]).toBe(uploadKeys[firstKey]);
    await page.waitForFunction(async () => (await (window as any).assistantInputFixture.draft())?.attachments.some((item: any) => item.name === "retry.png"));
    expect(await page.getByRole("button", { name: "发送", exact: true }).isDisabled()).toBe(false);
    await page.close();
}, 15000);

test("native-local Sidebar publishes accepted uploads for immediate @ reuse, while removal and scope changes preserve ownership", async () => {
    const page = await newPage({ viewport: { width: 390, height: 900 } });
    await page.goto(server.url.toString().replace("localhost", "127.0.0.1"));
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('button[aria-label="添加参考素材"]')?.disabled);
    expect(await page.evaluate(() => (window as any).assistantInputFixture.nativeLocal())).toBe(true);
    await page.locator('input[type="file"]').setInputFiles({ name: "reuse.jpg", mimeType: "image/jpeg", buffer: jpeg });
    await page.getByRole("combobox", { name: "reuse.jpg 的用途" }).waitFor();
    const registered = await page.evaluate(() => (window as any).assistantInputFixture.assets());
    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({ title: "reuse.jpg", kind: "image" });
    expect(registered[0].data).toMatchObject({ width: 64, height: 48 });
    expect(registeredAssets.find(asset => asset.id === registered[0].id)?.data).toEqual(registered[0].data);
    expect(uploadMetadata.find(upload => upload.name === "reuse.jpg")).toMatchObject({ width: "64", height: "48" });
    expect(await page.evaluate(() => (window as any).assistantInputFixture.libraryInvalidated())).toBe(true);
    await page.getByRole("button", { name: "移除 reuse.jpg", exact: true }).click();
    expect(await page.evaluate(() => (window as any).assistantInputFixture.assets())).toEqual(registered);
    await page.getByRole("textbox", { name: "给助手的消息" }).fill("@reuse");
    await page.locator('.canvas-resource-mention-item').getByText("reuse.jpg", { exact: true }).click();
    const before = chats.length;
    const sent = page.waitForResponse(response => response.url().endsWith("/assistant/chat"));
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await sent;
    await page.getByText("已读取提供的参考素材。", { exact: true }).last().waitFor();
    expect(chats).toHaveLength(before + 1);
    expect(chats[before]?.message).toContain(`@[asset:${registered[0].id}]`);
    expect(chats[before]?.references).toEqual([{ kind: "asset", id: registered[0].id }]);
    expect(chats[before]?.attachments).toBeUndefined();

    const held = new Promise<void>(resolve => { assetHeld = resolve; });
    holdNextAsset = true;
    await page.locator('input[type="file"]').setInputFiles({ name: "old-account.png", mimeType: "image/png", buffer: png });
    await held;
    await page.evaluate(() => (window as any).assistantInputFixture.switchScope());
    const completed = page.waitForResponse(response => response.request().method() === "PUT" && response.url().includes("/api/assets/"));
    releaseAsset!(); await completed;
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('button[aria-label="添加参考素材"]')?.disabled);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => (window as any).assistantInputFixture.assets())).toEqual([]);
    expect(await page.getByRole("combobox", { name: "old-account.png 的用途" }).count()).toBe(0);
    await page.close();
}, 15000);

test("permission choices persist by workspace; trusted active mode locks the turn and supplements cannot elevate it", async () => {
    running = false; cancelled = false;
    const page = await newPage({ viewport: { width: 390, height: 900 } });
    await page.goto(server.url.toString().replace("localhost", "127.0.0.1"));
    const selector = page.getByRole("combobox", { name: "助手权限" });
    await page.waitForFunction(() => !document.querySelector<HTMLInputElement>('input[aria-label="助手权限"]')?.disabled);
    const selectedText = () => selector.locator('xpath=ancestor::div[contains(@class,"ant-select")][1]').innerText();
    expect(await selectedText()).toBe("当前画布");
    await selector.click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText("完全访问", { exact: true }).click();
    await page.getByRole("textbox", { name: "给助手的消息" }).fill("查看全部项目");
    const sent = page.waitForResponse(response => response.url().endsWith("/assistant/chat"));
    await page.getByRole("button", { name: "发送", exact: true }).click(); await sent;
    expect(chats.at(-1)?.permissionMode).toBe("full-access");
    await page.reload();
    await page.waitForFunction(() => !document.querySelector<HTMLInputElement>('input[aria-label="助手权限"]')?.disabled);
    expect(await selectedText()).toBe("完全访问");
    activePermissionMode = "read-only"; running = true;
    await page.reload(); await page.getByRole("button", { name: "停止", exact: true }).waitFor();
    expect(await selector.isDisabled()).toBe(true);
    expect(await selectedText()).toBe("只读");
    await selector.locator('xpath=ancestor::div[contains(@class,"ant-select")][1]').hover();
    await page.getByRole("tooltip").getByText("本轮权限已固定，结束后可更改", { exact: true }).waitFor();
    await page.getByRole("textbox", { name: "给助手的消息" }).fill("继续分析");
    const supplemented = page.waitForResponse(response => response.url().endsWith("/assistant/steer"));
    await page.getByRole("button", { name: /^补\s*充$/ }).click(); await supplemented;
    expect(supplements.at(-1)?.permissionMode).toBeUndefined();
    activePermissionMode = undefined;
    await page.reload(); await page.getByRole("button", { name: "停止", exact: true }).waitFor();
    expect(await selectedText()).toBe("当前画布"); // Legacy active turns keep their original scope.
    expect(await selector.isDisabled()).toBe(true);
    running = false;
    await page.reload();
    await page.waitForFunction(() => !document.querySelector<HTMLInputElement>('input[aria-label="助手权限"]')?.disabled);
    expect(await selectedText()).toBe("完全访问");
    await page.evaluate(() => (window as any).assistantInputFixture.switchScope("other-workspace"));
    await page.waitForFunction(() => !document.querySelector<HTMLInputElement>('input[aria-label="助手权限"]')?.disabled);
    expect(await selectedText()).toBe("当前画布");
    await selector.click(); await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText("只读", { exact: true }).click();
    await page.getByRole("textbox", { name: "给助手的消息" }).fill("只分析");
    const readonlySent = page.waitForResponse(response => response.url().endsWith("/assistant/chat"));
    await page.getByRole("button", { name: "发送", exact: true }).click(); await readonlySent;
    expect(chats.at(-1)?.permissionMode).toBe("read-only");
    await page.evaluate(() => (window as any).assistantInputFixture.switchScope("guest"));
    await page.waitForFunction(() => !document.querySelector<HTMLInputElement>('input[aria-label="助手权限"]')?.disabled);
    expect(await selectedText()).toBe("完全访问");
    expect(await page.evaluate(() => { const width = document.documentElement.clientWidth; return [...document.querySelectorAll<HTMLElement>("body *")].filter(node => node.getBoundingClientRect().right > width + 1).slice(0, 6).map(node => `${node.tagName.toLowerCase()}.${String(node.className)} right=${Math.round(node.getBoundingClientRect().right)} width=${width}`); })).toEqual([]);
    await page.screenshot({ path: "/tmp/beeftv-assistant-permissions-390.png" });
    await page.close();
}, 20000);

test("cross-canvas receipts report every target and one atomic undo refreshes all canvases only after success", async () => {
    running = false;
    const page = await newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(server.url.toString().replace("localhost", "127.0.0.1"));
    await page.waitForFunction(() => !document.querySelector<HTMLInputElement>('input[aria-label="助手权限"]')?.disabled);
    await page.getByRole("combobox", { name: "助手权限" }).click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText("完全访问", { exact: true }).click();
    await page.getByRole("textbox", { name: "给助手的消息" }).fill("改两个画布");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.getByText("修改了 2 个画布，新建 2 个节点，删除 1 个节点，删除 1 条线，修改时间线", { exact: true }).waitFor();
    await page.getByText("撤销会恢复这 2 个画布本轮的全部改动。", { exact: true }).waitFor();
    expect(await page.evaluate(() => (window as any).assistantInputFixture.changedCanvases())).toEqual(["input-canvas", "other-canvas"]);
    await page.getByRole("button", { name: "在画布上查看", exact: true }).click();
    expect(await page.evaluate(() => (window as any).assistantInputFixture.locatedNodes())).toEqual([["main-new"]]);
    const before = undoRequests.length;
    rejectNextUndo = true;
    await page.getByRole("button", { name: "撤销这一轮", exact: true }).click();
    await page.getByText("其中一个画布后来又改过，这一轮未撤销。", { exact: true }).waitFor();
    expect(undoRequests).toHaveLength(before + 1);
    expect(await page.evaluate(() => (window as any).assistantInputFixture.changedCanvases())).toEqual(["input-canvas", "other-canvas"]);
    await page.getByRole("button", { name: "撤销这一轮", exact: true }).click();
    await page.getByText("已撤销这一轮全部画布改动", { exact: true }).waitFor();
    expect(undoRequests).toHaveLength(before + 2);
    expect(undoRequests.at(-1)).toEqual({ canvasId: "input-canvas" });
    expect(await page.evaluate(() => (window as any).assistantInputFixture.changedCanvases())).toEqual(["input-canvas", "other-canvas", "input-canvas", "other-canvas"]);
    await page.screenshot({ path: "/tmp/beeftv-assistant-cross-canvas-undo.png" });
    await page.close();
}, 15000);

for (const mode of ["markdown", "zip"] as const) {
    test(`assistant installs ${mode} privately and sends the installed version pin`, async () => {
        running = false; installedSkills = [];
        const page = await newPage();
        await page.goto(server.url.toString().replace("localhost", "127.0.0.1"));
        await page.getByRole("button", { name: "选择技能", exact: true }).click();
        await page.getByText("还没有已安装的技能。", { exact: true }).waitFor();
        await page.getByRole("button", { name: "安装技能", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "安装技能" });
        expect(await dialog.getByText("公开状态", { exact: true }).isVisible()).toBe(false);
        expect(await dialog.getByRole("button", { name: "从空白创建单文件技能" }).count()).toBe(0);
        if (mode === "zip") await dialog.getByText("ZIP 技能包", { exact: true }).click();
        await dialog.locator('input[type="file"]').setInputFiles({ name: mode === "zip" ? "coffee.zip" : "SKILL.md", mimeType: mode === "zip" ? "application/zip" : "text/markdown", buffer: Buffer.from("# Coffee review\nCheck the actual photo.") });
        await dialog.getByRole("button", { name: "安装技能", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
        await page.getByRole("button", { name: "移除技能 咖啡审片", exact: true }).waitFor();
        await page.getByRole("button", { name: "咖啡审片 · 2.0", exact: true }).waitFor();
        expect(skillInstalls.at(-1)).toEqual({ sourceType: mode, isPrivate: "true", fileName: mode === "zip" ? "coffee.zip" : "SKILL.md" });
        await page.getByRole("textbox", { name: "给助手的消息" }).fill("请审查咖啡短片");
        const sent = page.waitForResponse(response => response.url().endsWith("/assistant/chat"));
        await page.getByRole("button", { name: "发送", exact: true }).click(); await sent;
        expect(chats.at(-1)?.skills).toEqual([{ skillId: "coffee", versionId: "coffee-v2", contentHash: "b".repeat(64) }]);
        await page.close();
    }, 20000);
}

test("an installation completing after an account switch cannot select a skill in the replacement draft", async () => {
    running = false; installedSkills = []; holdSkillInstall = true;
    const page = await newPage();
    try {
        await page.goto(server.url.toString().replace("localhost", "127.0.0.1"));
        await page.getByRole("button", { name: "选择技能", exact: true }).click();
        await page.getByText("还没有已安装的技能。", { exact: true }).waitFor();
        await page.getByRole("button", { name: "安装技能", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "安装技能" });
        await dialog.locator('input[type="file"]').setInputFiles({ name: "SKILL.md", mimeType: "text/markdown", buffer: Buffer.from("# Coffee") });
        const held = page.waitForRequest(request => request.url().endsWith("/skills/install"));
        await dialog.getByRole("button", { name: "安装技能", exact: true }).click(); await held;
        await page.evaluate(() => (window as any).assistantInputFixture.switchScope("replacement"));
        await dialog.waitFor({ state: "hidden" });
        const completed = page.waitForResponse(response => response.url().endsWith("/skills/install"));
        releaseSkillInstall?.(); await completed;
        await page.getByRole("textbox", { name: "给助手的消息" }).fill("新账号的草稿");
        const sent = page.waitForResponse(response => response.url().endsWith("/assistant/chat"));
        await page.getByRole("button", { name: "发送", exact: true }).click(); await sent;
        expect(chats.at(-1)?.skills).toBeUndefined();
        expect(await page.getByRole("button", { name: "移除技能 咖啡审片" }).count()).toBe(0);
    } finally {
        holdSkillInstall = false; releaseSkillInstall?.(); releaseSkillInstall = null;
        await page.close();
    }
}, 20000);