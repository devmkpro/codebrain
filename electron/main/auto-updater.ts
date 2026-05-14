/**
 * Auto-update module (Disabled)
 */
import type { BrowserWindow } from "electron";
import { app, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";
import log from "electron-log/main.js";
import { execSync } from "node:child_process";
import * as path from "node:path";

let windowRef: BrowserWindow | null = null;
let updateRequested = false;
let ipcRegistered = false;

/**
 * Writes the Windows registry keys that the NSIS installer needs to locate
 * the existing installation during an auto-update. If these keys are missing
 * (e.g., first install didn't write them), quitAndInstall() fails with error 2.
 */
export function repairWindowsRegistryIfNeeded(): void {
  if (process.platform !== "win32" || !app.isPackaged) return;

  try {
    const appId = "sh.codebrain.app";
    const installDir = path.dirname(process.execPath);
    const productName = "Codebrain";
    const version = app.getVersion();
    const uninstaller = path.join(installDir, `Uninstall ${productName}.exe`);

    // Key 1: HKCU\Software\{appId} — install dir, read by NSIS update script
    const softwareKey = `HKCU\\Software\\${appId}`;
    execSync(`reg query "${softwareKey}" /ve`, { stdio: "ignore" });
  } catch {
    // Key doesn't exist — write it
    try {
      const appId = "sh.codebrain.app";
      const installDir = path.dirname(process.execPath);
      const productName = "Codebrain";
      const version = app.getVersion();
      const uninstaller = path.join(installDir, `Uninstall ${productName}.exe`);

      const softwareKey = `HKCU\\Software\\${appId}`;
      execSync(`reg add "${softwareKey}" /ve /d "${installDir}" /f`, { stdio: "ignore" });

      const uninstallKey = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${appId}`;
      execSync(`reg add "${uninstallKey}" /v "DisplayName" /d "${productName}" /f`, { stdio: "ignore" });
      execSync(`reg add "${uninstallKey}" /v "DisplayVersion" /d "${version}" /f`, { stdio: "ignore" });
      execSync(`reg add "${uninstallKey}" /v "UninstallString" /d "\\"${uninstaller}\\"" /f`, { stdio: "ignore" });
      execSync(`reg add "${uninstallKey}" /v "InstallLocation" /d "${installDir}" /f`, { stdio: "ignore" });
      execSync(`reg add "${uninstallKey}" /v "Publisher" /d "Codebrain" /f`, { stdio: "ignore" });
      execSync(`reg add "${uninstallKey}" /v "NoModify" /t REG_DWORD /d 1 /f`, { stdio: "ignore" });
      execSync(`reg add "${uninstallKey}" /v "NoRepair" /t REG_DWORD /d 1 /f`, { stdio: "ignore" });

      log.info("[auto-updater] Registry repair: wrote missing uninstall keys for", installDir);
    } catch (err) {
      log.warn("[auto-updater] Registry repair failed:", err);
    }
  }
}

export function setupAutoUpdater(
  window: BrowserWindow,
  _onBeforeInstall?: () => Promise<void>,
): void {
  windowRef = window;

  repairWindowsRegistryIfNeeded();

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

