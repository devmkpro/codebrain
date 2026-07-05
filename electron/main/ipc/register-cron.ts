import { ipcMain } from "electron";
import type { AppContext } from "../context";

/**
 * IPC handlers for Cron Jobs (scheduled autonomous spawns).
 * Proxies to the MCP bridge cron handlers.
 * Pattern: same as register-recipe.ts — getBridge() on ctx._mcpBridge.
 */
export function registerCronHandlers(ctx: AppContext): void {
  function getBridge(): any {
    return (ctx as any)._mcpBridge;
  }

  // ── Create Cron Job ──────────────────────────────────────────────────────
  ipcMain.handle("cron:create", async (_event, args: {
    name: string;
    schedule: string;
    task_prompt: string;
    agent?: string;
    model?: string;
    label?: string;
    workspace?: string;
  }) => {
    try {
      const bridge = getBridge();
      if (!bridge?.cronCreate) return { ok: false, error: "Cron handlers not available" };
      return await bridge.cronCreate(args);
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // ── List Cron Jobs ───────────────────────────────────────────────────────
  ipcMain.handle("cron:list", async (_event, args?: {
    workspace?: string;
    status?: string;
  }) => {
    try {
      const bridge = getBridge();
      if (!bridge?.cronList) return { ok: false, error: "Cron handlers not available" };
      return await bridge.cronList(args || {});
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // ── Delete Cron Job ──────────────────────────────────────────────────────
  ipcMain.handle("cron:delete", async (_event, args: { id: string }) => {
    try {
      const bridge = getBridge();
      if (!bridge?.cronDelete) return { ok: false, error: "Cron handlers not available" };
      return await bridge.cronDelete(args);
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // ── Update Cron Job ──────────────────────────────────────────────────────
  ipcMain.handle("cron:update", async (_event, args: {
    id: string;
    name?: string;
    schedule?: string;
    status?: string;
    task_prompt?: string;
    agent?: string;
    model?: string;
    label?: string;
  }) => {
    try {
      const bridge = getBridge();
      if (!bridge?.cronUpdate) return { ok: false, error: "Cron handlers not available" };
      return await bridge.cronUpdate(args);
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });
}
