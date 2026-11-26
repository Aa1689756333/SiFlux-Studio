import type { ReactNode } from "react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import type { Asset } from "@/stores/use-asset-store";

type AssetMediaPreviewProps = {
    asset?: Asset | null;
    alt: string;
    className?: string;
    fallback?: ReactNode;
};

/** 素材封面预览。素材收敛为文字/图片/模型/实体后，封面媒体只剩图片一种来源。 */
export function AssetMediaPreview({ asset, alt, className = "", fallback = null }: AssetMediaPreviewProps) {
    if (!asset) return fallback;
    const storageKey = asset.kind === "image" ? asset.data.storageKey : undefined;
    const imageUrl = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
    if (!imageUrl && !storageKey) return fallback;
    return (
        <CachedResourceImage
            key={asset.id}
            storageKey={storageKey}
            src={imageUrl}
            alt={alt}
            loading="lazy"
            decoding="async"
            className={className}
            fallback={fallback}
        />
    );
}
