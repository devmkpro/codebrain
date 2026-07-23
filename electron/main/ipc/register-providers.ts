import { ipcMain } from "electron";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { AppContext } from "../context";
import { safeSend } from "../context";
import { getEnhancedProviders, listModelsFromEndpoint, healthCheckProvider } from "../services/providers";
import { BUILTIN_TEMPLATES } from "../services/constants";
import { syncClaudeSettingsVersion } from "../services/setup-claude";

// Cache for OpenRouter models (5 min TTL)
let openRouterCache: { data: any[]; ts: number } | null = null;
const OR_CACHE_TTL = 5 * 60 * 1000;

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

  // Detect models available on Claude OAuth plan (reads token from ~/.claude/.credentials.json)
  ipcMain.handle("providers:listClaudeOAuthModels", async () => {
    try {
      const credPath = path.join(os.homedir(), ".claude", ".credentials.json");
      if (!fs.existsSync(credPath)) return { ok: false, error: "Credenciais OAuth não encontradas. Faça login com 'claude auth login'." };
      const creds = JSON.parse(fs.readFileSync(credPath, "utf-8"));
      const accessToken = creds?.claudeAiOauth?.accessToken;
      if (!accessToken) return { ok: false, error: "accessToken não encontrado nas credenciais." };

      const resp = await fetch("https://api.anthropic.com/v1/models", {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "oauth-2025-04-20",
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}: ${resp.statusText}` };
      const json = await resp.json() as any;
      const rawModels: Array<{ id?: string }> = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
      const models = rawModels.map(m => m.id ?? "").filter(Boolean);
      return { ok: true, models };
    } catch (err: any) {
      return { ok: false, error: err.message ?? String(err) };
    }
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
