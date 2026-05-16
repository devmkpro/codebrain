import { ipcMain, app } from "electron";
import type { AppContext } from "../context";

export function registerAppHandlers(ctx: AppContext): void {
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:copy-to-clipboard", (_evt, text: string) => {
    const { clipboard } = require("electron");
    clipboard.writeText(text);
    return true;
  });
  ipcMain.handle("app:reload-shell", () => {
    ctx.mainWindow?.webContents.reload();
  });
}
