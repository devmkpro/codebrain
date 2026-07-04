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

  // Reset zoom level on load — zoom factor is controlled by renderer via IPC (app:set-zoom)
  win.webContents.once("did-finish-load", () => {
    win.webContents.setZoomLevel(0);
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

    // Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0 → handled by renderer JS (appZoom → IPC app:set-zoom).
    // The renderer is the single source of truth for zoom factor.
    if (cmdOrCtrl && !input.alt && (input.key === "=" || input.key === "+" || input.key === "-" || input.key === "_" || input.key === "0")) {
      return; // don't preventDefault — let JS handler in renderer fire
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

/**
 * Creates a new BrowserWindow for a detached terminal pane.
 * The window loads the app with ?detachedPane=<id> so the renderer
 * can show a single-pane view with minimal chrome.
 */
export function createDetachedPaneWindow(paneId: string, workspacePath: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 500,
    minHeight: 400,
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

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}?detachedPane=${encodeURIComponent(paneId)}&workspace=${encodeURIComponent(workspacePath)}`);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"), {
      search: `?detachedPane=${encodeURIComponent(paneId)}&workspace=${encodeURIComponent(workspacePath)}`,
    });
  }

  return win;
}
