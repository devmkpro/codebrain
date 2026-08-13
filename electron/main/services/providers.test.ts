import { afterEach, describe, expect, it, vi } from "vitest";
import { listModelsFromEndpoint, syncProviderModels } from "./providers";

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 503,
    statusText: ok ? "OK" : "Unavailable",
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider model discovery", () => {
  it("loads only tool-capable OpenRouter model IDs from the public catalog", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      data: [
        { id: "openai/gpt-5.6-sol" },
        { id: "anthropic/claude-sonnet-5" },
        { id: "openai/text-embedding-3-small" },
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await listModelsFromEndpoint({
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "",
      type: "openai-compat",
    });

    expect(result).toEqual({ ok: true, models: ["openai/gpt-5.6-sol", "anthropic/claude-sonnet-5"] });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models?supported_parameters=tools",
      expect.objectContaining({ headers: expect.not.objectContaining({ Authorization: expect.anything() }) }),
    );
  });

  it("normalizes Gemini resource names", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      models: [{ name: "models/gemini-3.5-flash" }, { name: "models/text-embedding-004" }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await listModelsFromEndpoint({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "secret",
      type: "gemini-compat",
    });

    expect(result.models).toEqual(["gemini-3.5-flash"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=secret",
      expect.any(Object),
    );
  });

  it("persists a successful startup sync", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ data: [{ id: "gpt-5.6-sol" }] })));
    const provider = {
      id: "openai-user",
      type: "openai-compat",
      models: ["gpt-old"],
      env: { OPENAI_BASE_URL: "https://api.openai.com/v1", OPENAI_API_KEY: "secret" },
    };
    const upsert = vi.fn(() => ({ ok: true }));
    const ctx = {
      providerStore: { listFull: () => [provider], upsert },
      cliDetector: { getAll: () => ({ codex: { found: false }, gemini: { found: false } }) },
    } as any;

    const summary = await syncProviderModels(ctx);

    expect(summary.updated).toEqual([{ providerId: "openai-user", count: 1, source: "endpoint" }]);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ models: ["gpt-5.6-sol"], modelsSyncSource: "endpoint" }));
  });

  it("preserves the previous catalog when discovery fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, false)));
    const provider = {
      id: "custom",
      type: "openai-compat",
      models: ["working-model"],
      env: { OPENAI_BASE_URL: "https://example.com/v1", OPENAI_API_KEY: "secret" },
    };
    const upsert = vi.fn();
    const ctx = {
      providerStore: { listFull: () => [provider], upsert },
      cliDetector: { getAll: () => ({ codex: { found: false }, gemini: { found: false } }) },
    } as any;

    const summary = await syncProviderModels(ctx);

    expect(summary.failed[0].providerId).toBe("custom");
    expect(upsert).not.toHaveBeenCalled();
  });
});
