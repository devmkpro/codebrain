import { ipcMain } from "electron";
import type { AppContext } from "../context";
import { safeSend } from "../context";
import { getEnhancedProviders, listModelsFromEndpoint, healthCheckProvider } from "../services/providers";
import { BUILTIN_TEMPLATES } from "../services/constants";
import { syncClaudeSettingsVersion } from "../services/setup-claude";

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

  ctx.providerStore.onChange(() => {
    safeSend(ctx, "providers:updated", getEnhancedProviders(ctx));
    syncClaudeSettingsVersion();
  });
}
