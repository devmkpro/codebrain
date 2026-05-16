import { ipcMain } from "electron";
import type { AppContext } from "../context";
import { safeSend } from "../context";
import { getEnhancedProviders } from "../services/providers";
import { BUILTIN_TEMPLATES } from "../services/constants";

export function registerProviderHandlers(ctx: AppContext): void {
  ipcMain.handle("providers:list", () => getEnhancedProviders(ctx));
  ipcMain.handle("providers:save", (_event, provider) => ctx.providerStore.upsert(provider));
  ipcMain.handle("providers:delete", (_event, id: string) => ctx.providerStore.remove(id));
  ipcMain.handle("providers:templates", () => BUILTIN_TEMPLATES);
  ipcMain.handle("providers:testToken", async (_event, _args: { providerId: string; token: string }) => {
    return { ok: true };
  });

  ctx.providerStore.onChange(() => {
    safeSend(ctx, "providers:updated", getEnhancedProviders(ctx));
  });
}
