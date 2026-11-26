import contracts from "../../../backend/internal/providerpreset/image_contracts.json";

export function beefAPIImageContract(model: string) {
    return contracts.find((contract) => contract.model === model.trim().toLowerCase());
}

/** 自有中转站的固定入口；只有它才允许代管企业凭证并使用平台素材域名。 */
export function isBeefAPIEndpoint(baseUrl: string): boolean {
    try {
        const url = new URL(baseUrl.trim());
        return url.protocol === "https:" && url.hostname === "api.siflux.cn" && !url.username && !url.password && (!url.port || url.port === "443");
    } catch {
        return false;
    }
}
