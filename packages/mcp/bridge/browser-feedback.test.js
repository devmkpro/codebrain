// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createNativeChromeHandlers } = require("./native-chrome-handlers.js");
const { createBrowserHandlers } = require("./browser-handlers.js");
const { createScrapingHandlers } = require("./scraping-handlers.js");
const roots = [];
function workspace() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-browser-feedback-")); roots.push(root); return root; }
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks(); });
const image = Buffer.from("fixture-image").toString("base64");
function client(extra = {}) {
  return {
    activePort: 9441, browserWsUrl: "ws://127.0.0.1:9441/devtools/page/current",
    isConnected: vi.fn(() => true), detect: vi.fn(async () => ({ available: false })),
    send: vi.fn(async (method) => method === "Page.captureScreenshot" ? { data: image } : method === "Page.getFrameTree" ? { frameTree: { frame: { id: "current", url: "https://fixture.test/chat" } } } : { result: { value: 42 } }),
    ...extra,
  };
}
describe("browser feedback regressions", () => {
  it("saves screenshot artifacts by default and opts into inline/format explicitly", async () => {
    const root = workspace(); const cdp = client();
    const handlers = createNativeChromeHandlers(cdp, { getCurrentWorkspacePath: () => root });
    const shot = await handlers.screenshot(false);
    expect(shot.data).toBeUndefined(); expect(shot.path).toContain(root);
    expect(fs.readFileSync(shot.path, "utf8")).toBe("fixture-image");
    const inline = await handlers.screenshot(false, { inline: true, format: "jpeg" });
    expect(inline.data).toBe(image); expect(inline.format).toBe("jpeg");
    expect(cdp.send).toHaveBeenCalledWith("Page.captureScreenshot", { format: "jpeg" });
  });
  it("does not alter an emulated viewport even when full-page capture fails", async () => {
    const cdp = client({ send: vi.fn(async (method) => {
      if (method === "Runtime.evaluate") return { result: { value: '{"width":1200,"height":2000}' } };
      if (method === "Page.captureScreenshot") throw new Error("fixture capture failure");
      return {};
    }) });
    await expect(createNativeChromeHandlers(cdp).screenshot(true)).rejects.toThrow("fixture capture failure");
    expect(cdp.send).not.toHaveBeenCalledWith("Emulation.clearDeviceMetricsOverride");
    expect(cdp.send).not.toHaveBeenCalledWith("Emulation.setDeviceMetricsOverride", expect.anything());
  });
  it("sizes the CSS viewport via CDP rather than changing an unrelated browser window", async () => {
    const cdp = client({ send: vi.fn(async (method) => method === "Runtime.evaluate" ? { result: { value: '{"width":390,"height":844}' } } : {}) });
    expect(await createNativeChromeHandlers(cdp).resizeWindow({ width: 390, height: 844 })).toMatchObject({ ok: true, width: 390, height: 844 });
    expect(cdp.send).toHaveBeenCalledWith("Emulation.setDeviceMetricsOverride", expect.objectContaining({ width: 390, height: 844 }));
    expect(cdp.send).not.toHaveBeenCalledWith("Browser.getWindowForTarget");
  });
  it("excludes console messages that predate the current navigation", async () => {
    const cdp = client({ getEvents: () => [
      { method: "Runtime.consoleAPICalled", timestamp: 1000, params: { type: "error", args: [{ value: "old HMR" }] } },
      { method: "Runtime.consoleAPICalled", timestamp: 2000, params: { type: "error", args: [{ value: "current error" }] } },
    ] });
    const result = await createBrowserHandlers({ cdpClient: cdp }).browserConsoleLog("error", 1500, 20);
    expect(result.entries).toMatchObject([{ text: "current error" }]); expect(result.entries).toHaveLength(1);
  });
  it("awaits Promise results in browser_eval", async () => {
    const cdp = client(); await createNativeChromeHandlers(cdp).evalJs("Promise.resolve(42)");
    expect(cdp.send).toHaveBeenCalledWith("Runtime.evaluate", expect.objectContaining({ awaitPromise: true, returnByValue: true }));
  });
  it("passes screenshot options through the browser bridge and keeps element/computer captures compact", async () => {
    const root = workspace();
    const cdp = client({ send: vi.fn(async (method) => method === "Page.captureScreenshot" ? { data: image } : { result: { value: '{"x":1,"y":2,"width":80,"height":40}' } }) });
    const browser = createBrowserHandlers({ cdpClient: cdp, getCurrentWorkspacePath: () => root });
    const shot = await browser.browserScreenshot(false, undefined, { inline: true, format: "webp" });
    expect(shot.data).toBe(image); expect(shot.path).toMatch(/\.webp$/);
    const native = createNativeChromeHandlers(cdp, { getCurrentWorkspacePath: () => root });
    expect((await native.screenshotElement("#fixture")).data).toBeUndefined();
    expect((await native.computer({ action: "screenshot" })).data).toBeUndefined();
    await expect(native.screenshot(false, { format: "../../invalid" })).rejects.toThrow(/format/);
  });
  it("reuses the connected launch port and returns a flat tab array", async () => {
    const cdp = client({ discoverTargets: vi.fn(async () => [{ type: "page", id: "current", title: "fixture", url: "https://fixture.test/chat" }]), launch: vi.fn(async () => ({ ok: true, port: 9441 })) });
    const handlers = createBrowserHandlers({ cdpClient: cdp });
    expect((await handlers.browserLaunch({ port: 9441 })).cdpConnected).toBe(true);
    expect(await handlers.browserTabsList()).toMatchObject({ ok: true, tabs: [{ id: "current" }] });
    expect(cdp.discoverTargets).toHaveBeenCalledWith(9441);
    expect(cdp.detect).not.toHaveBeenCalled();
  });
  it("joins response status and scopes request logs to the active frame/site", async () => {
    const request = (id, frameId, site) => ({ method: "Network.requestWillBeSent", timestamp: 2000, params: { requestId: id, frameId, documentURL: site, request: { method: "POST", url: `${site}/login`, headers: { Cookie: "never-return" } } } });
    const events = [request("mine", "current", "https://fixture.test"), request("other", "foreign", "https://other.test"), request("old", "current", "https://previous.test"), { method: "Network.responseReceived", timestamp: 2010, params: { requestId: "mine", response: { status: 401, statusText: "Unauthorized" } } }];
    const logger = { query: vi.fn(() => ({ requests: [{ url: "https://other.test/login", request_body: "private" }] })) };
    const cdp = client({ getEvents: () => events, _requestLogger: logger });
    const handlers = createBrowserHandlers({ cdpClient: cdp });
    const result = await handlers.browserNetworkLog("/login", "post", 401, 1900, 10);
    expect(result.entries).toMatchObject([{ id: "mine", status: 401 }]); expect(result.entries).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("never-return");
    const requests = await handlers.browserRequestsLog({ url_filter: "/login", status: 401 });
    expect(requests.requests).toHaveLength(1); expect(requests.scope).toBe("current-tab");
    expect(JSON.stringify(requests)).not.toMatch(/other\.test|previous\.test|private|never-return/);
    expect(logger.query).not.toHaveBeenCalled();
    expect((await handlers.browserNetworkLog("/login", "POST", 200, 1900, 10)).entries).toEqual([]);
    expect((await handlers.browserNetworkLog("/login", "POST", 401, 2011, 10)).entries).toEqual([]);
    expect(JSON.stringify(await handlers.browserRequestsSearch({ query: "login" }))).not.toMatch(/other\.test|private/);
    expect(JSON.stringify(await handlers.browserRequestsStats())).not.toMatch(/other\.test|private/);
    expect(JSON.stringify(await handlers.browserRequestsExport({ format: "csv" }))).not.toMatch(/other\.test|private/);
  });
  it("scraping_screenshot uses the existing attached CDP capability, not an invented worker command", async () => {
    const root = workspace(); const screenshot = vi.fn(async () => ({ ok: true, data: image, format: "png" }));
    const manager = { getCdpSession: () => ({ cdp: {}, intercept: { screenshot } }), call: vi.fn() };
    const handlers = createScrapingHandlers({ scrapingSessionManager: manager, getCurrentWorkspacePath: () => root });
    const shot = await handlers.scrapingScreenshot({ session_id: "approved-existing", full_page: false });
    expect(shot.data).toBeUndefined(); expect(fs.existsSync(shot.path)).toBe(true);
    expect(manager.call).not.toHaveBeenCalled();
  });
  it("reports missing screenshot capability without launching or making worker requests", async () => {
    const manager = { getCdpSession: () => { throw new Error("Network capture is unavailable"); }, call: vi.fn(), start: vi.fn() };
    const handlers = createScrapingHandlers({ scrapingSessionManager: manager });
    expect(await handlers.scrapingScreenshot({ session_id: "no-cdp" })).toMatchObject({ ok: false, code: "capability_unavailable" });
    expect(manager.call).not.toHaveBeenCalled(); expect(manager.start).not.toHaveBeenCalled();
  });
  it("does not advertise an already-closed UC session as a working fallback", async () => {
    const handlers = createScrapingHandlers({ scrapingSessionManager: { getSession: () => ({ worker: { closed: true } }), getCdpSession: () => ({ intercept: { screenshot: vi.fn() } }) } });
    expect(await handlers.scrapingCapabilities({ session_id: "closed" })).toMatchObject({ ok: false, code: "capability_unavailable" });
  });
});
