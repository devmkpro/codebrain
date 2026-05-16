import { ipcMain } from "electron";
import type { AppContext } from "../context";
import { spawnPaneInternal } from "../services/pane-spawn";

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

  ipcMain.handle("pty:list", async () => ({ ok: true, panes: ctx.ptyManager.list() }));

  ipcMain.handle("pty:resize", async (_event, paneId: string, cols: number, rows: number) => {
    try { ctx.ptyManager.resize(paneId, cols, rows); return { ok: true }; }
    catch (err) { return { ok: false, error: String(err) }; }
  });
}
