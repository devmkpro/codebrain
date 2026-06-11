import { ipcMain } from "electron";
import type { AppContext } from "../context";

export function registerNotificationHandlers(ctx: AppContext): void {
  ipcMain.handle("notifications:list", async (_event, opts?: { limit?: number }) => {
    try {
      if (!ctx.memoryStore) return { ok: false, error: "memory store not available" };
      return ctx.memoryStore.listNotifications(opts || {});
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("notifications:count", async () => {
    try {
      if (!ctx.memoryStore) return { ok: false, error: "memory store not available" };
      return ctx.memoryStore.unreadNotificationCount();
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("notifications:mark-read", async (_event, args: { id: string }) => {
    try {
      if (!ctx.memoryStore) return { ok: false, error: "memory store not available" };
      return ctx.memoryStore.markNotificationRead(args);
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("notifications:mark-all-read", async () => {
    try {
      if (!ctx.memoryStore) return { ok: false, error: "memory store not available" };
      return ctx.memoryStore.markAllNotificationsRead();
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("notifications:dismiss", async (_event, args: { id: string }) => {
    try {
      if (!ctx.memoryStore) return { ok: false, error: "memory store not available" };
      return ctx.memoryStore.deleteNotification(args);
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("notifications:clear", async () => {
    try {
      if (!ctx.memoryStore) return { ok: false, error: "memory store not available" };
      return ctx.memoryStore.clearNotifications();
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });
}
