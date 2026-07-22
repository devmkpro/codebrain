import { ipcMain } from "electron";
import type { AppContext } from "../context";
import { safeSend } from "../context";
import { getEnhancedProviders, listModelsFromEndpoint, healthCheckProvider } from "../services/providers";
import { BUILTIN_TEMPLATES } from "../services/constants";
import { syncClaudeSettingsVersion } from "../services/setup-claude";

// Cache for OpenRouter models (5 min TTL)
let openRouterCache: { data: any[]; ts: number } | null = null;
const OR_CACHE_TTL = 5 * 60 * 1000;

export function registerProviderHandlers(ctx: AppContext): void {
  ipcMain.handle("providers:list", () => getEnhancedProviders(ctx));
  ipcMain.handle("providers:save", (_event, provider) => ctx.providerStore.upsert(provider));
  ipcMain.handle("providers:delete", (_event, id: string) => ctx.providerStore.remove(id));
  ipcMain.handle("providers:templates", () => BUILTIN_TEMPLATES);
  ipcMain.handle("providers:testToken", async (_event, _args: { providerId: string; token: string }) => {
    return { ok: true };
  });

  ipcMain.handle("providers:listModels", async (_event, args: { baseUrl: string; apiKey: string; type: string }) => {
    return listModelsFromEndpoint(args);
  });

  ipcMain.handle("providers:healthCheck", async (_event, args: { baseUrl: string; apiKey: string; type: string; model?: string }) => {
    return healthCheckProvider(args);
  });

  // Fetch OpenRouter public model catalog (no API key needed)
  ipcMain.handle("providers:listOpenRouterModels", async () => {
    if (openRouterCache && Date.now() - openRouterCache.ts < OR_CACHE_TTL) {
      return { ok: true, models: openRouterCache.data };
    }
    try {
      const resp = await fetch("https://openrouter.ai/api/v1/models", {
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
