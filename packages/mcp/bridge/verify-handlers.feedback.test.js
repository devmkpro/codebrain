// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks(); });
function setup(plan = { routes: [{ route: "/chat", confidence: "explicit" }], markers: ["My chat"] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-verify-feedback-")); roots.push(root);
  const project = require("./verify-project.js");
  vi.spyOn(project, "detectServers").mockResolvedValue({ live: [{ baseUrl: "http://127.0.0.1:8081" }] });
  delete require.cache[require.resolve("./verify-handlers.js")];
  const { createVerifyHandlers } = require("./verify-handlers.js");
  const memoryStore = { verifyRunCreate: vi.fn(() => ({ run_id: "fixture-run" })), verifyRunGet: vi.fn(() => ({ data: { plan, base_url: "http://127.0.0.1:8081" } })), verifyRunFinish: vi.fn(), verifyGrantInternal: vi.fn() };
  const browserHandlers = { browserNavigate: vi.fn(async () => ({ ok: false, error: "Chrome CDP not available" })) };
  const scrapingHandlers = { scrapingCapabilities: vi.fn(async () => ({ ok: true, capabilities: { navigate: true, evaluate: true, screenshot: true } })), scrapingNavigate: vi.fn(async () => ({ ok: true })), scrapingEvaluate: vi.fn(async () => ({ value: "My chat" })), scrapingScreenshot: vi.fn(async () => { const file = path.join(root, "shot.png"); fs.writeFileSync(file, "fixture"); return { ok: true, path: file }; }), scrapingSessionStart: vi.fn() };
  return { root, memoryStore, browserHandlers, scrapingHandlers, handlers: createVerifyHandlers({ getCurrentWorkspacePath: () => root, memoryStore, browserHandlers, scrapingHandlers }) };
}
describe("verify scoped plan and authorized UC fallback", () => {
  it("accepts worker files and explicit route without scanning the branch", async () => {
    const { handlers, root } = setup(); fs.mkdirSync(path.join(root, "src")); fs.writeFileSync(path.join(root, "src/Chat.tsx"), "<h1>My chat</h1>");
    const result = await handlers.verifyPlan({ files: ["src/Chat.tsx"], routes: ["/chat"] });
    expect(result.ok).toBe(true); expect(result.files.map((file) => file.file)).toEqual(["src/Chat.tsx"]);
    expect(result.routes).toMatchObject([{ route: "/chat", confidence: "explicit" }]);
  });
  it("requires an explicit route instead of silently verifying SPA '/'", async () => {
    const { handlers, root } = setup(); fs.mkdirSync(path.join(root, "src")); fs.writeFileSync(path.join(root, "src/Chat.tsx"), "<h1>My chat</h1>");
    const result = await handlers.verifyPlan({ files: ["src/Chat.tsx"] });
    expect(result.verdict).toBe("route-required"); expect(result.routes).toEqual([]);
  });
  it("does not launch UC or attempt login when fallback was not authorized", async () => {
    const { handlers, scrapingHandlers, memoryStore } = setup();
    expect((await handlers.verifyRun({ run_id: "fixture", settle_ms: 0 })).verdict).toBe("unreachable");
    expect(scrapingHandlers.scrapingNavigate).not.toHaveBeenCalled(); expect(scrapingHandlers.scrapingSessionStart).not.toHaveBeenCalled(); expect(memoryStore.verifyGrantInternal).not.toHaveBeenCalled();
  });
  it("uses only an explicitly selected UC session with confirmed screenshot capability", async () => {
    const { handlers, scrapingHandlers } = setup();
    const result = await handlers.verifyRun({ run_id: "fixture", settle_ms: 0, allow_uc_fallback: true, scraping_session_id: "approved-existing" });
    expect(result.results[0]).toMatchObject({ driver: "uc", verdict: "passed" });
    expect(scrapingHandlers.scrapingNavigate).toHaveBeenCalledWith(expect.objectContaining({ session_id: "approved-existing", url: "http://127.0.0.1:8081/chat" }));
    expect(scrapingHandlers.scrapingSessionStart).not.toHaveBeenCalled();
  });
  it("refuses UC fallback if screenshot capability is absent", async () => {
    const { handlers, scrapingHandlers } = setup(); scrapingHandlers.scrapingCapabilities.mockResolvedValue({ ok: true, capabilities: { navigate: true, evaluate: true, screenshot: false } });
    const result = await handlers.verifyRun({ run_id: "fixture", settle_ms: 0, allow_uc_fallback: true, scraping_session_id: "no-screenshot" });
    expect(result.verdict).toBe("unreachable"); expect(scrapingHandlers.scrapingNavigate).not.toHaveBeenCalled();
  });
  it("rejects files outside the workspace and external route overrides", async () => {
    const { handlers } = setup();
    expect((await handlers.verifyPlan({ files: ["../private.tsx"], routes: ["/chat"] })).ok).toBe(false);
    expect((await handlers.verifyPlan({ files: [], routes: ["//other.test/login"] })).ok).toBe(false);
  });
  it("does not navigate an external route hidden in an old stored plan", async () => {
    const { handlers, browserHandlers } = setup({ routes: [{ route: "https://other.test/login", confidence: "explicit" }], markers: [] });
    expect((await handlers.verifyRun({ run_id: "fixture", settle_ms: 0 })).ok).toBe(false);
    expect(browserHandlers.browserNavigate).not.toHaveBeenCalled();
  });
  it("never falls back for an ordinary application/navigation error", async () => {
    const { handlers, browserHandlers, scrapingHandlers } = setup();
    browserHandlers.browserNavigate.mockResolvedValue({ ok: false, error: "HTTP 403 Forbidden" });
    await handlers.verifyRun({ run_id: "fixture", settle_ms: 0, allow_uc_fallback: true, scraping_session_id: "existing" });
    expect(scrapingHandlers.scrapingNavigate).not.toHaveBeenCalled();
  });
  it("reports a login screen without invoking login or manufacturing a grant", async () => {
    const { handlers, scrapingHandlers, memoryStore } = setup();
    scrapingHandlers.scrapingEvaluate.mockResolvedValue({ value: "Login password" });
    const result = await handlers.verifyRun({ run_id: "fixture", settle_ms: 0, allow_uc_fallback: true, scraping_session_id: "existing" });
    expect(result.verdict).toBe("auth-required"); expect(memoryStore.verifyGrantInternal).not.toHaveBeenCalled();
    expect(scrapingHandlers.scrapingSessionStart).not.toHaveBeenCalled();
  });
  it("does not pass without a screenshot, even when the expected marker is visible", async () => {
    const { handlers, scrapingHandlers } = setup();
    scrapingHandlers.scrapingScreenshot.mockResolvedValue({ ok: false, error: "capture unavailable" });
    const result = await handlers.verifyRun({ run_id: "fixture", settle_ms: 0, allow_uc_fallback: true, scraping_session_id: "existing" });
    expect(result.verdict).toBe("inconclusive"); expect(result.results[0].console_errors).toBeNull();
  });
  it("recognizes a redirect to /auth for manually specified routes without requiring English password text", async () => {
    const { handlers, browserHandlers, memoryStore, root } = setup();
    const file = path.join(root, "auth.png"); fs.writeFileSync(file, "fixture");
    Object.assign(browserHandlers, {
      browserNavigate: vi.fn(async () => ({ ok: true, url: "http://127.0.0.1:8081/auth" })),
      browserGetUrl: vi.fn(async () => ({ ok: true, url: "http://127.0.0.1:8081/auth" })),
      browserWaitForLoad: vi.fn(async () => ({})), browserScreenshot: vi.fn(async () => ({ path: file })),
      browserGetText: vi.fn(async () => ({ text: "Entre na sua conta" })),
      browserConsoleLog: vi.fn(async () => ({ entries: [] })),
    });
    const result = await handlers.verifyRun({ run_id: "fixture", routes: ["/perfil"], settle_ms: 0 });
    expect(result.verdict).toBe("auth-required"); expect(result.results[0].final_url).toBe("http://127.0.0.1:8081/auth");
    expect(browserHandlers.browserConsoleLog).toHaveBeenCalledWith("error", expect.any(Number), 20, undefined);
    expect(memoryStore.verifyGrantInternal).not.toHaveBeenCalled();
  });
});
