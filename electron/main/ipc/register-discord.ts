import { ipcMain } from "electron";
import type { AppContext } from "../context";
import {
  isDiscordConnected,
  updatePresence,
  restartDiscordRPC,
  getDefaultApplicationId,
} from "../discord-rpc";

export function registerDiscordHandlers(ctx: AppContext): void {
  ipcMain.handle("discord:updatePresence", (_event, args: {
    details: string;
    state?: string;
  }) => {
    try {
      updatePresence(args.details, args.state);
      return { ok: true, connected: isDiscordConnected() };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("discord:status", () => {
    const config = ctx.configStore.get();
    return {
      connected: isDiscordConnected(),
      clientId: (config.discordClientId as string) || getDefaultApplicationId(),
    };
  });

  ipcMain.handle("discord:setClientId", (_event, clientId: string) => {
    try {
      ctx.configStore.set({ discordClientId: clientId });
      restartDiscordRPC(clientId);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });
}
