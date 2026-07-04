import { BrowserWindow, ipcMain } from "electron";
import type { AppContext } from "../context";
import { spawnPaneInternal } from "../services/pane-spawn";
import { createDetachedPaneWindow } from "../window";

export function registerPaneHandlers(ctx: AppContext): void {
  ipcMain.handle("pty:spawn", async (_event, config) => spawnPaneInternal(ctx, config));

  ipcMain.handle("pty:write", async (_event, paneId: string, data: string) => {
    try { ctx.ptyManager.write(paneId, data); return { ok: true }; }
    catch (err) { return { ok: false, error: String(err) }; }
  });

  ipcMain.handle("pty:read", async (_event, paneId: string, lastN?: number) => {
    try { return { ok: true, lines: ctx.ptyManager.read(paneId, lastN) }; }
    catch (err) { return { ok: false, lines: [], error: String(err) }; }
  });

  ipcMain.handle("pty:readRaw", async (_event, paneId: string, lastN?: number) => {
    try { return { ok: true, lines: ctx.ptyManager.readRaw(paneId, lastN) }; }
    catch (err) { return { ok: false, lines: [], error: String(err) }; }
  });

  ipcMain.handle("pty:readRawText", async (_event, paneId: string) => {
    try { return { ok: true, text: ctx.ptyManager.readRawText(paneId) }; }
    catch (err) { return { ok: false, text: "", error: String(err) }; }
  });

  ipcMain.handle("pty:kill", async (_event, paneId: string) => {
    try { ctx.ptyManager.kill(paneId); return { ok: true }; }
    catch (err) { return { ok: false, error: String(err) }; }
  });

  // pty:list filters out detached panes so the main window doesn't re-add them
  ipcMain.handle("pty:list", async () => {
    const panes = ctx.ptyManager.list().filter(p => !ctx.detachedPaneIds.has(p.paneId));
    // Enrich with role + mission_id from actor_registry (for RoleBadge/MissionBadge)
    try {
      const store = ctx.memoryStore;
      if (store?.getActorRole) {
        for (const p of panes) {
          try {
            const roleInfo = store.getActorRole({ paneId: p.paneId });
            if (roleInfo?.ok) {
              (p as any).role = roleInfo.role || undefined;
              (p as any).mission_id = roleInfo.missionId || undefined;
            }
          } catch {}
        }
      }
    } catch {}
    return { ok: true, panes };
  });

  ipcMain.handle("pty:resize", async (_event, paneId: string, cols: number, rows: number) => {
    try { ctx.ptyManager.resize(paneId, cols, rows); return { ok: true }; }
    catch (err) { return { ok: false, error: String(err) }; }
  });

  // ── Detach pane into its own window ────────────────────────────────────────
  ipcMain.handle("pty:detach", async (_event, paneId: string) => {
    if (typeof paneId !== "string" || !paneId) return { ok: false, error: "invalid paneId" };

    // Check if already detached
    const existing = BrowserWindow.getAllWindows().find(w => {
      try {
        const url = new URL(w.webContents.getURL());
        return url.searchParams.get("detachedPane") === paneId;
      } catch { return false; }
    });
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return { ok: true };
    }

    // Get workspace path from pane config
    const cfg = ctx.paneConfigs.get(paneId);
    const workspacePath = cfg?.cwd ?? ctx.currentWorkspacePath;

    // Mark as detached so pty:list filters it out of the main window
    ctx.detachedPaneIds.add(paneId);

    const detachedWin = createDetachedPaneWindow(paneId, workspacePath);

    // When the detached window closes, un-mark the pane and notify main window
    detachedWin.once("closed", () => {
      ctx.detachedPaneIds.delete(paneId);
      // Notify main window(s) that the pane is back so they can re-add it if still alive
      BrowserWindow.getAllWindows().forEach(w => {
        try {
          const url = new URL(w.webContents.getURL());
          if (!url.searchParams.has("detachedPane")) {
            w.webContents.send("pane:reattached", paneId);
          }
        } catch { /* ignore */ }
      });
    });

    return { ok: true };
  });

  // ── Get pane role from actor_registry ───────────────────────────────────────
  ipcMain.handle("pane:getRole", async (_event, paneId: string) => {
    try {
      const store = ctx.memoryStore;
      if (store?.getActorRole) {
        const entry = store.getActorRole({ paneId });
        return { ok: true, role: entry?.role ?? null, missionId: entry?.mission_id ?? null };
      }
      return { ok: true, role: null, missionId: null };
    } catch (err) {
      return { ok: false, role: null, missionId: null, error: String(err) };
    }
  });

  // ── Hibernate pane (kill PTY but keep config for revival) ──────────────────
  ipcMain.handle("pty:hibernate", async (_event, paneId: string) => {
    try {
      const cfg = ctx.paneConfigs.get(paneId);
      if (!cfg) return { ok: false, error: "pane not found" };
      ctx.hibernatedPanes.set(paneId, { ...cfg, hibernatedAt: Date.now() });
      ctx.ptyManager.kill(paneId);
      return { ok: true };
    } catch (err) { return { ok: false, error: String(err) }; }
  });

  // ── Wake hibernated pane (re-spawn with saved config) ──────────────────────
  ipcMain.handle("pty:wake", async (_event, paneId: string) => {
    try {
      const cfg = ctx.hibernatedPanes.get(paneId);
      if (!cfg) return { ok: false, error: "pane not hibernated" };
      ctx.hibernatedPanes.delete(paneId);
      await spawnPaneInternal(ctx, { ...cfg, paneId });
      return { ok: true };
    } catch (err) { return { ok: false, error: String(err) }; }
  });
}
