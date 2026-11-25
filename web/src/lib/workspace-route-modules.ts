const workspaceRouteLoaders = {
    agents: () => import("@/pages/agents"),
    agent: () => import("@/pages/agent"),
    skills: () => import("@/pages/skills/local"),
    assets: () => import("@/pages/assets"),
    canvas: () => import("@/pages/canvas"),
    generate: () => import("@/pages/generate-image"),
    settings: () => import("@/pages/settings"),
};

export const loadAgentsPage = workspaceRouteLoaders.agents;
export const loadAgentPage = workspaceRouteLoaders.agent;
export const loadSkillsPage = workspaceRouteLoaders.skills;
export const loadAssetsPage = workspaceRouteLoaders.assets;
export const loadCanvasPage = workspaceRouteLoaders.canvas;
export const loadCanvasProjectPage = () => import("@/pages/canvas/project");
export const loadGenerateImagePage = workspaceRouteLoaders.generate;

export function preloadWorkspaceRoute(pathnameOrSlug: string) {
    const segments = pathnameOrSlug.split(/[?#]/, 1)[0].replace(/^\//, "").split("/").filter(Boolean);
    const slug = segments[0] || "generate";
    if ((slug === "canvas" || slug === "project" || slug === "projects") && segments.length > 1) {
        void loadCanvasProjectPage();
        return;
    }
    if (slug === "project" || slug === "projects") {
        void loadCanvasPage();
        return;
    }
    if (slug === "generate" && segments[1] && segments[1] !== "image") return;
    const load = workspaceRouteLoaders[slug as keyof typeof workspaceRouteLoaders];
    if (load) void load();
}
