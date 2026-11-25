import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
    CanvasMediaPersistUnconfirmedError,
    persistOwnedCanvasMediaNodes,
    type PersistOwnedCanvasMediaNodesDeps,
} from "@/lib/canvas/canvas-media-persist";
import { getActiveUserScope, setActiveUserScope } from "@/lib/user-scope";
import { captureUserScope, UserScopeAbandonedError, type CapturedUserScope } from "@/lib/user-scope-guard";
import { apiClient } from "@/services/api/request";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function switchScope(userId: string) {
    const previous = getActiveUserScope();
    setActiveUserScope(userId);
    return () => setActiveUserScope(previous);
}

function imageNode(id: string, extra: Partial<CanvasNodeData["metadata"]> = {}): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: id,
        position: { x: 0, y: 0 },
        width: 8,
        height: 8,
        metadata: { content: "data:image/png;base64,xx", ...extra },
    };
}

function persistDeps(overrides: Partial<PersistOwnedCanvasMediaNodesDeps> & Pick<PersistOwnedCanvasMediaNodesDeps, "ensureCanvasNodeAsset" | "getLiveProjectId" | "getLiveNodes">): PersistOwnedCanvasMediaNodesDeps {
    return {
        getStoredProject: () => ({ nodes: overrides.getLiveNodes(), connections: [] }),
        hasProject: () => true,
        updateProject: () => undefined,
        flushPersistence: async () => undefined,
        setNodes: () => undefined,
        getLiveConnections: () => [],
        isLocalWorkspace: () => false,
        ...overrides,
    };
}

describe("persistOwnedCanvasMediaNodes interior ownership", () => {
    test("project switch while ensure is awaiting does not overlay live nodes, setNodes, or ack save", async () => {
        const restore = switchScope("owner-a");
        const expectedScope = captureUserScope();
        const entered = deferred();
        const gate = deferred();
        let liveProject = "proj-a";
        let liveNodes = [imageNode("live-a")];
        const setNodesCalls: CanvasNodeData[][] = [];
        const updates: Array<{ id: string; nodes: string[] }> = [];
        const media = imageNode("media-1");
        try {
            const pending = persistOwnedCanvasMediaNodes({
                canvasId: "proj-a",
                mediaNodes: [media],
                expectedScope,
            }, persistDeps({
                ensureCanvasNodeAsset: async () => {
                    entered.resolve();
                    await gate.promise;
                    return { assetId: "asset-1", created: true, linkedToProject: true, confirmed: true };
                },
                getLiveProjectId: () => liveProject,
                getLiveNodes: () => liveNodes,
                setNodes: (updater) => { setNodesCalls.push(updater(liveNodes)); },
                updateProject: (id, patch) => { updates.push({ id, nodes: patch.nodes.map((node) => node.id) }); },
            }));
            await entered.promise;
            liveProject = "proj-b";
            liveNodes = [imageNode("live-b")];
            gate.resolve();
            await expect(pending).rejects.toMatchObject({ name: "AbortError" });
            expect(setNodesCalls).toEqual([]);
            expect(updates).toEqual([]);
        } finally {
            restore();
        }
    });

    test("A to B to A while ensure is awaiting does not write the original canvas", async () => {
        const restore = switchScope("owner-a");
        const expectedScope = captureUserScope();
        const entered = deferred();
        const gate = deferred();
        const updates: unknown[] = [];
        try {
            const pending = persistOwnedCanvasMediaNodes({
                canvasId: "proj-a",
                mediaNodes: [imageNode("media-1")],
                expectedScope,
            }, persistDeps({
                ensureCanvasNodeAsset: async () => {
                    entered.resolve();
                    await gate.promise;
                    return { assetId: "asset-1", created: true, linkedToProject: true, confirmed: true };
                },
                getLiveProjectId: () => "proj-a",
                getLiveNodes: () => [imageNode("live-a")],
                updateProject: (_id, patch) => { updates.push(patch); },
            }));
            await entered.promise;
            setActiveUserScope("owner-b");
            setActiveUserScope("owner-a");
            gate.resolve();
            await expect(pending).rejects.toBeInstanceOf(UserScopeAbandonedError);
            expect(updates).toEqual([]);
        } finally {
            restore();
        }
    });

    test("unconfirmed asset result does not updateProject, flush, or ack save", async () => {
        const restore = switchScope("owner-a");
        const expectedScope = captureUserScope();
        let flushed = 0;
        let synced = 0;
        let readBack = 0;
        const updates: unknown[] = [];
        const setNodesCalls: unknown[] = [];
        try {
            await expect(persistOwnedCanvasMediaNodes({
                canvasId: "proj-a",
                mediaNodes: [imageNode("media-1")],
                expectedScope,
            }, persistDeps({
                ensureCanvasNodeAsset: async () => ({ assetId: "draft-1", created: true, linkedToProject: false, confirmed: false }),
                getLiveProjectId: () => "proj-a",
                getLiveNodes: () => [],
                setNodes: (updater) => { setNodesCalls.push(updater([])); },
                updateProject: (_id, patch) => { updates.push(patch); },
                flushPersistence: async () => { flushed += 1; },
                isLocalWorkspace: () => true,
                syncSnapshot: async () => { synced += 1; },
                readSavedProject: async () => {
                    readBack += 1;
                    return { nodes: [] };
                },
            }))).rejects.toBeInstanceOf(CanvasMediaPersistUnconfirmedError);
            expect(updates).toEqual([]);
            expect(setNodesCalls).toEqual([]);
            expect(flushed).toBe(0);
            expect(synced).toBe(0);
            expect(readBack).toBe(0);
        } finally {
            restore();
        }
    });

    test("ordinary ensure error after project switch does not warn", async () => {
        const restore = switchScope("owner-a");
        const expectedScope = captureUserScope();
        const entered = deferred();
        const gate = deferred();
        let liveProject = "proj-a";
        const warnings: string[] = [];
        const errors: string[] = [];
        try {
            const pending = persistOwnedCanvasMediaNodes({
                canvasId: "proj-a",
                mediaNodes: [imageNode("media-1")],
                expectedScope,
            }, persistDeps({
                ensureCanvasNodeAsset: async () => {
                    entered.resolve();
                    await gate.promise;
                    throw new Error("network down");
                },
                getLiveProjectId: () => liveProject,
                getLiveNodes: () => [],
                warn: (text) => { warnings.push(text); },
                error: (text) => { errors.push(text); },
            }));
            await entered.promise;
            liveProject = "proj-b";
            gate.resolve();
            await expect(pending).rejects.toMatchObject({ name: "AbortError" });
            expect(warnings).toEqual([]);
            expect(errors).toEqual([]);
        } finally {
            restore();
        }
    });

    test("ordinary flush error after project switch or A to B to A does not toast", async () => {
        const restore = switchScope("owner-a");
        const expectedScope = captureUserScope();
        const switchEntered = deferred();
        const switchGate = deferred();
        const abaEntered = deferred();
        const abaGate = deferred();
        let liveProject = "proj-a";
        const switchErrors: string[] = [];
        const abaErrors: string[] = [];
        try {
            const switched = persistOwnedCanvasMediaNodes({
                canvasId: "proj-a",
                mediaNodes: [imageNode("media-1")],
                expectedScope,
            }, persistDeps({
                ensureCanvasNodeAsset: async () => ({ assetId: "asset-1", created: true, linkedToProject: true, confirmed: true }),
                getLiveProjectId: () => liveProject,
                getLiveNodes: () => [],
                flushPersistence: async () => {
                    switchEntered.resolve();
                    await switchGate.promise;
                    throw new Error("flush failed");
                },
                error: (text) => { switchErrors.push(text); },
            }));
            await switchEntered.promise;
            liveProject = "proj-b";
            switchGate.resolve();
            await expect(switched).rejects.toMatchObject({ name: "AbortError" });
            expect(switchErrors).toEqual([]);

            const aba = persistOwnedCanvasMediaNodes({
                canvasId: "proj-a",
                mediaNodes: [imageNode("media-2")],
                expectedScope,
            }, persistDeps({
                ensureCanvasNodeAsset: async () => ({ assetId: "asset-2", created: true, linkedToProject: true, confirmed: true }),
                getLiveProjectId: () => "proj-a",
                getLiveNodes: () => [],
                flushPersistence: async () => {
                    abaEntered.resolve();
                    await abaGate.promise;
                    throw new Error("flush failed");
                },
                error: (text) => { abaErrors.push(text); },
            }));
            await abaEntered.promise;
            setActiveUserScope("owner-b");
            setActiveUserScope("owner-a");
            abaGate.resolve();
            await expect(aba).rejects.toBeInstanceOf(UserScopeAbandonedError);
            expect(abaErrors).toEqual([]);
        } finally {
            restore();
        }
    });

    test("ordinary flush error on the original session still reports save failure", async () => {
        const restore = switchScope("owner-a");
        const expectedScope = captureUserScope();
        const errors: string[] = [];
        try {
            await expect(persistOwnedCanvasMediaNodes({
                canvasId: "proj-a",
                mediaNodes: [imageNode("media-1")],
                expectedScope,
            }, persistDeps({
                ensureCanvasNodeAsset: async () => ({ assetId: "asset-1", created: true, linkedToProject: true, confirmed: true }),
                getLiveProjectId: () => "proj-a",
                getLiveNodes: () => [],
                flushPersistence: async () => {
                    throw new Error("flush failed");
                },
                error: (text) => { errors.push(text); },
            }))).rejects.toThrow("flush failed");
            expect(errors).toEqual(["媒体结果已生成，但本地画布保存失败：flush failed"]);
        } finally {
            restore();
        }
    });

    test("open, flush, and sync receive the captured expectedScope", async () => {
        const restore = switchScope("owner-a");
        const expectedScope = captureUserScope();
        const media = imageNode("media-1");
        let exists = false;
        const opened: CapturedUserScope[] = [];
        const flushed: CapturedUserScope[] = [];
        const synced: CapturedUserScope[] = [];
        try {
            await persistOwnedCanvasMediaNodes({
                canvasId: "proj-a",
                mediaNodes: [media],
                expectedScope,
            }, persistDeps({
                ensureCanvasNodeAsset: async () => ({ assetId: "asset-1", created: true, linkedToProject: true, confirmed: true }),
                getLiveProjectId: () => "proj-a",
                getLiveNodes: () => [],
                hasProject: () => exists,
                openProject: async (_id, scope) => {
                    opened.push(scope);
                    exists = true;
                },
                flushPersistence: async (scope) => { flushed.push(scope); },
                isLocalWorkspace: () => true,
                syncSnapshot: async (_id, _patch, scope) => { synced.push(scope); },
                readSavedProject: async () => ({ nodes: [{ ...media, metadata: { ...media.metadata, assetId: "asset-1" } }] }),
            }));
            expect(opened).toEqual([expectedScope]);
            expect(flushed).toEqual([expectedScope]);
            expect(synced).toEqual([expectedScope]);
        } finally {
            restore();
        }
    });
});
