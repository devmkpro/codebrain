/**
 * Auto-update module (Disabled)
 */
import type { BrowserWindow } from "electron";
import { ipcMain } from "electron";
import { autoUpdater } from "electron-updater";
import log from "electron-log/main.js";

let windowRef: BrowserWindow | null = null;
let updateRequested = false;
let ipcRegistered = false;

export function setupAutoUpdater(
  window: BrowserWindow,
  _onBeforeInstall?: () => Promise<void>,
): void {
  windowRef = window;

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    windowRef?.webContents.send("update:checking");
  });

  autoUpdater.on("update-available", (info) => {
    windowRef?.webContents.send("update:available", { version: info.version });
  });

  autoUpdater.on("update-not-available", () => {
    windowRef?.webContents.send("update:none");
  });

  autoUpdater.on("error", (err) => {
    windowRef?.webContents.send("update:error", { message: err.message });
  });

  autoUpdater.on("download-progress", (progressObj) => {
    windowRef?.webContents.send("update:progress", { percent: progressObj.percent });
  });

  autoUpdater.on("update-downloaded", (info) => {
    windowRef?.webContents.send("update:downloaded", { version: info.version });
  });

  if (!ipcRegistered) {
    ipcRegistered = true;
    ipcMain.handle("update:check", async () => {
      try {
        await autoUpdater.checkForUpdates();
        return { ok: true };
      } catch (err: any) {
        log.error("Check for updates failed", err);
        return { ok: false, message: err.message };
      }
    });

    ipcMain.handle("update:install", async () => {
      updateRequested = true;
      if (_onBeforeInstall) {
        await _onBeforeInstall();
      }
      autoUpdater.quitAndInstall();
    });
  }

  // Do an initial check after a short delay so the UI is ready
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      log.error("Failed to check for updates on startup", err);
    });
  }, 3000);
}

export function teardownAutoUpdater(): void {
  windowRef = null;
}

export function isUpdateInstallRequested(): boolean {
  return updateRequested;
}

export function getMostRecentBackup(): string | null {
  return null;
}

export async function restoreFromBackup(): Promise<{ ok: boolean; message: string }> {
  return { ok: false, message: "Backup system disabled" };
}

