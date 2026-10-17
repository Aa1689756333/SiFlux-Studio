import { expect, test } from "bun:test";
import { isBeefAPIEndpoint } from "../src/lib/beefapi-video-contracts";
import { channelRequest } from "../src/services/api/custom-channel-relay";

test("both brands retain strict managed endpoint recognition and relay credentials", () => {
    for (const baseUrl of ["https://beeftv.app", "https://enterprise.beefapi.com"]) {
        expect(isBeefAPIEndpoint(baseUrl + "/v1")).toBe(true);
        const request = channelRequest({baseUrl, apiKey: "", apiFormat: "openai"}, baseUrl + "/v1/models");
        expect(request.url).toContain("/ai/custom");
        expect(JSON.stringify(request)).not.toContain("Bearer ");
    }
    for (const baseUrl of ["http://beeftv.app", "https://beeftv.app:444", "https://beeftv.app.evil.test", "https://user@beeftv.app", "https://evil.test/beeftv.app"]) {
        expect(isBeefAPIEndpoint(baseUrl)).toBe(false);
    }
});

