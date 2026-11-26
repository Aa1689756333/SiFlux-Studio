import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Outlet, useLocation, useParams } from "react-router";

import { createWorkspaceRouter } from "@/lib/app-routing";
import { FullScreenLoader, WorkspaceRouteLoader } from "@/components/ui/aceternity/full-screen-loader";
import { loadAgentPage, loadAssetsPage, loadCanvasPage, loadCanvasProjectPage, loadGenerateImagePage, loadSkillsPage } from "@/lib/workspace-route-modules";
import { CanvasRefreshShell } from "@/pages/canvas/canvas-refresh-shell";
import RouteErrorPage from "@/pages/route-error";

const AgentPage = lazy(loadAgentPage);
const LocalSkillsPage = lazy(loadSkillsPage);

const AssetsPage = lazy(loadAssetsPage);
const CanvasPage = lazy(loadCanvasPage);
const CanvasProjectPage = lazy(loadCanvasProjectPage);
const GenerateImagePage = lazy(loadGenerateImagePage);
const NotFound = lazy(() => import("@/pages/not-found"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const UserLayout = lazy(() => import("@/layouts/user-layout"));

function deferred(element: ReactNode) {
    return <Suspense fallback={<WorkspaceRouteLoader />}>{element}</Suspense>;
}

function WorkspaceLayout() {
    const { pathname } = useLocation();
    const fallback = pathname.startsWith("/canvas/") ? <CanvasRefreshShell /> : <FullScreenLoader label="正在打开工作区" detail="准备当前页面" />;
    return <Suspense fallback={fallback}><UserLayout><Outlet /></UserLayout></Suspense>;
}

function CanvasProjectAliasRoute() {
    const { projectId } = useParams();
    return <Navigate to={`/canvas/${projectId}`} replace />;
}

export const router = createWorkspaceRouter([
    {
        element: <WorkspaceLayout />,
        errorElement: <RouteErrorPage />,
        children: [
            { path: "/", element: <Navigate to="/generate/image" replace /> },
            { path: "/generate/image", element: deferred(<GenerateImagePage />) },
            { path: "/agent", element: deferred(<AgentPage />) },
            { path: "/assets", element: deferred(<AssetsPage />) },
            { path: "/settings", element: deferred(<SettingsPage />) },
            { path: "/skills", element: deferred(<LocalSkillsPage />) },
    
            { path: "/projects", element: <Navigate to="/canvas" replace /> },
            { path: "/project", element: <Navigate to="/canvas" replace /> },
            { path: "/projects/:projectId", element: <CanvasProjectAliasRoute /> },
            { path: "/project/:projectId", element: <CanvasProjectAliasRoute /> },
            { path: "/canvas", element: deferred(<CanvasPage />) },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
        ],
    },
    { path: "*", element: <Suspense fallback={<FullScreenLoader />}><NotFound /></Suspense> },
]);
