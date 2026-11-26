import React from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "./styles/globals.css";
import "./styles/beeftv-local-overrides.css";
import { RouterProvider } from "react-router";

import { AppProviders } from "@/components/layout/app-providers";
import { installBackspaceNavigationGuard } from "@/lib/backspace-navigation-guard";
import { router } from "@/router";

installBackspaceNavigationGuard();

document.body.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <AppProviders>
            <RouterProvider router={router} />
        </AppProviders>
    </React.StrictMode>,
);
