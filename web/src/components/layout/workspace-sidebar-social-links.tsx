import { Globe } from "lucide-react";
import { getDesktopAppBinding } from "@/services/desktop-runtime";

export function WorkspaceSidebarSocialLinks() {
    const openWebsite = async (event: React.MouseEvent<HTMLAnchorElement>) => {
        const openInBrowser = getDesktopAppBinding()?.OpenSiFluxWebsite;
        if (!openInBrowser) return;
        event.preventDefault();
        await openInBrowser();
    };

    return (
        <div className="app-workspace-social-links">
            <a className="app-workspace-social-action is-website" href="https://siflux.cn" target="_blank" rel="noopener noreferrer" aria-label="打开 SiFlux Studio 官网" title="SiFlux Studio 官网" onClick={openWebsite}>
                <Globe aria-hidden="true" />
                <span className="app-workspace-social-label">官网</span>
            </a>
        </div>
    );
}
