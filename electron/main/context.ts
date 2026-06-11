import { BrowserWindow } from "electron";
import * as path from "node:path";
import * as os from "node:os";
import { app } from "electron";

import { PtyManager } from "./pty-manager";
import { ProviderStore } from "./provider-store";
import { WorkspaceConfigStore } from "./workspace-config-store";
import { ConfigStore } from "./config-store";
import { CliDetector } from "./cli-detector";
import { AudioConfigStore } from "./audio-config-store";
import { HooksManager } from "./services/hooks";
import { createSessionWatchers, type SessionWatcherManager } from "./services/session-watchers";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createMemoryStore } = require("../../packages/memory/store.js");

export interface McpServerInfo {
  port: number;
  sseUrl: string;
  streamableHttpUrl: string;
  close: () => void;
}

export interface PaneConfig {
  agent: string;
  cwd: string;
  args: string[];
  providerId?: string;
  model?: string;
  hasAgent?: boolean;
  role?: string;
  squadOrchestratorWorkerId?: string;
  taskId?: string;
  activityId?: string;
  missionId?: string;
}

export interface PaneRegistryEntry {
  paneId: string;
  cwd: string;
  spawnedAt: number;
}

export interface ProviderHealth {
  providerId: string;
  successCount: number;
  errorCount: number;
  lastError?: string;
  lastErrorAt?: number;
  lastSuccessAt?: number;
  avgLatencyMs?: number;
}

export interface BrowserPendingEntry {
  resolve: (value: unknown) => void;
  timer: NodeJS.Timeout;
}

export interface NetworkLogEntry {
  id: string;
  timestamp: number;
  method: string;
  url: string;
  status: number;
  [key: string]: unknown;
}

export interface ConsoleLogEntry {
  id: string;
  timestamp: number;
  level: string;
  message: string;
  source?: string;
}

export function createAppContext() {
  const DATA_DIR = app.getPath("userData");
  const PROVIDERS_FILE = path.join(DATA_DIR, "providers.json");
  const WORKSPACES_FILE = path.join(DATA_DIR, "recent-workspaces.json");
  const AUDIO_CONFIG_FILE = path.join(DATA_DIR, "audio-config.json");
  const MEMORY_DB_FILE = path.join(DATA_DIR, "memory.db");

  return {
    // Window
    mainWindow: null as BrowserWindow | null,

    // Workspace state
    currentWorkspacePath: os.homedir(),

    // MCP server state
    mcpServerInfo: null as McpServerInfo | null,
    mcpServerReady: null as Promise<McpServerInfo> | null,


    // Pane tracking
    paneConfigs: new Map<string, PaneConfig>(),
    paneRegistry: new Map<string, PaneRegistryEntry>(),
    detachedPaneIds: new Set<string>(),
    hibernatedPanes: new Map<string, PaneConfig & { hibernatedAt: number }>(),

    // Provider health tracking
    providerHealth: new Map<string, ProviderHealth>(),

    // Browser state
    browserPending: new Map<string, BrowserPendingEntry>(),
    browserPaneIds: new Set<string>(),
    browserPaneWorkspace: new Map<string, string>(), // paneId → workspace path
    browserNetworkLog: [] as NetworkLogEntry[],
    browserConsoleLog: [] as ConsoleLogEntry[],

    // Singletons
    ptyManager: new PtyManager(),
    providerStore: new ProviderStore(PROVIDERS_FILE),
    workspaceConfigStore: new WorkspaceConfigStore(),
    configStore: new ConfigStore(),
    cliDetector: new CliDetector(),
    audioConfigStore: new AudioConfigStore(AUDIO_CONFIG_FILE),
    memoryStore: createMemoryStore(MEMORY_DB_FILE),
    hooksManager: new HooksManager(),
    sessionWatchers: null as SessionWatcherManager | null,

    // Paths
    DATA_DIR,
    WORKSPACES_FILE,
    AUDIO_CONFIG_FILE,
  };
}

export type AppContext = ReturnType<typeof createAppContext>;

export function safeSend(ctx: AppContext, channel: string, ...args: unknown[]): void {
  if (ctx.mainWindow && !ctx.mainWindow.isDestroyed() && !ctx.mainWindow.webContents.isDestroyed()) {
    ctx.mainWindow.webContents.send(channel, ...args);
  }
}
