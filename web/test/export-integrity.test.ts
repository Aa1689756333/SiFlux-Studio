import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { unzipSync } from "fflate";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { Asset } from "@/stores/use-asset-store";

const blobs = new Map<string, Blob>();
const unreadable = new Set<string>();
const restored = new Map<string, Blob>();
const getBlob = async (key: string) => {
    if (unreadable.has(key)) throw new Error("fixture disk read error");
    return blobs.get(key);
};
const setBlob = async (key: string, blob: Blob) => { restored.set(key, blob); };
mock.module("@/services/file-storage", () => ({ getMediaBlob: getBlob, setMediaBlob: setBlob }));
mock.module("@/services/image-storage", () => ({ getImageBlob: getBlob, setImageBlob: setBlob }));
mock.module("@/services/workspace-mode", () => ({ isLocalWorkspaceMode: () => true }));

const { exportCanvasProjects, openCanvasArchive } = await import("@/lib/canvas/canvas-export");
const { exportAssets, readAssetPackage } = await import("@/pages/assets/asset-transfer");
const { createZip, readZip } = await import("@/lib/zip");
const { archiveFileExtension, ExportIntegrityError } = await import("@/lib/export-integrity");
const { reportOwnedMediaSave } = await import("@/services/desktop-media-save");
const { http } = await import("@/services/api/request");
const originalWindow = globalThis.window;
const saved: { name: string; data: string }[] = [];
let acceptSave = true;

beforeEach(() => {
    blobs.clear();
    restored.clear();
    unreadable.clear();
    saved.length = 0;
    acceptSave = true;
    Object.assign(globalThis, {
        window: {
            location: { protocol: "wails:" },
            go: { main: { DesktopApp: { SaveOwnedArtifact: async (name: string, data: string) => {
                saved.push({ name, data });
                return acceptSave;
            } } } },
        },
    });
});
afterEach(() => { globalThis.window = originalWindow; });

function project(keys: string[]): CanvasProject {
    return {
        id: "canvas-fixture", title: "测试画布", nodes: keys.map((storageKey, index) => ({
            id: `node-${index}`, type: "image", title: `图片 ${index + 1}`,
            position: { x: 0, y: 0 }, width: 320, height: 180,
            metadata: { storageKey, status: "success" },
        })), connections: [],
    } as unknown as CanvasProject;
}

function mediaAsset(key?: string): Asset {
    return {
        id: "asset-fixture", kind: "image", title: "场景图", coverUrl: "", tags: [],
        createdAt: "2026-09-30", updatedAt: "2026-09-30",
        data: { dataUrl: "", storageKey: key, width: 320, height: 180, bytes: 4, mimeType: "image/png" },
    };
}

test("complete canvas archive contains every referenced media byte", async () => {
    blobs.set("image:one", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));
    blobs.set("file:extra", new Blob([new Uint8Array([4, 5])], { type: "application/octet-stream" }));
    expect(await exportCanvasProjects([project([...blobs.keys()])])).toBe("saved");
    expect(saved).toHaveLength(1);
    const archive = unzipSync(Buffer.from(saved[0].data, "base64"));
    const manifest = JSON.parse(new TextDecoder().decode(archive["projects.json"]));
    expect(manifest.projects[0].files).toHaveLength(2);
    for (const file of manifest.projects[0].files) {
        expect(archive[file.path]).toEqual(new Uint8Array(await blobs.get(file.storageKey)!.arrayBuffer()));
    }
});

test("folder cover export embeds canonical bytes and drops source resource identity", async () => {
    const canvas = { ...project([]), folderId: "folder" };
    const read = spyOn(http, "raw").mockResolvedValue({ data: new Blob(["cover bytes"], { type: "image/jpeg" }) } as never);
    try {
        await exportCanvasProjects([canvas], "备份", { folders: [{ id: "folder", name: "剧集", createdAt: "", updatedAt: "", coverResourceId: "old-cover", coverDataUrl: "http://old-host.invalid/stale" }] });
        const archive = await readZip(new Blob([Buffer.from(saved[0].data, "base64")]));
        const manifest = JSON.parse(await archive.get("projects.json")!.text());
        const folder = manifest.folders[0];
        expect(folder.coverResourceId).toBeUndefined();
        expect(folder.coverDataUrl).toBeUndefined();
        expect(folder.coverMimeType).toBe("image/jpeg");
        expect(await archive.get(folder.coverPath)!.text()).toBe("cover bytes");
        expect(read.mock.calls[0][0]).toMatchObject({ url: "/resources/old-cover/file?proxy=1", expectedScope: expect.any(Object) });
    } finally { read.mockRestore(); }
});

test("missing and empty blobs are all reported before saving an archive", async () => {
    blobs.set("image:empty", new Blob([]));
    const result = exportCanvasProjects([project(["image:missing", "image:empty", "image:missing"])]);
    const error = await result.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ExportIntegrityError);
    expect((error as InstanceType<typeof ExportIntegrityError>).missingFiles).toEqual([
        { owner: "测试画布", reference: "image:empty" },
        { owner: "测试画布", reference: "image:missing" },
    ]);
    const messages: string[] = [];
    let successes = 0;
    await reportOwnedMediaSave({ error: (text) => messages.push(text), success: () => { successes += 1; } }, result);
    expect(messages[0]).toContain("缺少 2 个文件");
    expect(messages[0]).toContain("image:missing");
    expect(messages[0]).toContain("image:empty");
    expect(successes).toBe(0);
    expect(saved).toHaveLength(0);
});

test("asset archive refuses missing files, including a missing media reference", async () => {
    await expect(exportAssets([mediaAsset("image:missing")])).rejects.toThrow("image:missing");
    await expect(exportAssets([mediaAsset()])).rejects.toThrow("场景图：媒体文件");
    expect(saved).toHaveLength(0);
});

test("complete asset archive retains bytes; save cancellation is not success", async () => {
    blobs.set("image:voice", new Blob([new Uint8Array([4, 5, 6, 7])], { type: "image/png" }));
    acceptSave = false;
    let successes = 0;
    const result = exportAssets([mediaAsset("image:voice")]);
    expect(await result).toBe("cancelled");
    await reportOwnedMediaSave({ error: () => { throw new Error("unexpected error"); }, success: () => { successes += 1; } }, result);
    expect(successes).toBe(0);
    const archive = unzipSync(Buffer.from(saved[0].data, "base64"));
    const manifest = JSON.parse(new TextDecoder().decode(archive["assets.json"]));
    expect(archive[manifest.files[0].path]).toEqual(new Uint8Array([4, 5, 6, 7]));
});

test("multiple canvases retain every media byte with collision-prone names and per-canvas deduplication", async () => {
    const keys = ["image:a/b", "image:a_b", "file:note"];
    for (const [index, key] of keys.entries()) blobs.set(key, new Blob([`media-${index}`], { type: "image/png" }));
    const first = project([keys[0], keys[0], keys[1]]);
    const second = { ...project([keys[1]]), id: "other-canvas", title: "同名画布" };
    first.title = "同名画布";
    await exportCanvasProjects([first, second]);
    const archive = await readZip(new Blob([Buffer.from(saved[0].data, "base64")]));
    const manifest = JSON.parse(await archive.get("projects.json")!.text());
    expect(manifest.projects.map((item: { files: unknown[] }) => item.files.length)).toEqual([2, 1]);
    const allPaths = manifest.projects.flatMap((item: { files: { path: string }[] }) => item.files.map((file) => file.path));
    expect(new Set(allPaths).size).toBe(3);
    for (const item of manifest.projects) for (const file of item.files) {
        expect(await archive.get(file.path)!.text()).toBe(await blobs.get(file.storageKey)!.text());
    }
    expect(manifest.projects[0].files.map((file: { storageKey: string }) => file.storageKey).sort()).toEqual([keys[0], keys[1]].sort());
});

test("a media read rejection is reported alongside other missing references and never saves", async () => {
    unreadable.add("image:disk-error");
    await expect(exportCanvasProjects([project(["image:disk-error", "image:missing"])]))
        .rejects.toThrow("image:disk-error（读取失败）");
    await expect(exportAssets([mediaAsset("image:disk-error")])).rejects.toThrow("读取失败");
    expect(saved).toHaveLength(0);
});

test("asset package imports into empty storage with every byte, and shared media is packaged once", async () => {
    const original = new Blob(["voice fixture"], { type: "image/png" });
    blobs.set("image:voice", original);
    const asset = mediaAsset("image:voice");
    await exportAssets([asset, { ...asset, id: "second-reference" }]);
    const file = new File([Buffer.from(saved[0].data, "base64")], "assets.zip");
    const archive = await readZip(file);
    const manifest = JSON.parse(await archive.get("assets.json")!.text());
    expect(manifest.files).toHaveLength(1);
    blobs.clear();
    const imported = await readAssetPackage(file);
    expect(imported).toHaveLength(2);
    expect(restored.size).toBe(1);
    expect(await restored.get("image:voice")!.text()).toBe(await original.text());
    expect(restored.get("image:voice")!.type).toBe("image/png");
});

test("empty workspace and empty asset list still produce honest empty archives", async () => {
    expect(await exportCanvasProjects([])).toBe("saved");
    expect(saved).toHaveLength(1);
    const workspace = unzipSync(Buffer.from(saved[0].data, "base64"));
    expect(JSON.parse(new TextDecoder().decode(workspace["projects.json"])).projects).toEqual([]);
    saved.length = 0;
    expect(await exportAssets([])).toBe("saved");
    expect(saved).toHaveLength(1);
    const assets = JSON.parse(new TextDecoder().decode(unzipSync(Buffer.from(saved[0].data, "base64"))["assets.json"]));
    expect(assets.assets).toEqual([]);
    expect(assets.files).toEqual([]);
});

test("generic JSON is not claimed as glTF; genuine glTF keeps its extension", () => {
    expect(archiveFileExtension("application/json", "bin")).toBe("bin");
    expect(archiveFileExtension("application/json; charset=utf-8", "bin")).toBe("bin");
    expect(archiveFileExtension("model/gltf+json", "bin")).toBe("gltf");
    expect(archiveFileExtension("model/gltf-binary", "bin")).toBe("glb");
    expect(archiveFileExtension("image/png", "bin")).toBe("png");
    expect(archiveFileExtension("audio/mpeg", "wav")).toBe("mp3");
});

test("canvas archive stores generic JSON with the fallback extension", async () => {
    blobs.set("file:notes", new Blob(["{}"], { type: "application/json" }));
    blobs.set("model:hero", new Blob([new Uint8Array([1, 2, 3])], { type: "model/gltf+json" }));
    const canvas = project(["file:notes", "model:hero"]);
    expect(await exportCanvasProjects([canvas])).toBe("saved");
    const archive = unzipSync(Buffer.from(saved[0].data, "base64"));
    const manifest = JSON.parse(new TextDecoder().decode(archive["projects.json"]));
    const paths = manifest.projects[0].files.map((file: { path: string }) => file.path).sort();
    expect(paths.some((path: string) => path.endsWith(".bin"))).toBe(true);
    expect(paths.some((path: string) => path.endsWith(".gltf"))).toBe(true);
    expect(paths.some((path: string) => path.endsWith(".json") && path.includes("files/"))).toBe(false);
});

test("canvas ZIP opens with all bytes after the source cache is emptied", async () => {
    blobs.set("image:one", new Blob([new Uint8Array([9, 8, 7])], { type: "image/png" }));
    blobs.set("file:notes", new Blob(["note-bytes"], { type: "application/json" }));
    expect(await exportCanvasProjects([project([...blobs.keys()])])).toBe("saved");
    const archiveFile = new File([Buffer.from(saved[0].data, "base64")], "workspace.zip");
    blobs.clear();
    restored.clear();
    const archive = await openCanvasArchive(archiveFile);
    expect(archive.data.projects).toHaveLength(1);
    const files = new Map(archive.data.projects[0].files.map((file) => [file.storageKey, archive.files.get(file.path)!]));
    expect(files.size).toBe(2);
    expect(new Uint8Array(await files.get("image:one")!.arrayBuffer())).toEqual(new Uint8Array([9, 8, 7]));
    expect(await files.get("file:notes")!.text()).toBe("note-bytes");
});

test("empty workspace ZIP opens with no media writes", async () => {
    blobs.clear();
    restored.clear();
    expect(await exportCanvasProjects([])).toBe("saved");
    const archiveFile = new File([Buffer.from(saved[0].data, "base64")], "empty.zip");
    blobs.clear();
    restored.clear();
    const archive = await openCanvasArchive(archiveFile);
    expect(archive.data.projects).toEqual([]);
    expect(restored.size).toBe(0);
});

test("missing media and corrupt canvas ZIP fail before writing restored files", async () => {
    restored.clear();
    const missing = await createZip([{
        name: "projects.json",
        data: JSON.stringify({
            app: "infinite-canvas",
            version: 4,
            exportedAt: "2026-10-02T00:00:00.000Z",
            projects: [{ project: { id: "broken", title: "损坏画布", nodes: [] }, files: [{ storageKey: "image:missing", path: "projects/broken/files/missing.png", mimeType: "image/png", bytes: 3 }] }],
        }),
    }]);
    await expect(openCanvasArchive(new File([missing], "missing.zip"))).rejects.toThrow("missing.png");
    expect(restored.size).toBe(0);

    const corrupt = await createZip([{ name: "projects.json", data: "{not-json" }]);
    await expect(openCanvasArchive(new File([corrupt], "corrupt.zip"))).rejects.toThrow("已损坏");
    expect(restored.size).toBe(0);
});

test("malformed asset archive fails before writing partial media; duplicate ZIP entries fail instead of overwriting", async () => {
    const archive = await createZip([{ name: "assets.json", data: JSON.stringify({ assets: [], files: [{ storageKey: "image:a", path: "a.png" }, { storageKey: "image:b", path: "b.png" }] }) }, { name: "a.png", data: "A" }]);
    await expect(readAssetPackage(new File([archive], "broken.zip"))).rejects.toThrow("b.png");
    expect(restored.size).toBe(0);
    await expect(createZip([{ name: "same", data: "A" }, { name: "same", data: "B" }])).rejects.toThrow("重名文件");
});
