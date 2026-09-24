import { BrowserWindow, app, screen } from "electron";
import * as path from "node:path";
import { is } from "./platform";
import { isUpdateInstallRequested } from "./auto-updater";

/** Keep frameless windows inside the desktop work area (above the taskbar). */
function constrainToWorkArea(win: BrowserWindow): void {
  if (win.isDestroyed() || win.isFullScreen()) return;

  const bounds = win.getBounds();
  const workArea = screen.getDisplayMatching(bounds).workArea;

  // A janela sem moldura pode ocupar os bounds completos do monitor ao ser
  // maximizada, em vez da workArea que exclui a taskbar. Forçar os bounds
  // úteis neste caso mantém o rodapé do app acessível no Windows.
  if (win.isMaximized()) {
    if (
      bounds.x !== workArea.x ||
      bounds.y !== workArea.y ||
      bounds.width !== workArea.width ||
      bounds.height !== workArea.height
    ) {
      win.setBounds(workArea);
    }
    return;
  }

  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  const x = Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - width);
  const y = Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - height);

  if (x !== bounds.x || y !== bounds.y || width !== bounds.width || height !== bounds.height) {
    win.setBounds({ x, y, width, height });
  }
}

function keepWindowInWorkArea(win: BrowserWindow): void {
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      constrainToWorkArea(win);
    }, 0);
  };
  win.on("move", schedule);
  win.on("resize", schedule);
  win.on("maximize", schedule);
  win.on("unmaximize", schedule);
  win.once("ready-to-show", schedule);

  // Windows recalcula a workArea quando a taskbar muda de posição, é
  // auto-ocultada, ou a janela troca de monitor. Reaplicar o limite evita que
  // uma janela já maximizada continue sobre a barra.
  const onDisplayMetricsChanged = () => schedule();
  screen.on("display-metrics-changed", onDisplayMetricsChanged);
  win.once("closed", () => screen.removeListener("display-metrics-changed", onDisplayMetricsChanged));
}

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
  keepWindowInWorkArea(win);

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
    // Abrir o DevTools continua sendo o padrão em dev. O escape existe porque o
    // frontend do DevTools despeja no stdout ruído que não é nosso — o
    // "Unknown VE context" do visual logging dele e os `Autofill.enable` /
    // `Autofill.setAddresses` respondidos com -32601, já que o Electron não
    // implementa esse domínio do CDP. Com CODEBRAIN_NO_DEVTOOLS=1 o log de
    // arranque fica legível; F12 continua abrindo o DevTools quando precisar.
    if (process.env["CODEBRAIN_NO_DEVTOOLS"] !== "1") {
      win.webContents.openDevTools();
    }
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
  keepWindowInWorkArea(win);

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
