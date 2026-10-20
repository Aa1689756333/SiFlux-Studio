const workspaceRouteLoaders = {
    agents: () => import("@/pages/agents"),
    agent: () => import("@/pages/agent"),
    chat: () => import("@/pages/chat"),
    usage: () => import("@/pages/usage"),
    home: () => import("@/pages/home"),
    assets: () => import("@/pages/assets"),
    canvas: () => import("@/pages/canvas"),
    create: () => import("@/pages/create"),
    generate: () => import("@/pages/generate-image"),
    generateAudio: () => import("@/pages/generate-audio"),
    generateVideo: () => import("@/pages/generate-video"),
    projects: () => import("@/pages/projects"),
    projectDetail: () => import("@/pages/projects/detail"),
};

export const loadAgentsPage = workspaceRouteLoaders.agents;
export const loadAgentPage = workspaceRouteLoaders.agent;
export const loadChatPage = workspaceRouteLoaders.chat;
export const loadUsagePage = workspaceRouteLoaders.usage;
export const loadAssetsPage = workspaceRouteLoaders.assets;
export const loadHomePage = workspaceRouteLoaders.home;
export const loadCanvasPage = workspaceRouteLoaders.canvas;
export const loadCanvasProjectPage = () => import("@/pages/canvas/project");
export const loadCreatePage = workspaceRouteLoaders.create;
export const loadGenerateImagePage = workspaceRouteLoaders.generate;
export const loadGenerateAudioPage = workspaceRouteLoaders.generateAudio;
export const loadGenerateVideoPage = workspaceRouteLoaders.generateVideo;
export const loadProjectDetailPage = workspaceRouteLoaders.projectDetail;
export const loadProjectsPage = workspaceRouteLoaders.projects;

export function preloadWorkspaceRoute(pathnameOrSlug: string) {
    const segments = pathnameOrSlug.replace(/^\//, "").split("/").filter(Boolean);
    const slug = segments[0] || "home";
    if (slug === "projects" && segments.length > 1) {
        void workspaceRouteLoaders.projectDetail();
        return;
    }
    if (slug === "generate" && segments[1] === "audio") {
        void workspaceRouteLoaders.generateAudio();
        return;
    }
    if (slug === "generate" && segments[1] === "video") {
        void workspaceRouteLoaders.generateVideo();
        return;
    }
    const load = workspaceRouteLoaders[slug as keyof typeof workspaceRouteLoaders];
    if (load) void load();
}
