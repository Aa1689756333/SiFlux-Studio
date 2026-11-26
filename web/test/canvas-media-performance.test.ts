import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

import { canvasNodeRenderPadding } from "../src/lib/canvas/canvas-performance-mode";
import { shouldRefreshCanvasVirtualization } from "../src/lib/canvas/canvas-viewport-render-sync";

const canvasNodeContentSource = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-node-content.tsx"), "utf8");
const canvasNodeSource = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-node.tsx"), "utf8");
const canvasProjectSource = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/project.tsx"), "utf8");
const globalStylesSource = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");

describe("canvas dimension header rendering", () => {
    test("tracks live viewport scale without React width commits", () => {
        expect(canvasNodeSource).toContain("calc(var(--canvas-node-width) * var(--canvas-live-scale, 1))");
        expect(canvasNodeSource).toContain('"--canvas-node-width": `${node.width}px`');
    });
});

describe("large canvas media rendering", () => {
    test("refreshes the virtualized node window during continuous viewport movement without committing every wheel event", () => {
        const previous = { x: 0, y: 0, k: 1 };
        const moved = { x: 0, y: -360, k: 1 };
        expect(shouldRefreshCanvasVirtualization(previous, moved, 1_000, 1_030)).toBe(false);
        expect(shouldRefreshCanvasVirtualization(previous, moved, 1_000, 1_064)).toBe(true);
        expect(shouldRefreshCanvasVirtualization(previous, previous, 1_000, 1_200)).toBe(false);
    });

    test("keeps rendered nodes mounted longer than newly entering nodes", () => {
        expect(canvasNodeRenderPadding(true, false)).toBe(128);
        expect(canvasNodeRenderPadding(true, true)).toBe(640);
        expect(canvasNodeRenderPadding(false, true)).toBeGreaterThan(canvasNodeRenderPadding(false, false));
    });

    test("does not eagerly load or resize LibTV thumbnails", () => {
        expect(canvasNodeContentSource).toContain('loading="lazy"');
        expect(canvasNodeContentSource).not.toContain('importedFromLibTV ? "eager"');
        expect(canvasNodeContentSource).toContain("if (importedFromLibTV) return;");
    });

    test("keeps canvas node action context stable across viewport renders", () => {
        expect(canvasProjectSource).toContain("const canvasNodeActions = useMemo<CanvasNodeActionContextValue>");
        expect(canvasProjectSource).toContain("<CanvasNodeActionContext.Provider value={canvasNodeActions}>");
    });

    test("keeps node shells visible while panning and zooming", () => {
        expect(globalStylesSource).not.toMatch(/\[data-canvas-viewport-interacting="true"\]\s+\.canvas-node-shell\s*\{[^}]*content-visibility:\s*hidden/);
    });

    test("keeps the first activation click from being treated as a node drag", () => {
        expect(canvasNodeContentSource).toContain("onPointerDown={(event) => event.stopPropagation()}");
        expect(canvasNodeContentSource).toContain("onMouseDown={(event) => event.stopPropagation()}");
    });

    test("raises only selected nodes above the canvas dock so controls remain reachable", () => {
        expect(canvasNodeSource).toContain('isSelected ? "z-[var(--z-node-toolbar)]"');
    });
});