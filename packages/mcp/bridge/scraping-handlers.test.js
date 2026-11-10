// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createScrapingHandlers,
  normalizeStartArgs,
  pythonCandidates,
  resolveWorkerPath,
} = require("./scraping-handlers.js");

describe("scraping session contract", () => {
  it("normalizes browser limits before crossing the process boundary", () => {
    expect(
      normalizeStartArgs({
        headless: true,
        window_width: 20,
        window_height: 20_000,
        page_load_timeout_ms: 1,
        version_main: 131,
      })
    ).toMatchObject({
      headless: true,
      window_width: 320,
      window_height: 4320,
      page_load_timeout_ms: 5000,
      version_main: 131,
    });
  });

  it("accepts 320/390 CSS viewport widths and applies the requested headless viewport through CDP", async () => {
    expect(normalizeStartArgs({ window_width: 390, window_height: 320 })).toMatchObject({ window_width: 390, window_height: 320 });
    const resizeWindow = vi.fn(async ({ width, height }) => ({ ok: true, width, height }));
    const manager = { start: vi.fn(async () => ({ ok: true, session_id: "fixture" })), getCdpSession: () => ({ intercept: { resizeWindow } }) };
    const result = await createScrapingHandlers({ scrapingSessionManager: manager }).scrapingSessionStart({ headless: true, window_width: 1440, window_height: 900 });
    expect(resizeWindow).toHaveBeenCalledWith({ width: 1440, height: 900 });
    expect(result).toMatchObject({ viewport_applied: true, viewport: { width: 1440, height: 900 } });
  });

  it("does not claim a headless viewport was applied when CDP sizing is unavailable", async () => {
    const manager = { start: vi.fn(async () => ({ ok: true, session_id: "fixture" })), getCdpSession: () => { throw new Error("CDP unavailable"); } };
    const result = await createScrapingHandlers({ scrapingSessionManager: manager }).scrapingSessionStart({ window_width: 390, window_height: 844 });
    expect(result).toMatchObject({ ok: true, viewport_applied: false, viewport_error: "CDP unavailable" });
  });

  it("resolves the packaged worker from the repository", () => {
    const worker = resolveWorkerPath();
    expect(path.basename(worker)).toBe("uc_worker.py");
    expect(worker.replace(/\\/g, "/")).toContain("resources/scraping/uc_worker.py");
  });

  it("honors an explicit Python executable", () => {
    expect(pythonCandidates("C:/Python/python.exe")).toEqual([
      { command: "C:/Python/python.exe", args: [] },
    ]);
  });

  it("routes MCP handlers to the worker command and strips session_id", async () => {
    const manager = {
      start: vi.fn(async () => ({ ok: true, session_id: "s" })),
      stop: vi.fn(async () => ({ ok: true })),
      list: vi.fn(() => []),
      call: vi.fn(async (_sessionId, command, payload) => ({ command, payload })),
    };
    const handlers = createScrapingHandlers({ scrapingSessionManager: manager });

    const result = await handlers.scrapingNavigate({
      session_id: "session-1",
      url: "https://example.test",
      timeout_ms: 12345,
    });

    expect(result).toEqual({
      command: "navigate",
      payload: { url: "https://example.test", timeout_ms: 12345 },
    });
    expect(manager.call).toHaveBeenCalledWith(
      "session-1",
      "navigate",
      { url: "https://example.test", timeout_ms: 12345 },
      32345
    );
  });

  it("bounds aggregate batch output before invoking Python", async () => {
    const manager = {
      start: vi.fn(),
      stop: vi.fn(),
      list: vi.fn(() => []),
      call: vi.fn(async (_sessionId, _command, payload) => payload),
    };
    const handlers = createScrapingHandlers({ scrapingSessionManager: manager });
    const urls = Array.from({ length: 100 }, (_, index) => `https://example.test/${index}`);
    const result = await handlers.scrapingFetchBatch({
      session_id: "session-1",
      urls,
      max_chars_per_item: 250_000,
      concurrency: 10,
      timeout_ms: 1000,
      retries: 0,
    });

    expect(result.max_chars_per_item).toBe(15_000);
  });
});
