import { expect, test } from "bun:test";
import { isBeefAPIEndpoint } from "../src/lib/beefapi-image-contracts";
import { channelRequest } from "../src/services/api/custom-channel-relay";

test("the managed brand endpoint keeps strict recognition and relay credentials", () => {
    for (const baseUrl of ["https://api.siflux.cn", "https://api.siflux.cn/v1"]) {
        expect(isBeefAPIEndpoint(baseUrl)).toBe(true);
        const request = channelRequest({ baseUrl, apiKey: "", apiFormat: "openai" }, baseUrl + "/v1/models");
        expect(request.url).toContain("/ai/custom");
        expect(JSON.stringify(request)).not.toContain("Bearer ");
    }
    for (const baseUrl of ["http://api.siflux.cn", "https://api.siflux.cn:444", "https://api.siflux.cn.evil.test", "https://user@api.siflux.cn", "https://evil.test/api.siflux.cn"]) {
        expect(isBeefAPIEndpoint(baseUrl)).toBe(false);
    }
});