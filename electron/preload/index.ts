/**
 * Preload script — exposes `window.codeBrainApp` to the renderer via contextBridge.
 * All IPC communication must go through these typed methods.
 */
import { contextBridge, ipcRenderer, webUtils } from "electron";

const PROVIDERS_UPDATED = "providers:updated";

// PTY output is high-frequency — use a shared listener + fanout to avoid
// registering N separate ipcRenderer.on handlers.
const ptyOutputCallbacks = new Set<(paneId: string, data: string, echo: boolean) => void>();
let ptyOutputListenerInstalled = false;

function ensurePtyOutputListener(): void {
  if (ptyOutputListenerInstalled) return;
  ptyOutputListenerInstalled = true;
  ipcRenderer.on("pty:output", (_evt, paneId: string, data: string, echo: boolean) => {
    for (const callback of ptyOutputCallbacks) {
      try { callback(paneId, data, echo || false); } catch {}
    }
  });
}

// ── Browser Control IPC Bridge ───────────────────────────────────────────────
// Bridges between Electron IPC (ipcRenderer <-> ipcMain) and DOM CustomEvents
// (window.dispatchEvent <-> window.addEventListener) so that:
//   Main process -> webContents.send("codebrain:browser:cmd") -> ipcRenderer.on
//     -> window.dispatchEvent(CustomEvent) -> BrowserPane picks up
//   BrowserPane -> window.dispatchEvent(CustomEvent "codebrain:browser:result")
//     -> window.addEventListener -> ipcRenderer.send -> ipcMain.on -> main resolves

function installBrowserCommandBridge(): void {
  // Main -> Renderer: forward IPC commands as DOM CustomEvents
  ipcRenderer.on("codebrain:browser:cmd", (_evt, detail: unknown) => {
    window.dispatchEvent(new CustomEvent("codebrain:browser:cmd", { detail }));
  });

  // Renderer -> Main: forward DOM CustomEvent results as IPC messages
  window.addEventListener("codebrain:browser:result", ((e: CustomEvent) => {
    ipcRenderer.send("codebrain:browser:result", e.detail);
  }) as EventListener);

  // Main -> Renderer: forward network entries as DOM events (for BrowserPane store)
  ipcRenderer.on("codebrain:browser:network-entry", (_evt, entry: unknown) => {
    window.dispatchEvent(new CustomEvent("codebrain:browser:network-entry", { detail: entry }));
  });

  // Main -> Renderer: create a new browser pane (from MCP browser_open tool)
  ipcRenderer.on("codebrain:browser:create-pane", (_evt, detail: unknown) => {
    window.dispatchEvent(new CustomEvent("codebrain:browser:create-pane", { detail }));
  });

  // Renderer -> Main: register browser pane ID so MCP can find it
  // Exposed as window.codeBrainApp.browser.registerPane(paneId)
}

// Install the bridge immediately — it must be ready before any BrowserPane mounts
installBrowserCommandBridge();

contextBridge.exposeInMainWorld("codeBrainApp", {
  app: {
    version: () => ipcRenderer.invoke("app:version"),
    copyToClipboard: (text: string) => ipcRenderer.invoke("app:copy-to-clipboard", text),
    readFromClipboard: (): Promise<string> => ipcRenderer.invoke("app:read-from-clipboard"),
    onReloadShortcut: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on("app:reload-shortcut", handler);
      return () => ipcRenderer.off("app:reload-shortcut", handler);
    },
    reloadShell: () => ipcRenderer.invoke("app:reload-shell"),
  },

  auth: {
    status: () => ipcRenderer.invoke("auth:status"),
    profile: () => ipcRenderer.invoke("auth:profile"),
    logout: () => ipcRenderer.invoke("auth:logout"),
    openLogin: () => ipcRenderer.invoke("auth:open-login"),
    openSignup: () => ipcRenderer.invoke("auth:open-signup"),
    openTerms: () => ipcRenderer.invoke("auth:open-terms"),
    openPrivacy: () => ipcRenderer.invoke("auth:open-privacy"),
    openBilling: () => ipcRenderer.invoke("auth:open-billing"),
    onAuthSuccess: (callback: (data: { email: string }) => void) => {
      const handler = (_evt: unknown, data: { email: string }) => callback(data);
      ipcRenderer.on("auth:success", handler);
      return () => ipcRenderer.off("auth:success", handler);
    },
    onAuthState: (callback: (state: unknown) => void) => {
      const handler = (_evt: unknown, state: unknown) => callback(state);
      ipcRenderer.on("auth:state", handler);
      return () => ipcRenderer.off("auth:state", handler);
    },
    onAuthenticating: (callback: (data: { email: string }) => void) => {
      const handler = (_evt: unknown, data: { email: string }) => callback(data);
      ipcRenderer.on("auth:authenticating", handler);
      return () => ipcRenderer.off("auth:authenticating", handler);
    },
  },

  workspaces: {
    recent: () => ipcRenderer.invoke("workspaces:recent"),
    touch: (path: string) => ipcRenderer.invoke("workspaces:touch", path),
    remove: (path: string) => ipcRenderer.invoke("workspaces:remove", path),
  },

  pty: {
    spawn: (config: unknown) => ipcRenderer.invoke("pty:spawn", config),
    write: (paneId: string, data: string) => ipcRenderer.invoke("pty:write", paneId, data),
    read: (paneId: string, lastN?: number) => ipcRenderer.invoke("pty:read", paneId, lastN),
    readRaw: (paneId: string, lastN?: number) => ipcRenderer.invoke("pty:readRaw", paneId, lastN),
    readRawText: (paneId: string) => ipcRenderer.invoke("pty:readRawText", paneId),
    kill: (paneId: string) => ipcRenderer.invoke("pty:kill", paneId),
    detach: (paneId: string) => ipcRenderer.invoke("pty:detach", paneId),
    list: () => ipcRenderer.invoke("pty:list"),
    resize: (paneId: string, cols: number, rows: number) => ipcRenderer.invoke("pty:resize", paneId, cols, rows),
    onOutput: (callback: (paneId: string, data: string, echo?: boolean) => void) => {
      ensurePtyOutputListener();
      ptyOutputCallbacks.add(callback);
      return () => { ptyOutputCallbacks.delete(callback); };
    },
    onExit: (callback: (paneId: string, exitCode: number) => void) => {
      const handler = (_evt: unknown, paneId: string, exitCode: number) => callback(paneId, exitCode);
      ipcRenderer.on("pty:exit", handler);
      return () => ipcRenderer.off("pty:exit", handler);
    },
    onPaneAdded: (callback: (info: unknown) => void) => {
      const handler = (_evt: unknown, info: unknown) => callback(info);
      ipcRenderer.on("pane:added", handler);
      return () => ipcRenderer.off("pane:added", handler);
    },
    onPaneReattached: (callback: (paneId: string) => void) => {
      const handler = (_evt: unknown, paneId: string) => callback(paneId);
      ipcRenderer.on("pane:reattached", handler);
      return () => ipcRenderer.off("pane:reattached", handler);
    },
    onPaneSession: (callback: (info: unknown) => void) => {
      const handler = (_evt: unknown, info: unknown) => callback(info);
      ipcRenderer.on("pane:session", handler);
      return () => ipcRenderer.off("pane:session", handler);
    },
  },

  workspace: {
    open: () => ipcRenderer.invoke("workspace:open"),
    set: (dir: string) => ipcRenderer.invoke("workspace:set", dir),
    save: (config: unknown) => ipcRenderer.invoke("workspace:save", config),
    scan: (path: string) => ipcRenderer.invoke("workspace:scan", path),
    detect: (dir?: string) => ipcRenderer.invoke("workspace:detect", dir),
  },

  tokens: {
    byTask: () => Promise.resolve({}),
    byWorkspace: () => Promise.resolve({}),
    onUpdated: () => () => {},
  },

  session: {
    load: (workspacePath: string) => ipcRenderer.invoke("session:load", workspacePath),
    loadAll: (workspacePath: string) => ipcRenderer.invoke("session:loadAll", workspacePath),
    clear: (workspacePath: string) => ipcRenderer.invoke("session:clear", workspacePath),
    deleteOne: (workspacePath: string, sessionId: string) =>
      ipcRenderer.invoke("session:deleteOne", workspacePath, sessionId),
    saveSnapshot: (workspacePath: string) => ipcRenderer.invoke("session:saveSnapshot", workspacePath),
    loadSnapshot: (workspacePath: string) => ipcRenderer.invoke("session:loadSnapshot", workspacePath),
    export: (opts: { paneId?: string; format: "markdown" | "json"; includeAll?: boolean }) =>
      ipcRenderer.invoke("session:export", opts),
  },

  claude: {
    summary: (sessionId: string) => ipcRenderer.invoke("claude:summary", sessionId),
    sessions: (workspacePath: string) => ipcRenderer.invoke("claude:sessions", workspacePath),
  },

  files: {
    list: (workspacePath: string, subPath?: string) =>
      ipcRenderer.invoke("files:list", workspacePath, subPath ?? ""),
    read: (workspacePath: string, relPath: string) =>
      ipcRenderer.invoke("files:read", workspacePath, relPath),
    write: (workspacePath: string, relPath: string, content: string) =>
      ipcRenderer.invoke("files:write", workspacePath, relPath, content),
    pathForFile: (file: File) => webUtils.getPathForFile(file),
    saveDropped: (name: string, bytes: ArrayBuffer) =>
      ipcRenderer.invoke("files:saveDropped", name, bytes),
  },

  providers: {
    list: () => ipcRenderer.invoke("providers:list"),
    templates: () => ipcRenderer.invoke("providers:templates"),
    save: (provider: unknown) => ipcRenderer.invoke("providers:save", provider),
    delete: (id: string) => ipcRenderer.invoke("providers:delete", id),
    testToken: (args: unknown) => ipcRenderer.invoke("providers:testToken", args),
    onUpdated: (callback: (providers: unknown[]) => void) => {
      const handler = (_evt: unknown, providers: unknown[]) => callback(providers);
      ipcRenderer.on(PROVIDERS_UPDATED, handler);
      return () => ipcRenderer.off(PROVIDERS_UPDATED, handler);
    },
  },

  diagnostics: {
    snapshot: () => ipcRenderer.invoke("diagnostics:snapshot"),
  },

  audio: {
    getConfig: () => ipcRenderer.invoke("audio:getConfig"),
    saveConfig: (patch: unknown) => ipcRenderer.invoke("audio:saveConfig", patch),
    transcribe: (args: unknown) => ipcRenderer.invoke("audio:transcribe", args),
    hardwareInfo: () => ipcRenderer.invoke("audio:hardwareInfo"),
    installWhisper: (args: unknown) => ipcRenderer.invoke("audio:installWhisper", args),
    onInstallProgress: (cb: (line: string) => void) => {
      const handler = (_e: unknown, line: string) => cb(line);
      ipcRenderer.on("audio:installProgress", handler);
      return () => ipcRenderer.removeListener("audio:installProgress", handler);
    },
  },

  workspaceConfig: {
    get: (wsPath: string) => ipcRenderer.invoke("workspaceConfig:get", wsPath),
    set: (wsPath: string, cfg: unknown) => ipcRenderer.invoke("workspaceConfig:set", wsPath, cfg),
  },

  appConfig: {
    get: () => ipcRenderer.invoke("appConfig:get"),
    set: (patch: unknown) => ipcRenderer.invoke("appConfig:set", patch),
  },

  shells: {
    list: () => ipcRenderer.invoke("shells:list"),
  },

  skill: {
    status: () => ipcRenderer.invoke("skill:status"),
    list: () => ipcRenderer.invoke("skill:list"),
    openFolder: () => ipcRenderer.invoke("skill:openFolder"),
    install: () => ipcRenderer.invoke("skill:installCodebrain"),
    uninstall: () => ipcRenderer.invoke("skill:uninstallCodebrain"),
    listInstalled: (args?: { type?: string }) => ipcRenderer.invoke("skill:listInstalled", args),
    get: (args: { id: string }) => ipcRenderer.invoke("skill:get", args),
    installFromRegistry: (args: { id: string }) => ipcRenderer.invoke("skill:installFromRegistry", args),
    uninstallSkill: (args: { id: string }) => ipcRenderer.invoke("skill:uninstall", args),
    sync: (args: { direction: "pull" | "push" }) => ipcRenderer.invoke("skill:sync", args),
    registryIndex: () => ipcRenderer.invoke("skill:registryIndex"),
    claudeConfigStatus: () => ipcRenderer.invoke("skill:claudeConfigStatus"),
    installClaudeConfig: () => ipcRenderer.invoke("skill:installClaudeConfig"),
    uninstallClaudeConfig: () => ipcRenderer.invoke("skill:uninstallClaudeConfig"),
    openClaudeConfigFolder: () => ipcRenderer.invoke("skill:openClaudeConfigFolder"),
  },

  cli: {
    detect: () => ipcRenderer.invoke("cli:detect"),
    redetect: () => ipcRenderer.invoke("cli:redetect"),
    install: () => ipcRenderer.invoke("cli:install"),
    installCli: (cli: string) => ipcRenderer.invoke("cli:install-cli", cli),
  },

  discord: {
    updatePresence: (args: { details: string; state?: string }) =>
      ipcRenderer.invoke("discord:updatePresence", args),
    status: () => ipcRenderer.invoke("discord:status"),
    setClientId: (clientId: string) => ipcRenderer.invoke("discord:setClientId", clientId),
  },

  tasks: {
    list: () => ipcRenderer.invoke("tasks:list"),
    onUpdated: (cb: (state: unknown) => void) => {
      const handler = (_evt: unknown, state: unknown) => cb(state);
      ipcRenderer.on("tasks:updated", handler);
      return () => ipcRenderer.off("tasks:updated", handler);
    },
  },

  squads: {
    list: () => ipcRenderer.invoke("squads:list"),
    save: (squad: unknown) => ipcRenderer.invoke("squads:save", squad),
    delete: (id: string) => ipcRenderer.invoke("squads:delete", id),
  },

  browser: {
    // Navigation
    navigate: (url: string, paneId?: string) => ipcRenderer.invoke("browser:navigate", url, paneId),
    open: (url: string) => ipcRenderer.invoke("browser:open", url),
    back: (paneId?: string) => ipcRenderer.invoke("browser:back", paneId),
    forward: (paneId?: string) => ipcRenderer.invoke("browser:forward", paneId),
    reload: (hard?: boolean, paneId?: string) => ipcRenderer.invoke("browser:reload", hard, paneId),
    // DOM reading
    getHtml: (selector?: string, paneId?: string) => ipcRenderer.invoke("browser:get-html", selector, paneId),
    getText: (selector?: string, paneId?: string) => ipcRenderer.invoke("browser:get-text", selector, paneId),
    getA11yTree: (maxDepth?: number, maxNodes?: number, paneId?: string) => ipcRenderer.invoke("browser:get-a11y-tree", maxDepth, maxNodes, paneId),
    findByText: (text: string, role?: string, exact?: boolean, paneId?: string) => ipcRenderer.invoke("browser:find-by-text", text, role, exact, paneId),
    getElement: (selector: string, paneId?: string) => ipcRenderer.invoke("browser:get-element", selector, paneId),
    getUrl: (paneId?: string) => ipcRenderer.invoke("browser:get-url", paneId),
    // DOM interaction
    click: (selector: string, paneId?: string) => ipcRenderer.invoke("browser:click", selector, paneId),
    fill: (selector: string, value: string, clearFirst?: boolean, paneId?: string) => ipcRenderer.invoke("browser:fill", selector, value, clearFirst, paneId),
    select: (selector: string, valueOrText: string, paneId?: string) => ipcRenderer.invoke("browser:select", selector, valueOrText, paneId),
    check: (selector: string, checked?: boolean, paneId?: string) => ipcRenderer.invoke("browser:check", selector, checked, paneId),
    clear: (selector: string, paneId?: string) => ipcRenderer.invoke("browser:clear", selector, paneId),
    focus: (selector: string, paneId?: string) => ipcRenderer.invoke("browser:focus", selector, paneId),
    hover: (selector: string, paneId?: string) => ipcRenderer.invoke("browser:hover", selector, paneId),
    // Coordinate interaction
    clickAt: (x: number, y: number, button?: string, paneId?: string) => ipcRenderer.invoke("browser:click-at", x, y, button, paneId),
    hoverAt: (x: number, y: number, paneId?: string) => ipcRenderer.invoke("browser:hover-at", x, y, paneId),
    drag: (x1: number, y1: number, x2: number, y2: number, steps?: number, paneId?: string) => ipcRenderer.invoke("browser:drag", x1, y1, x2, y2, steps, paneId),
    scroll: (selector: string | undefined, direction: string, amount: number, paneId?: string) => ipcRenderer.invoke("browser:scroll", selector, direction, amount, paneId),
    // Keyboard
    type: (text: string, delayMs?: number, paneId?: string) => ipcRenderer.invoke("browser:type", text, delayMs, paneId),
    key: (key: string, paneId?: string) => ipcRenderer.invoke("browser:key", key, paneId),
    shortcut: (keys: string, paneId?: string) => ipcRenderer.invoke("browser:shortcut", keys, paneId),
    // Wait
    waitFor: (selector: string, timeoutMs?: number, paneId?: string) => ipcRenderer.invoke("browser:wait-for", selector, timeoutMs, paneId),
    waitForText: (text: string, selector?: string, timeoutMs?: number, paneId?: string) => ipcRenderer.invoke("browser:wait-for-text", text, selector, timeoutMs, paneId),
    waitForUrl: (pattern: string, timeoutMs?: number, paneId?: string) => ipcRenderer.invoke("browser:wait-for-url", pattern, timeoutMs, paneId),
    waitForLoad: (timeoutMs?: number, paneId?: string) => ipcRenderer.invoke("browser:wait-for-load", timeoutMs, paneId),
    // Screenshots
    screenshot: (fullPage?: boolean, paneId?: string) => ipcRenderer.invoke("browser:screenshot", fullPage, paneId),
    screenshotElement: (selector: string, paneId?: string) => ipcRenderer.invoke("browser:screenshot-el", selector, paneId),
    annotate: (screenshotPath: string, annotations: unknown[]) => ipcRenderer.invoke("browser:annotate", screenshotPath, annotations),
    // Eval
    eval: (js: string, paneId?: string) => ipcRenderer.invoke("browser:eval", js, paneId),
    // Logs
    consoleLog: (level?: string, sinceMs?: number, limit?: number, paneId?: string) => ipcRenderer.invoke("browser:console-log", level, sinceMs, limit, paneId),
    clearConsole: () => ipcRenderer.invoke("browser:clear-console"),
    networkLog: (urlFilter?: string, method?: string, status?: string, sinceMs?: number, limit?: number, paneId?: string) => ipcRenderer.invoke("browser:network-log", urlFilter, method, status, sinceMs, limit, paneId),
    networkWait: (pattern: string, method?: string, timeoutMs?: number) => ipcRenderer.invoke("browser:network-wait", pattern, method, timeoutMs),
    clearNetwork: () => ipcRenderer.invoke("browser:clear-network"),
    // Send console entry from renderer to main (for MCP tool access)
    reportConsoleEntry: (entry: unknown) => ipcRenderer.send("codebrain:browser:console-entry", entry),
    // Send network entry from JS interceptor to main (for MCP tool access)
    reportNetworkEntry: (entry: unknown) => ipcRenderer.send("codebrain:browser:network-entry-js", entry),
    // Register a browser pane ID with main process so MCP tools can find it
    registerPane: (paneId: string, workspacePath?: string) => ipcRenderer.send("codebrain:browser:pane-created", paneId, workspacePath),
    // Unregister a browser pane ID
    unregisterPane: (paneId: string) => ipcRenderer.send("codebrain:browser:pane-destroyed", paneId),
    // Events
    onNetworkEntry: (cb: (entry: unknown) => void) => {
      const handler = (_evt: unknown, entry: unknown) => cb(entry);
      ipcRenderer.on("codebrain:browser:network-entry", handler);
      return () => ipcRenderer.off("codebrain:browser:network-entry", handler);
    },
    onConsoleEntry: (cb: (entry: unknown) => void) => {
      const handler = (_evt: unknown, entry: unknown) => cb(entry);
      ipcRenderer.on("codebrain:browser:console-entry", handler);
      return () => ipcRenderer.off("codebrain:browser:console-entry", handler);
    },
  },

  notify: (title: string, body: string) => ipcRenderer.send("notify", title, body),

  memory: {
    list: (opts?: Record<string, unknown>) => ipcRenderer.invoke("memory:list", opts ?? {}),
    search: (opts: Record<string, unknown>) => ipcRenderer.invoke("memory:search", opts),
    read: (opts: Record<string, unknown>) => ipcRenderer.invoke("memory:read", opts),
    delete: (opts: Record<string, unknown>) => ipcRenderer.invoke("memory:delete", opts),
    stats: () => ipcRenderer.invoke("memory:stats"),
    listPatterns: (opts?: Record<string, unknown>) => ipcRenderer.invoke("memory:listPatterns", opts ?? {}),
    deletePattern: (opts: Record<string, unknown>) => ipcRenderer.invoke("memory:deletePattern", opts),
  },

  cost: {
    summary: () => Promise.resolve({ ok: true, data: {} }),
    taskSummary: () => Promise.resolve({ ok: true, data: { tasks: [] } }),
    setBudget: () => Promise.resolve({ ok: true }),
    getBudget: () => Promise.resolve({ ok: true, data: {} }),
    getAlerts: () => Promise.resolve({ ok: true, data: [] }),
    listModels: () => Promise.resolve({ ok: true, data: {} }),
    estimate: () => Promise.resolve({ ok: true, data: { cost: 0 } }),
    reset: () => Promise.resolve({ ok: true }),
    setModelCost: () => Promise.resolve({ ok: true }),
    deleteModelCost: () => Promise.resolve({ ok: true }),
  },

  log: {
    list: (opts?: Record<string, unknown>) => ipcRenderer.invoke("log:list", opts ?? {}),
    onAppended: (callback: (entry: unknown) => void) => {
      const handler = (_evt: unknown, entry: unknown) => callback(entry);
      ipcRenderer.on("log:appended", handler);
      return () => ipcRenderer.off("log:appended", handler);
    },
  },

  update: {
    check: () => ipcRenderer.invoke("update:check"),
    install: () => ipcRenderer.invoke("update:install"),
    onChecking: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on("update:checking", handler);
      return () => ipcRenderer.off("update:checking", handler);
    },
    onAvailable: (cb: (data: unknown) => void) => {
      const handler = (_evt: unknown, data: unknown) => cb(data);
      ipcRenderer.on("update:available", handler);
      return () => ipcRenderer.off("update:available", handler);
    },
    onNone: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on("update:none", handler);
      return () => ipcRenderer.off("update:none", handler);
    },
    onProgress: (cb: (data: unknown) => void) => {
      const handler = (_evt: unknown, data: unknown) => cb(data);
      ipcRenderer.on("update:progress", handler);
      return () => ipcRenderer.off("update:progress", handler);
    },
    onDownloaded: (cb: (data: unknown) => void) => {
      const handler = (_evt: unknown, data: unknown) => cb(data);
      ipcRenderer.on("update:downloaded", handler);
      return () => ipcRenderer.off("update:downloaded", handler);
    },
    onError: (cb: (data: unknown) => void) => {
      const handler = (_evt: unknown, data: unknown) => cb(data);
      ipcRenderer.on("update:error", handler);
      return () => ipcRenderer.off("update:error", handler);
    },
    onInstalling: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on("update:installing", handler);
      return () => ipcRenderer.off("update:installing", handler);
    },
  },
});
