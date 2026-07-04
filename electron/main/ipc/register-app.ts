import { ipcMain, app } from "electron";
import type { AppContext } from "../context";

export function registerAppHandlers(ctx: AppContext): void {
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:copy-to-clipboard", (_evt, text: string) => {
    const { clipboard } = require("electron");
    clipboard.writeText(text);
    return true;
  });
  ipcMain.handle("app:read-from-clipboard", () => {
    const { clipboard } = require("electron");
    return clipboard.readText();
  });
  ipcMain.handle("app:reload-shell", () => {
    ctx.mainWindow?.webContents.reload();
  });
  // Native zoom — replaces document.body.style.zoom so xterm coordinates stay correct.
  ipcMain.handle("app:set-zoom", (_evt, factor: number) => {
    const win = ctx.mainWindow;
    if (win && !win.isDestroyed()) {
      const clamped = Math.max(0.5, Math.min(2, factor));
      win.webContents.setZoomFactor(clamped);
      win.webContents.setZoomLevel(0);
      return clamped;
    }
    return 1;
  });
}
