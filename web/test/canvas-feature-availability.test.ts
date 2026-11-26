import { describe, expect, test } from "bun:test";

import { CANVAS_DEVELOPING_LABEL, getCanvasNodeCreationDisabledReason, isCanvasNodeCreationEnabled } from "../src/lib/canvas/canvas-feature-availability";
import { CanvasNodeType } from "../src/types/canvas";

describe("canvas developing features", () => {
    test.each([CanvasNodeType.Frame])("blocks creation of %s", (type) => {
        expect(getCanvasNodeCreationDisabledReason(type)).toBe(CANVAS_DEVELOPING_LABEL);
        expect(isCanvasNodeCreationEnabled(type)).toBeFalse();
    });

    test("keeps released image, text and config nodes available", () => {
        for (const type of [CanvasNodeType.Text, CanvasNodeType.Image, CanvasNodeType.Config]) {
            expect(getCanvasNodeCreationDisabledReason(type)).toBeUndefined();
            expect(isCanvasNodeCreationEnabled(type)).toBeTrue();
        }
    });
});
