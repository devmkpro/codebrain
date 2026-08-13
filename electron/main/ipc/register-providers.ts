import { ipcMain } from "electron";
import type { AppContext } from "../context";
import { safeSend } from "../context";
import { getEnhancedProviders, listModelsFromEndpoint, listClaudeOAuthModels, healthCheckProvider, syncProviderModels } from "../services/providers";
import { BUILTIN_TEMPLATES } from "../services/constants";
import { syncClaudeSettingsVersion } from "../services/setup-claude";

// Cache for OpenRouter models (5 min TTL)
let openRouterCache: { data: any[]; ts: number } | null = null;
const OR_CACHE_TTL = 5 * 60 * 1000;

/**
 * Electron's main-process hot reload can execute a registration module more
 * than once. Replace an older handler so a newly added endpoint (such as
 * syncModels) is not skipped after a duplicate `providers:list` exception.
 */
function replaceHandler(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, listener);
}

export function registerProviderHandlers(ctx: AppContext): void {
  // ── One-time migration: 9Router switched from openai-compat to anthropic-compat ──
  // 9Router serves the Anthropic protocol at /v1/messages (like MIMO), so saved
  // entries from the openai-compat era need type/host/env keys rewritten.
  try {
    for (const p of ctx.providerStore.listFull()) {
      const is9Router = /9router/i.test(p.id ?? "") || /9router/i.test(p.label ?? "");
      if (!is9Router) continue;
      const env = { ...(p.env ?? {}) };
      const needsMigration = (p.type as string) !== "anthropic-compat" || p.host !== "claude" || !!env["OPENAI_API_KEY"] || !!env["OPENAI_BASE_URL"];
      if (!needsMigration) continue;
      const key = env["ANTHROPIC_AUTH_TOKEN"] || env["OPENAI_API_KEY"] || "";
      // Claude CLI appends /v1 itself — strip a trailing /v1 from the saved base URL
      const baseUrl = (env["ANTHROPIC_BASE_URL"] || env["OPENAI_BASE_URL"] || "http://localhost:20128").replace(/\/v1\/?$/, "");
      delete env["OPENAI_API_KEY"];
      delete env["OPENAI_BASE_URL"];
      if (key) env["ANTHROPIC_AUTH_TOKEN"] = key;
      env["ANTHROPIC_BASE_URL"] = baseUrl;
      ctx.providerStore.upsert({ ...p, type: "anthropic-compat" as any, host: "claude", env });
      console.log(`[providers] Migrated 9Router provider "${p.id}" to anthropic-compat (baseUrl=${baseUrl})`);
    }
  } catch (err) {
    console.warn("[providers] 9Router migration failed:", err);
  }

  replaceHandler("providers:list", () => getEnhancedProviders(ctx));
  replaceHandler("providers:save", (_event, provider) => {
    const result = ctx.providerStore.upsert(provider);
    if (result.ok) void syncProviderModels(ctx, { providerIds: [provider.id] });
    return result;
  });
  replaceHandler("providers:delete", (_event, id: string) => ctx.providerStore.remove(id));
  replaceHandler("providers:templates", () => BUILTIN_TEMPLATES);
  replaceHandler("providers:testToken", async (_event, _args: { providerId: string; token: string }) => {
    return { ok: true };
  });

  replaceHandler("providers:listModels", async (_event, args: { baseUrl: string; apiKey: string; type: string }) => {
    return listModelsFromEndpoint(args);
  });

  // Detect models available on Claude OAuth plan (reads token from ~/.claude/.credentials.json)
  replaceHandler("providers:listClaudeOAuthModels", () => listClaudeOAuthModels());
  replaceHandler("providers:syncModels", (_event, args?: { providerIds?: string[]; force?: boolean }) => syncProviderModels(ctx, args));

  replaceHandler("providers:healthCheck", async (_event, args: { baseUrl: string; apiKey: string; type: string; model?: string }) => {
    return healthCheckProvider(args);
  });

  // Fetch OpenRouter public model catalog (no API key needed)
  replaceHandler("providers:listOpenRouterModels", async () => {
    if (openRouterCache && Date.now() - openRouterCache.ts < OR_CACHE_TTL) {
      return { ok: true, models: openRouterCache.data };
    }
    try {
      const resp = await fetch("https://openrouter.ai/api/v1/models?supported_parameters=tools", {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
      const json = await resp.json() as any;
      const models = (json.data ?? []).map((m: any) => ({
        id: m.id,
        name: m.name ?? m.id,
        context_length: m.context_length ?? 0,
        pricing: m.pricing ? {
          prompt: parseFloat(m.pricing.prompt ?? "0"),
          completion: parseFloat(m.pricing.completion ?? "0"),
        } : undefined,
      }));
      openRouterCache = { data: models, ts: Date.now() };
      return { ok: true, models };
    } catch (err: any) {
      return { ok: false, error: err.message ?? String(err) };
    }
  });

  ctx.providerStore.onChange(() => {
    safeSend(ctx, "providers:updated", getEnhancedProviders(ctx));
    syncClaudeSettingsVersion();
  });
}
