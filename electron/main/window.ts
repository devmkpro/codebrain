import { BrowserWindow, app } from "electron";
import * as path from "node:path";
import { is } from "./platform";
import { isUpdateInstallRequested } from "./auto-updater";

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#000000",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#0c0c14",
      symbolColor: "#94a3b8",
      height: 38
    },
    trafficLightPosition: { x: 14, y: 14 },
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  win.once("ready-to-show", () => win.show());

  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;

    const isMac = process.platform === "darwin";
    const cmdOrCtrl = isMac ? input.meta : input.control;

    // F12 → Toggle DevTools (dev mode only)
    if (input.key === "F12") {
      if (is.dev) {
        if (win.webContents.isDevToolsOpened()) {
          win.webContents.closeDevTools();
        } else {
          win.webContents.openDevTools();
        }
      }
      event.preventDefault();
      return;
    }

    // Ctrl+R / Cmd+R → Block reload in production
    if (cmdOrCtrl && input.key === "r" && !input.shift && !input.alt) {
      if (!is.dev) {
        event.preventDefault();
      }
      return;
    }

    // Ctrl+- / Cmd+- → Block zoom out
    if (cmdOrCtrl && input.key === "-") {
      event.preventDefault();
      return;
    }

    // Ctrl+Shift++ / Cmd+Shift++ → Block zoom in
    if (cmdOrCtrl && input.shift && (input.key === "=" || input.key === "+")) {
      event.preventDefault();
      return;
    }

    // Ctrl+Q / Cmd+Q → Quit app
    if (cmdOrCtrl && input.key === "q" && !input.shift && !input.alt) {
      app.quit();
      return;
    }

    // Ctrl+W / Cmd+W → Close window
    if (cmdOrCtrl && input.key === "w" && !input.shift && !input.alt) {
      win.close();
      event.preventDefault();
      return;
    }

    // Ctrl+M / Cmd+M → Minimize window
    if (cmdOrCtrl && input.key === "m" && !input.shift && !input.alt) {
      win.minimize();
      event.preventDefault();
      return;
    }
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  win.on("close", (e) => {
    if (isUpdateInstallRequested()) return;
  });

  return win;
}
