import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getEnhancedProviders,
  listModelsFromEndpoint,
  mergeModelCatalogs,
  syncProviderModels,
} from "./providers";
import { CLI_REGISTRY } from "./spawn/cli-registry";

const { run } = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("./cli-model-catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cli-model-catalog")>();
  return {
    ...actual,
    createCliModelCatalog: () => actual.createCliModelCatalog({ run, cacheFile: null }),
  };
});
beforeEach(() => {
  run.mockReset();
  run.mockImplementation(async (_binary, args) =>
    args.includes("--help")
      ? "  models  Render models"
      : JSON.stringify({ models: [{ slug: "gpt-6.1-sol" }, { slug: "gpt-6-astra" }] })
  );
});

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
  it("limits simultaneous automatic catalog requests to two", async () => {
    let concurrent = 0;
    let peak = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      peak = Math.max(peak, ++concurrent);
      await new Promise(resolve => setTimeout(resolve, 5));
      --concurrent;
      return jsonResponse({ data: [{ id: "qa-1" }] });
    }));
    const providers = Array.from({ length: 5 }, (_, index) => ({ id: `qa-${index}`, host: "openclaude", type: "openai-compat", baseUrl: "https://qa.invalid/v1", env: { OPENAI_API_KEY: "qa-not-real" }, models: ["qa-0"] }));
    await syncProviderModels({ cliDetector: { getAll: () => ({}) }, providerStore: { listFull: () => providers, upsert: () => ({ ok: true }) } } as any);
    expect(peak).toBe(2);
  });

  it("awaits the shared asynchronous inventory before reading detected providers", async () => {
    let finish!: () => void;
    const ready = new Promise<void>((resolve) => { finish = resolve; });
    const getAll = vi.fn(() => ({}));
    const ctx = {
      cliDetector: { getAllAsync: () => ready, getAll },
      providerStore: { listFull: () => [] },
    } as any;
    const job = syncProviderModels(ctx);
    expect(getAll).not.toHaveBeenCalled();
    finish();
    await job;
    expect(getAll).toHaveBeenCalled();
  });

  it("prefers discovered Codex catalog without reinserting static releases", () => {
    const ctx = {
      providerStore: {
        listFull: () => [
          {
            id: "codex-oauth",
            label: "Meu Codex",
            type: "codex",
            host: "codex",
            models: ["gpt-6.1-sol", "my-custom-model"],
          },
        ],
      },
      cliDetector: { getAll: () => ({ codex: { found: true } }) },
    } as any;

    const codex = getEnhancedProviders(ctx).find((provider) => provider.id === "codex-oauth");

    expect(codex?.label).toBe("Meu Codex");
    expect(codex?.models).toEqual(["gpt-6.1-sol", "my-custom-model"]);
    expect((codex as any)?.isVirtual).toBe(true);
  });

  it("respects an explicit manual catalog for a native provider", () => {
    const ctx = {
      providerStore: {
        listFull: () => [
          {
            id: "codex-oauth",
            label: "Codex enxuto",
            type: "codex",
            host: "codex",
            models: ["gpt-5.6-terra"],
            modelsMode: "manual",
          },
        ],
      },
      cliDetector: { getAll: () => ({ codex: { found: true } }) },
    } as any;

    const codex = getEnhancedProviders(ctx).find((provider) => provider.id === "codex-oauth");

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
      cliDetector: {
        getAll: () => ({ codex: { found: true, path: "codex.exe" }, gemini: { found: false } }),
      },
    } as any;

    await syncProviderModels(ctx, { providerIds: ["codex-oauth"], force: true, resetManual: true });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        modelsMode: "auto",
        models: ["gpt-6.1-sol", "gpt-6-astra"],
      })
    );
  });

  it("deduplicates detected and user model catalogs without changing priority", () => {
    expect(mergeModelCatalogs(["gpt-new", "gpt-old"], ["gpt-old", "custom"])).toEqual([
      "gpt-new",
      "gpt-old",
      "custom",
    ]);
  });

  it("loads only tool-capable OpenRouter model IDs from the public catalog", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [
          { id: "openai/gpt-5.6-sol" },
          { id: "anthropic/claude-sonnet-5" },
          { id: "openai/text-embedding-3-small" },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await listModelsFromEndpoint({
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "",
      type: "openai-compat",
    });

    expect(result).toEqual({
      ok: true,
      models: ["openai/gpt-5.6-sol", "anthropic/claude-sonnet-5"],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models?supported_parameters=tools",
      expect.objectContaining({
        headers: expect.not.objectContaining({ Authorization: expect.anything() }),
      })
    );
  });

  it("normalizes Gemini resource names", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        models: [{ name: "models/gemini-3.5-flash" }, { name: "models/text-embedding-004" }],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await listModelsFromEndpoint({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "secret",
      type: "gemini-compat",
    });

    expect(result.models).toEqual(["gemini-3.5-flash"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
      expect.objectContaining({ headers: expect.objectContaining({ "x-goog-api-key": "secret" }) })
    );
  });

  it("persists a successful startup sync", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ data: [{ id: "gpt-5.6-sol" }] }))
    );
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
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ models: ["gpt-5.6-sol"], modelsSyncSource: "endpoint" })
    );
  });

  it("preserves the previous catalog when discovery fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, false))
    );
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
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ models: ["working-model"], modelsStale: true })
    );
  });

  it("force refresh preserves manual list contents unless resetManual is explicit", async () => {
    const provider = {
      id: "codex-oauth",
      models: ["custom-pinned", "gpt-5.9"],
      modelsMode: "manual",
    };
    const upsert = vi.fn();
    const ctx = {
      providerStore: { listFull: () => [provider], upsert },
      cliDetector: { getAll: () => ({ codex: { found: true, path: "codex.exe" } }) },
    } as any;
    const result = await syncProviderModels(ctx, { force: true });
    expect(result.skipped).toEqual([
      { providerId: provider.id, reason: "lista manual preservada" },
    ]);
    expect(upsert).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("every installed harness uses descending numeric release order in the provider selector", () => {
    const entries = CLI_REGISTRY.filter(
      (entry) => entry.id !== "openclaude" && entry.capabilities.model
    );
    const nativeIds: Record<string, string> = {
      claude: "claude-oauth",
      codex: "codex-oauth",
      gemini: "gemini-cli",
      kimi: "kimi",
      cursor: "cursor",
      copilot: "copilot",
    };
    const saved = entries.map((entry) => ({
      id: nativeIds[entry.id] ?? `${entry.id}-cli`,
      host: entry.id,
      models: ["m-5.9", "auto", "m-5.10"],
    }));
    const ctx = {
      providerStore: { listFull: () => saved },
      cliDetector: {
        getAll: () => Object.fromEntries(entries.map((entry) => [entry.id, { found: true }])),
      },
    } as any;
    const all = getEnhancedProviders(ctx);
    for (const entry of saved)
      expect(all.find((provider) => provider.id === entry.id)?.models).toEqual([
        "m-5.10",
        "m-5.9",
        "auto",
      ]);
  });

  it("endpoint source timestamps determine order instead of recommendation order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          data: [
            { id: "old-default", created: 1700000000 },
            { id: "new-release", created_at: "2026-11-09" },
          ],
        })
      )
    );
    const result = await listModelsFromEndpoint({
      baseUrl: "https://example.test/v1",
      apiKey: "",
      type: "openai-compat",
    });
    expect(result.models).toEqual(["new-release", "old-default"]);
  });
});
