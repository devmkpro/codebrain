import { afterEach, describe, expect, it, vi } from "vitest";
import { getEnhancedProviders, listModelsFromEndpoint, mergeModelCatalogs, syncProviderModels } from "./providers";

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
  it("keeps canonical Codex releases visible when the saved CLI cache is stale", () => {
    const ctx = {
      providerStore: {
        listFull: () => [{
          id: "codex-oauth",
          label: "Meu Codex",
          type: "codex",
          host: "codex",
          models: ["gpt-5.4", "my-custom-model"],
        }],
      },
      cliDetector: { getAll: () => ({ codex: { found: true } }) },
    } as any;

    const codex = getEnhancedProviders(ctx).find(provider => provider.id === "codex-oauth");

    expect(codex?.label).toBe("Meu Codex");
    expect(codex?.models).toEqual(expect.arrayContaining([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "my-custom-model",
    ]));
    expect((codex as any)?.isVirtual).toBe(true);
  });

  it("respects an explicit manual catalog for a native provider", () => {
    const ctx = {
      providerStore: {
        listFull: () => [{
          id: "codex-oauth",
          label: "Codex enxuto",
          type: "codex",
          host: "codex",
          models: ["gpt-5.6-terra"],
          modelsMode: "manual",
        }],
      },
      cliDetector: { getAll: () => ({ codex: { found: true } }) },
    } as any;

    const codex = getEnhancedProviders(ctx).find(provider => provider.id === "codex-oauth");

    expect(codex?.models).toEqual(["gpt-5.6-terra"]);
    expect((codex as any)?.modelsMode).toBe("manual");
  });

  it("can explicitly return a native provider to automatic catalog updates", async () => {
    const provider = {
      id: "codex-oauth",
      type: "codex",
      host: "codex",
      models: ["gpt-5.6-terra"],
      modelsMode: "manual",
    };
    const upsert = vi.fn(() => ({ ok: true }));
    const ctx = {
      providerStore: { listFull: () => [provider], upsert },
      cliDetector: { getAll: () => ({ codex: { found: true }, gemini: { found: false } }) },
    } as any;

    await syncProviderModels(ctx, { providerIds: ["codex-oauth"], force: true });

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      modelsMode: "auto",
      models: expect.arrayContaining(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]),
    }));
  });

  it("deduplicates detected and user model catalogs without changing priority", () => {
    expect(mergeModelCatalogs(["gpt-new", "gpt-old"], ["gpt-old", "custom"])).toEqual([
      "gpt-new",
      "gpt-old",
      "custom",
    ]);
  });

  it("loads only tool-capable OpenRouter model IDs from the public catalog", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      data: [
        { id: "openai/gpt-5.6-sol", context_length: 1000000 },
        { id: "anthropic/claude-sonnet-5", context_length: 200000 },
        { id: "openai/text-embedding-3-small" },
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await listModelsFromEndpoint({
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "",
      type: "openai-compat",
    });

    expect(result).toEqual({
      ok: true,
      models: ["openai/gpt-5.6-sol", "anthropic/claude-sonnet-5"],
      modelContextWindows: {
        "openai/gpt-5.6-sol": 1000000,
        "anthropic/claude-sonnet-5": 200000,
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models?supported_parameters=tools",
      expect.objectContaining({ headers: expect.not.objectContaining({ Authorization: expect.anything() }) }),
    );
  });

  it("normalizes Gemini resource names", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      models: [{ name: "models/gemini-3.5-flash", inputTokenLimit: 1000000 }, { name: "models/text-embedding-004" }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await listModelsFromEndpoint({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "secret",
      type: "gemini-compat",
    });

    expect(result.models).toEqual(["gemini-3.5-flash"]);
    expect(result.modelContextWindows).toEqual({ "gemini-3.5-flash": 1000000 });
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
