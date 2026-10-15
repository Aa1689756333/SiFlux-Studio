import { Tooltip } from "antd";
import { Globe, Star } from "lucide-react";
import Github from "@lobehub/icons/es/Github";
import { getDesktopAppBinding } from "@/services/desktop-runtime";

export function WorkspaceSidebarSocialLinks() {
    const openGitHub = async (event: React.MouseEvent<HTMLAnchorElement>) => {
        const openInBrowser = getDesktopAppBinding()?.OpenSiFluxGitHub;
        if (!openInBrowser) return;
        event.preventDefault();
        await openInBrowser();
    };
    const openWebsite = async (event: React.MouseEvent<HTMLAnchorElement>) => {
        const openInBrowser = getDesktopAppBinding()?.OpenSiFluxWebsite;
        if (!openInBrowser) return;
        event.preventDefault();
        await openInBrowser();
    };

    return (
        <div className="app-workspace-social-links">
            <a className="app-workspace-social-action" href="https://siflux.cn" target="_blank" rel="noopener noreferrer" aria-label="打开 SiFlux Studio 官网" title="SiFlux Studio 官网" onClick={openWebsite}>
                <Globe aria-hidden="true" />
            </a>
            <Tooltip
                placement="top"
                trigger={["hover", "focus"]}
                mouseEnterDelay={0.15}
                mouseLeaveDelay={0.1}
                rootClassName="app-workspace-github-tooltip"
                title={<span className="app-workspace-github-hint">点点 star <Star aria-hidden="true" /></span>}
            >
                <a className="app-workspace-social-action" href="https://github.com/Aa1689756333/SiFlux-Studio" target="_blank" rel="noopener noreferrer" aria-label="打开 SiFlux Studio GitHub 仓库" onClick={openGitHub}>
                    <Github aria-hidden="true" />
                </a>
            </Tooltip>
        </div>
    );
}
