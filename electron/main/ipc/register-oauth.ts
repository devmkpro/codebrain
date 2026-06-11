import { ipcMain } from "electron";
import type { AppContext } from "../context";
import {
  getOAuthStatus,
  connectGitLab,
  connectGitHub,
  disconnectOAuth,
} from "../services/oauth";

/**
 * IPC handlers for OAuth review bot connections.
 * Channels: oauth:status, oauth:connect, oauth:disconnect
 */
export function registerOAuthHandlers(ctx: AppContext): void {
  // oauth:status — returns connection status for both providers
  ipcMain.handle("oauth:status", async () => {
    try {
      const status = getOAuthStatus(ctx);
      return { ok: true, data: status };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  // oauth:connect — initiate OAuth flow for a provider
  ipcMain.handle("oauth:connect", async (_event, args: { provider: "github" | "gitlab"; clientId?: string; clientSecret?: string }) => {
    try {
      const { provider, clientId, clientSecret } = args;

      if (provider === "gitlab") {
        if (!clientId || !clientSecret) {
          return { ok: false, error: "GitLab requer Client ID e Client Secret. Configure nas Settings primeiro." };
        }
        const result = await connectGitLab(ctx, { clientId, clientSecret });
        return result;
      }

      if (provider === "github") {
        if (!clientId) {
          return { ok: false, error: "GitHub requer Client ID. Configure nas Settings primeiro." };
        }
        const result = await connectGitHub(ctx, { clientId });
        return result;
      }

      return { ok: false, error: `Provider desconhecido: ${provider}` };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  // oauth:disconnect — remove saved token
  ipcMain.handle("oauth:disconnect", async (_event, args: { provider: "github" | "gitlab" }) => {
    try {
      disconnectOAuth(ctx, args.provider);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });
}
