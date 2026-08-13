import { BrowserWindow, ipcMain, app } from "electron";
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
      return clamped;
    }
    return 1;
  });
  // The Chromium title-bar overlay is native, so CSS theme tokens do not
  // reach minimize/maximize/close. Keep it in sync with the renderer theme.
  ipcMain.handle("app:set-window-theme", (event, theme: "dark" | "light") => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return false;
    const light = theme === "light";
    win.setTitleBarOverlay({
      color: light ? "#f7f7fa" : "#0c0c14",
      symbolColor: light ? "#3d3d52" : "#94a3b8",
      height: 38,
    });
    win.setBackgroundColor(light ? "#ececef" : "#000000");
    return true;
  });
}
