// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { createNativeChromeHandlers } from "./native-chrome-handlers.js";

const require = createRequire(import.meta.url);
const { CDPClient } = require("./cdp-client.js");

describe("native browser literal form input", () => {
  it("passes the requested text literally instead of a base64 payload", async () => {
    const calls: Array<{ method: string; params: any }> = [];
    const cdpClient = {
      async send(method: string, params: any) {
        calls.push({ method, params });
        if (method === "Runtime.evaluate") {
          return { result: { value: JSON.stringify({ ok: true }) } };
        }
        return {};
      },
    };

    const handlers = createNativeChromeHandlers(cdpClient);
    await handlers.fill("#name", "Maike Rosa da Silva", true);

    const expression = calls.find((call) => call.method === "Runtime.evaluate")?.params.expression || "";
    expect(expression).toContain("Maike Rosa da Silva");
    expect(expression).not.toContain("TWFpa2UgUm9zYSBkYSBTaWx2YQ==");
  });

  it("receives Fetch.requestPaused events through the CDP client", async () => {
    const cdpClient = new CDPClient({});
    cdpClient._requestLogger = null;
    cdpClient.send = async () => ({});
    const handlers = createNativeChromeHandlers(cdpClient);

    await handlers.interceptRequests({ urlPatterns: ["*api*"] });
    cdpClient._handleMessage({
      method: "Fetch.requestPaused",
      params: {
        requestId: "paused-1",
        request: { url: "https://example.test/api/parts", method: "GET", headers: {} },
        resourceType: "Fetch",
      },
    });

    expect(await handlers.getPausedRequests()).toMatchObject([
      { requestId: "paused-1", request: { url: "https://example.test/api/parts" } },
    ]);
  });
});
