/**
 * Headless Codebrain MCP daemon.
 *
 * This entry point is built next to the Electron main bundle and is started
 * with ELECTRON_RUN_AS_NODE=1. It deliberately does not import Electron APIs
 * or create a BrowserWindow: the only long-lived resources are the MCP HTTP
 * server, SQLite memory store and real node-pty sessions.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PtyManager } from "./pty-manager";
import { HooksManager } from "./services/hooks";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const runtimePaths = require("../../packages/mcp/runtime-paths.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createMemoryStore } = require("../../packages/memory/store.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { startMCPServer } = require("../../packages/mcp/server.js");

interface DaemonArgs {
  port?: number;
  workspace: string;
  dataDir: string;
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseArgs(): DaemonArgs {
  const portText = argValue("--port") || process.env.CODEBRAIN_MCP_PORT;
  const parsedPort = portText ? Number.parseInt(portText, 10) : undefined;
  const workspaceCandidate = argValue("--workspace") || process.env.CODEBRAIN_WORKSPACE || process.cwd();
  const workspace = path.resolve(workspaceCandidate);
  const configuredDataDir = argValue("--data-dir") || process.env.CODEBRAIN_DATA_DIR;
  const dataDir = path.resolve(configuredDataDir || runtimePaths.CODEBRAIN_DIR || path.join(os.homedir(), ".codebrain"));

  return {
    port: Number.isFinite(parsedPort) && parsedPort! > 0 ? parsedPort : undefined,
    workspace: fs.existsSync(workspace) ? workspace : process.cwd(),
    dataDir,
  };
}

function createCliPtyManager(): any {
  // PtyManager is the same implementation used by the desktop app, including
  // real PTY allocation, output buffers, idle detection and pane lifecycle.
  return new PtyManager();
}

function createHeadlessBridgeOptions(ptyManager: any, args: DaemonArgs, hooksManager: HooksManager, memoryStore: any): Record<string, any> {
  const paneConfigs = new Map<string, any>();
  const providerHealth = new Map<string, any>();
  let currentWorkspace = args.workspace;

  const emitPaneSpawned = (paneId: string, config: any) => {
    hooksManager.fire("pane_spawned", {
      paneId,
      agent: config.agent,
      cwd: config.cwd,
      providerId: config.providerId,
      model: config.model,
    }, paneId);
  };

  ptyManager.on("exit", (paneId: string, exitCode: number) => {
    const config = paneConfigs.get(paneId);
    hooksManager.fire("pane_exited", {
      exitCode,
      agent: config?.agent,
    }, paneId);
    paneConfigs.delete(paneId);
  });
  ptyManager.on("idle", ({ paneId, idle }: any) => {
    hooksManager.fire("pane_idle", { lastOutput: idle?.lastOutput?.slice?.(-3) }, paneId);
  });

  const spawnPaneFn = async (request: any) => {
    const config = {
      ...request,
      agent: request?.agent || "openclaude",
      cwd: request?.cwd && fs.existsSync(request.cwd) ? request.cwd : currentWorkspace,
      workspacePath: currentWorkspace,
    };
    try {
      const paneId = await ptyManager.spawn(config);
      paneConfigs.set(paneId, config);
      emitPaneSpawned(paneId, config);
      return { ok: true, paneId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  const unavailable = (feature: string) => async () => ({ ok: false, error: `${feature} requires the Codebrain desktop app` });

  return {
    dataDir: args.dataDir,
    memoryStore,
    paneConfigs,
    providerHealth,
    hooksManager,
    spawnPaneFn,
    onPaneCreated: () => {},
    getCurrentWorkspacePath: () => currentWorkspace,
    setCurrentWorkspacePath: (workspace: string) => {
      if (workspace && fs.existsSync(workspace)) currentWorkspace = path.resolve(workspace);
    },
    sendBrowserCmd: unavailable("Browser tools"),
    saveScreenshot: unavailable("Browser tools"),
    saveScreenshotElement: unavailable("Browser tools"),
    getNetworkLog: async () => ({ ok: false, entries: [] }),
    getConsoleLog: async () => ({ ok: false, entries: [] }),
    clearBrowserLogs: async () => ({ ok: false }),
    resolveBrowserPaneId: () => null,
    createBrowserPane: unavailable("Browser tools"),
    configStore: null,
    providerStore: null,
    providerRegistry: [],
    workspaceConfigStore: null,
    updateContextFiles: undefined,
    emitNotification: (data: any) => {
      try { memoryStore?.createNotification?.(data); } catch {}
    },
    getOAuthToken: async () => null,
    getBotToken: () => null,
    getGoogleKey: () => null,
    emitToRenderer: () => {},
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  fs.mkdirSync(args.dataDir, { recursive: true });

  let memoryStore: any = null;
  try {
    memoryStore = createMemoryStore(path.join(args.dataDir, "memory.db"));
  } catch (err) {
    console.warn("[mcp-daemon] Memory store unavailable:", err instanceof Error ? err.message : String(err));
  }

  const ptyManager = createCliPtyManager();
  const hooksManager = new HooksManager();
  let serverInfo: any = null;
  let shuttingDown = false;

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try { serverInfo?.close?.(); } catch {}
    try { ptyManager.killAll(); } catch {}
    try { memoryStore?.close?.(); } catch {}
    runtimePaths.clearDaemonState();
    // close() is synchronous enough for the HTTP server; do not leave a
    // detached Electron-as-node process behind after SIGTERM.
    setTimeout(() => process.exit(0), 25).unref?.();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("exit", () => runtimePaths.clearDaemonState());

  const bridgeOptions = createHeadlessBridgeOptions(ptyManager, args, hooksManager, memoryStore);
  serverInfo = await startMCPServer(ptyManager, {
    ...bridgeOptions,
    port: args.port,
    _exposeBridge: () => {},
  });

  runtimePaths.writeDaemonState({
    pid: process.pid,
    port: serverInfo.port,
    runtime: process.execPath,
    entry: process.argv[1] || "",
    startedAt: new Date().toISOString(),
  });
  console.log(`[mcp-daemon] Ready on http://127.0.0.1:${serverInfo.port}/mcp (pid ${process.pid})`);
}

main().catch((err) => {
  console.error("[mcp-daemon] Fatal:", err);
  runtimePaths.clearDaemonState();
  process.exit(1);
});
