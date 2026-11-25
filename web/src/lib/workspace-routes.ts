export function isSpatialWorkbenchPath(pathname: string) {
    const canvasEditor = /^\/canvas\/[^/]+(?:\/|$)/.test(pathname);
    return !canvasEditor;
}
