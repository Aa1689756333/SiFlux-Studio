import { expect, test } from "bun:test";

test("canvas prompt footers omit the preset trigger while the config composer keeps its own entry", async () => {
    const panel = await Bun.file(new URL("../src/components/canvas/canvas-node-prompt-panel.tsx", import.meta.url)).text();
    const footer = panel.slice(panel.indexOf("const renderComposerControls"), panel.indexOf("const renderPromptEditor"));
    expect(footer.match(/<CanvasPresetPicker/g)?.length ?? 0).toBe(0);
    const configComposer = await Bun.file(new URL("../src/components/canvas/canvas-config-composer.tsx", import.meta.url)).text();
    expect(configComposer.match(/<CanvasPresetPicker/g)?.length ?? 0).toBe(1);
});

test("camera control stays in the composer controls below the prompt", async () => {
    const panel = await Bun.file(new URL("../src/components/canvas/canvas-node-prompt-panel.tsx", import.meta.url)).text();
    const composerStart = panel.indexOf("const renderComposerControls");
    const composer = panel.slice(composerStart, panel.indexOf("const renderPromptEditor", composerStart));
    const editorStart = panel.indexOf("const renderPromptEditor");
    const editor = panel.slice(editorStart, panel.indexOf("return (", editorStart));
    expect(composer).toContain("<CanvasCameraControlPopover");
    expect(editor).not.toContain("<CanvasCameraControlPopover");
    expect(panel.indexOf("{renderPromptEditor(false)}")).toBeLessThan(panel.indexOf("{renderComposerControls(false)}"));
});
