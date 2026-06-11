// Window API exposed by the Electron preload script via contextBridge

export interface AuthStatus {
  authenticated: boolean;
  email?: string;
  reason?: "no_license" | "license_unavailable" | "session_expired" | "auth_failed";
}

export interface PtyConfig {
  paneId?: string;
  agent: string;
  cwd?: string;
  workspacePath?: string;
  args?: string[];
  session?: Session;
  claudeSessionId?: string;
  providerId?: string;
  model?: string;
  permissionMode?: string;
  role?: string;
  sessionContext?: string;
}

export interface PtyInfo {
  paneId: string;
  agent: string;
  cwd: string;
  workspacePath?: string;
  args?: string[];
  session?: Session;
  claudeSessionId?: string;
  providerId?: string;
  model?: string;
}

export interface Session {
  provider: string;
  id: string;
  capturedAt: number;
  confidence: "high" | "medium" | "low";
  source: string;
}

export interface Provider {
  id: string;
  name: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  templateId?: string;
  [key: string]: unknown;
}

export interface ProviderTemplate {
  id: string;
  name: string;
  description?: string;
  fields: ProviderTemplateField[];
}

export interface ProviderTemplateField {
  key: string;
  label: string;
  type: "text" | "password" | "select";
  required?: boolean;
  options?: string[];
}

export interface SessionHistoryEntry {
  id: string;
  pane_id?: string;
  label?: string;
  agent?: string;
  model?: string;
  provider_id?: string;
  workspace?: string;
  started_at?: number;
  ended_at?: number;
  duration_ms?: number;
  exit_code?: number;
  output_preview?: string;
}

export interface Squad {
  id: string;
  name: string;
  description?: string;
  agents: SquadAgent[];
}

export interface SquadAgent {
  id: string;
  agent: string;
  model?: string;
  providerId?: string;
  role?: string;
}

export interface SkillManifest {
  id: string;
  name: string;
  type: "prompt" | "squad";
  version: string;
  description: string;
  author?: string;
  tags?: string[];
  entrypoint: string;
  tools?: string[];
}

export interface Task {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "error";
  workspacePath?: string;
  paneId?: string;
  activityId?: string;
  createdAt: number;
}

export interface TasksState {
  tasks: Task[];
}

export interface WorkspaceConfig {
  [key: string]: unknown;
}

export interface AppConfig {
  theme?: "dark" | "light";
  autoRestore?: boolean;
  notifications?: {
    onTaskComplete?: boolean;
    onMessage?: boolean;
    onBuildResult?: boolean;
  };
  [key: string]: unknown;
}

export interface AudioConfig {
  enabled?: boolean;
  transcribe?: boolean;
  [key: string]: unknown;
}

export interface LogEntry {
  level: string;
  message: string;
  timestamp: string;
  data?: unknown;
}

export interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
}

export interface DownloadProgress {
  percent: number;
  bytesPerSecond: number;
  total: number;
  transferred: number;
}

export interface DiagnosticsSnapshot {
  panes: unknown[];
  processes: unknown[];
  memory: unknown;
  [key: string]: unknown;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  extension?: string;
}

export interface NetworkEntry {
  id: string;
  timestamp: number;
  method: string;
  url: string;
  status: number;
  duration?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  error?: string;
}

export interface ConsoleEntry {
  id: string;
  timestamp: number;
  level: "log" | "warn" | "error";
  message: string;
  source?: string;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementInfo {
  selector: string;
  tag: string;
  role?: string;
  text?: string;
  value?: string;
  href?: string;
  id?: string;
  classes: string[];
  attributes: Record<string, string>;
  bounds: Bounds;
  visible: boolean;
  disabled: boolean;
  checked?: boolean;
  focused: boolean;
}

export interface Annotation {
  type: "box" | "arrow" | "text";
  x: number;
  y: number;
  w?: number;
  h?: number;
  label?: string;
  color?: string;
}

export interface CostModelSummary {
  cost: number;
  inputTokens: number;
  outputTokens: number;
  sessions: number;
}

export interface CostSummaryData {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byModel: Record<string, CostModelSummary>;
  byAgent: Record<string, CostModelSummary>;
}

export interface OAuthStatus {
  github: { connected: boolean; account?: string };
  gitlab: { connected: boolean; account?: string };
}

export interface StoredNotification {
  id: string;
  type: string;
  title: string;
  body?: string;
  level: string;
  mr_id?: number;
  mr_url?: string;
  provider?: string;
  read: boolean;
  created_at: number;
}

export interface CostBudget {
  dailyLimit: number;
  monthlyLimit: number;
  spentToday: number;
  spentMonth: number;
  lastReset: number;
}

export interface CostAlert {
  timestamp: number;
  type: string;
  message: string;
  sessionId?: string;
  cost?: number;
}

export interface CostTaskEntry {
  taskId: string | null;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  sessions: number;
  model: string;
  agentId?: string;
  startedAt: number;
}

export interface CostTaskSummaryData {
  tasks: CostTaskEntry[];
  totalTasks: number;
}

export interface CodebrainApp {
  app: {
    version: () => Promise<string>;
    copyToClipboard: (text: string) => Promise<boolean>;
    readFromClipboard: () => Promise<string>;
    onReloadShortcut: (callback: () => void) => () => void;
    reloadShell: () => Promise<void>;
  };
  auth: {
    status: () => Promise<AuthStatus>;
    profile: () => Promise<{ email: string; [key: string]: unknown }>;
    logout: () => Promise<void>;
    openLogin: () => Promise<void>;
    openSignup: () => Promise<void>;
    openTerms: () => Promise<void>;
    openPrivacy: () => Promise<void>;
    openBilling: () => Promise<void>;
    onAuthSuccess: (callback: (data: { email: string }) => void) => () => void;
    onAuthState: (callback: (state: AuthStatus) => void) => () => void;
    onAuthenticating: (callback: (data: { email: string }) => void) => () => void;
  };
  workspaces: {
    recent: () => Promise<string[]>;
    touch: (path: string) => Promise<void>;
    remove: (path: string) => Promise<void>;
  };
  pty: {
    spawn: (config: PtyConfig) => Promise<string>;
    write: (paneId: string, data: string) => Promise<void>;
    read: (paneId: string, lastN?: number) => Promise<string[]>;
    readRaw: (paneId: string, lastN?: number) => Promise<Uint8Array>;
    readRawText: (paneId: string) => Promise<string>;
    kill: (paneId: string) => Promise<void>;
    hibernate: (paneId: string) => Promise<{ ok: boolean; error?: string }>;
    wake: (paneId: string) => Promise<{ ok: boolean; error?: string }>;
    detach: (paneId: string) => Promise<{ ok: boolean; error?: string }>;
    list: () => Promise<PtyInfo[]>;
    resize: (paneId: string, cols: number, rows: number) => Promise<void>;
    onOutput: (callback: (paneId: string, data: string, echo?: boolean) => void) => () => void;
    onExit: (callback: (paneId: string, exitCode: number) => void) => () => void;
    onPaneAdded: (callback: (info: PtyInfo) => void) => () => void;
    onPaneReattached: (callback: (paneId: string) => void) => () => void;
    onPaneSession: (callback: (info: { paneId: string; session?: Session; claudeSessionId?: string }) => void) => () => void;
  };
  workspace: {
    open: () => Promise<string | null>;
    set: (dir: string) => Promise<void>;
    save: (config: WorkspaceConfig) => Promise<void>;
    scan: (path: string) => Promise<FileEntry[]>;
    detect: (dir?: string) => Promise<{ path: string; autoDetected: boolean; fromRecent?: boolean; fallback?: boolean } | null>;
  };
  session: {
    load: (workspacePath: string) => Promise<unknown>;
    loadAll: (workspacePath: string) => Promise<SessionHistoryEntry[]>;
    clear: (workspacePath: string) => Promise<void>;
    deleteOne: (workspacePath: string, sessionId: string) => Promise<{ ok: boolean; error?: string }>;
    saveSnapshot: (workspacePath: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
    loadSnapshot: (workspacePath: string) => Promise<{ ok: boolean; snapshot?: unknown; error?: string }>;
    export: (opts: { paneId?: string; format: "markdown" | "json"; includeAll?: boolean }) => Promise<{ ok: boolean; path?: string; error?: string }>;
  };
  claude: {
    summary: (sessionId: string) => Promise<string>;
    sessions: (workspacePath: string) => Promise<unknown[]>;
  };
  files: {
    list: (workspacePath: string, subPath?: string) => Promise<FileEntry[]>;
    read: (workspacePath: string, relPath: string) => Promise<string>;
    write: (workspacePath: string, relPath: string, content: string) => Promise<void>;
    pathForFile: (file: File) => string;
    saveDropped: (name: string, bytes: ArrayBuffer) => Promise<string>;
  };
  providers: {
    list: () => Promise<Provider[]>;
    templates: () => Promise<ProviderTemplate[]>;
    save: (provider: Provider) => Promise<{ ok: boolean; error?: string }>;
    delete: (id: string) => Promise<{ ok: boolean; error?: string }>;
    testToken: (args: { providerId: string; token: string }) => Promise<{ ok: boolean; error?: string }>;
    listModels: (args: { baseUrl: string; apiKey: string; type: string }) => Promise<{ ok: boolean; models?: string[]; error?: string }>;
    healthCheck: (args: { baseUrl: string; apiKey: string; type: string; model?: string }) => Promise<{ ok: boolean; status: string; checks: Record<string, unknown>; warnings: string[]; error?: string }>;
    onUpdated: (callback: (providers: Provider[]) => void) => () => void;
  };
  diagnostics: {
    snapshot: () => Promise<DiagnosticsSnapshot>;
    perfSnap: () => Promise<{
      totalRssMB: number;
      electronRssMB: number;
      panesRssMB: number;
      paneCount: number;
      panes: Array<{ paneId: string; agent: string; pid: number | null; rssMB: number; cpu: number }>;
    }>;
  };
  skill: {
    status: () => Promise<{ installed: boolean }>;
    list: () => Promise<string[]>;
    openFolder: () => Promise<void>;
    install: () => Promise<{ ok: boolean; action?: string; path?: string; error?: string }>;
    uninstall: () => Promise<{ ok: boolean; error?: string }>;
    listInstalled: (args?: { type?: string }) => Promise<Array<{ manifest: SkillManifest; path: string }>>;
    get: (args: { id: string }) => Promise<{ ok: boolean; manifest?: SkillManifest; content?: Record<string, string>; error?: string }>;
    installFromRegistry: (args: { id: string }) => Promise<{ ok: boolean; manifest?: SkillManifest; error?: string }>;
    uninstallSkill: (args: { id: string }) => Promise<{ ok: boolean; error?: string }>;
    sync: (args: { direction: "pull" | "push" }) => Promise<{ ok: boolean; results?: Array<{ id: string; action: string; version?: string }>; error?: string }>;
    registryIndex: () => Promise<{ ok: boolean; index?: { skills: SkillManifest[] }; error?: string }>;
    claudeConfigStatus: () => Promise<{ installed: boolean }>;
    installClaudeConfig: () => Promise<{ ok: boolean; path?: string; error?: string }>;
    uninstallClaudeConfig: () => Promise<{ ok: boolean; error?: string }>;
    openClaudeConfigFolder: () => Promise<void>;
  };
  audio: {
    getConfig: () => Promise<AudioConfig>;
    saveConfig: (
      patch: Partial<AudioConfig>,
    ) => Promise<{ ok: boolean; config?: AudioConfig; error?: string }>;
    transcribe: (args: {
      bytes: ArrayBuffer;
      mimeType?: string;
      context?: string;
    }) => Promise<{ ok: boolean; text?: string; error?: string }>;
    hardwareInfo: () => Promise<{
      ok: boolean;
      hardware?: {
        cpuModel: string;
        cpuCores: number;
        totalRamGb: number;
        tier: "strong" | "ok" | "weak";
        recommendation: "local" | "groq";
        reason: string;
        recommendedModel: "tiny" | "base" | "small" | "medium" | "large-v3";
      };
      error?: string;
    }>;
    installWhisper: (args: {
      targetDir?: string;
      model?: "tiny" | "base" | "small" | "medium" | "large-v3";
    }) => Promise<{
      ok: boolean;
      output?: string;
      error?: string;
      warnings?: string[];
      config?: AudioConfig;
    }>;
    onInstallProgress: (cb: (line: string) => void) => () => void;
  };
  workspaceConfig: {
    get: (wsPath: string) => Promise<WorkspaceConfig>;
    set: (wsPath: string, cfg: WorkspaceConfig) => Promise<void>;
  };
  appConfig: {
    get: () => Promise<AppConfig>;
    set: (patch: Partial<AppConfig>) => Promise<void>;
  };
  shells: {
    list: () => Promise<string[]>;
  };
  cli: {
    detect: () => Promise<{ found: boolean; path?: string }>;
    redetect: () => Promise<{ found: boolean; path?: string }>;
    install: () => Promise<{ ok: boolean; error?: string; info?: object }>;
    installCli: (cli: string) => Promise<{ ok: boolean; error?: string; info?: object }>;
  };
  discord: {
    updatePresence: (args: { details: string; state?: string }) => Promise<{ ok: boolean; connected?: boolean; error?: string }>;
    status: () => Promise<{ connected: boolean; clientId: string }>;
    setClientId: (clientId: string) => Promise<{ ok: boolean; error?: string }>;
  };
  tasks: {
    list: () => Promise<Task[]>;
    onUpdated: (cb: (state: TasksState) => void) => () => void;
  };
  squads: {
    list: () => Promise<Squad[]>;
    save: (squad: Squad) => Promise<void>;
    delete: (id: string) => Promise<void>;
  };
  browser: {
    // Navigation
    navigate(url: string, paneId?: string): Promise<{ ok: boolean; finalUrl?: string; title?: string }>;
    open(url: string): Promise<{ ok: boolean; paneId?: string; finalUrl?: string }>;
    back(paneId?: string): Promise<{ ok: boolean }>;
    forward(paneId?: string): Promise<{ ok: boolean }>;
    reload(hard?: boolean, paneId?: string): Promise<{ ok: boolean }>;
    // DOM reading
    getHtml(selector?: string, paneId?: string): Promise<{ ok: boolean; html?: string; lengthChars?: number }>;
    getText(selector?: string, paneId?: string): Promise<{ ok: boolean; text?: string }>;
    getA11yTree(maxDepth?: number, paneId?: string): Promise<{ ok: boolean; tree?: unknown }>;
    findByText(text: string, role?: string, exact?: boolean, paneId?: string): Promise<{ ok: boolean; elements?: ElementInfo[] }>;
    getElement(selector: string, paneId?: string): Promise<{ ok: boolean; element?: ElementInfo }>;
    getUrl(paneId?: string): Promise<{ ok: boolean; url?: string; title?: string }>;
    // DOM interaction
    click(selector: string, paneId?: string): Promise<{ ok: boolean; error?: string }>;
    fill(selector: string, value: string, clearFirst?: boolean, paneId?: string): Promise<{ ok: boolean; error?: string }>;
    select(selector: string, valueOrText: string, paneId?: string): Promise<{ ok: boolean; selectedValue?: string }>;
    check(selector: string, checked?: boolean, paneId?: string): Promise<{ ok: boolean; isChecked?: boolean }>;
    clear(selector: string, paneId?: string): Promise<{ ok: boolean; error?: string }>;
    focus(selector: string, paneId?: string): Promise<{ ok: boolean; error?: string }>;
    hover(selector: string, paneId?: string): Promise<{ ok: boolean; bounds?: Bounds }>;
    // Coordinate interaction
    clickAt(x: number, y: number, button?: string, paneId?: string): Promise<{ ok: boolean; elementAtPoint?: ElementInfo }>;
    hoverAt(x: number, y: number, paneId?: string): Promise<{ ok: boolean; elementAtPoint?: ElementInfo }>;
    drag(x1: number, y1: number, x2: number, y2: number, steps?: number, paneId?: string): Promise<{ ok: boolean }>;
    scroll(selector: string | undefined, direction: string, amount: number, paneId?: string): Promise<{ ok: boolean; scrollY?: number; scrollX?: number }>;
    // Keyboard
    type(text: string, delayMs?: number, paneId?: string): Promise<{ ok: boolean }>;
    key(key: string, paneId?: string): Promise<{ ok: boolean }>;
    shortcut(keys: string, paneId?: string): Promise<{ ok: boolean }>;
    // Wait
    waitFor(selector: string, timeoutMs?: number, paneId?: string): Promise<{ ok: boolean; found?: boolean; timedOut?: boolean; waitedMs?: number }>;
    waitForText(text: string, selector?: string, timeoutMs?: number, paneId?: string): Promise<{ ok: boolean; found?: boolean; timedOut?: boolean }>;
    waitForUrl(pattern: string, timeoutMs?: number, paneId?: string): Promise<{ ok: boolean; matched?: boolean; finalUrl?: string }>;
    waitForLoad(timeoutMs?: number, paneId?: string): Promise<{ ok: boolean; loadTimeMs?: number }>;
    // Screenshots
    screenshot(fullPage?: boolean, paneId?: string): Promise<{ ok: boolean; path?: string }>;
    screenshotElement(selector: string, paneId?: string): Promise<{ ok: boolean; path?: string; bounds?: Bounds }>;
    annotate(screenshotPath: string, annotations: Annotation[]): Promise<{ ok: boolean; path?: string }>;
    // Eval
    eval(js: string, paneId?: string): Promise<{ ok: boolean; result?: unknown; error?: string }>;
    // Logs
    consoleLog(level?: string, sinceMs?: number, limit?: number, paneId?: string): Promise<{ ok: boolean; entries?: ConsoleEntry[]; total?: number }>;
    clearConsole(): Promise<{ ok: boolean }>;
    networkLog(urlFilter?: string, method?: string, status?: string, sinceMs?: number, limit?: number, paneId?: string): Promise<{ ok: boolean; entries?: NetworkEntry[]; total?: number }>;
    networkWait(pattern: string, method?: string, timeoutMs?: number): Promise<{ ok: boolean; entry?: NetworkEntry | null; timedOut?: boolean }>;
    clearNetwork(): Promise<{ ok: boolean }>;
    // Send console entry from renderer to main
    reportConsoleEntry(entry: ConsoleEntry): void;
    // Send network entry from JS interceptor to main process
    reportNetworkEntry(entry: NetworkEntry): void;
    // Register/unregister browser pane IDs with main process
    registerPane(paneId: string, workspacePath?: string): void;
    unregisterPane(paneId: string): void;
    // Events
    onNetworkEntry(cb: (entry: NetworkEntry) => void): () => void;
    onConsoleEntry(cb: (entry: ConsoleEntry) => void): () => void;
  };
  cost: {
    summary: (opts?: { workspace?: string; sessionId?: string; period?: "today" | "week" | "month" | "all" }) => Promise<{ ok: boolean; data?: CostSummaryData }>;
    taskSummary: (opts?: { workspace?: string; period?: "today" | "week" | "month" | "all" }) => Promise<{ ok: boolean; data?: CostTaskSummaryData }>;
    setBudget: (opts: { workspace: string; dailyLimit?: number; monthlyLimit?: number }) => Promise<{ ok: boolean; error?: string }>;
    getBudget: (opts: { workspace: string }) => Promise<{ ok: boolean; data?: CostBudget; error?: string }>;
    getAlerts: (opts?: { limit?: number; type?: string }) => Promise<{ ok: boolean; data?: CostAlert[] }>;
    listModels: () => Promise<{ ok: boolean; data?: Record<string, { input: number; output: number }> }>;
    estimate: (opts: { model: string; inputTokens: number; outputTokens: number }) => Promise<{ ok: boolean; data?: { cost: number }; error?: string }>;
    reset: (opts?: { workspace?: string }) => Promise<{ ok: boolean; cleared?: { sessions: number; alerts: number; budgets: number } }>;
    setModelCost: (opts: { model: string; inputCost: number; outputCost: number }) => Promise<{ ok: boolean; error?: string }>;
    deleteModelCost: (opts: { model: string }) => Promise<{ ok: boolean; error?: string }>;
  };
  oauth: {
    status: () => Promise<{ ok: boolean; data?: OAuthStatus; error?: string }>;
    connect: (args: { provider: "github" | "gitlab"; clientId?: string; clientSecret?: string }) => Promise<{ ok: boolean; account?: string; userCode?: string; verificationUri?: string; error?: string }>;
    disconnect: (args: { provider: "github" | "gitlab" }) => Promise<{ ok: boolean; error?: string }>;
  };
  notifications: {
    list: (opts?: { limit?: number }) => Promise<{ ok: boolean; notifications?: StoredNotification[]; count?: number; error?: string }>;
    count: () => Promise<{ ok: boolean; count?: number; error?: string }>;
    markRead: (args: { id: string }) => Promise<{ ok: boolean; error?: string }>;
    markAllRead: () => Promise<{ ok: boolean; error?: string }>;
    dismiss: (args: { id: string }) => Promise<{ ok: boolean; error?: string }>;
    clear: () => Promise<{ ok: boolean; error?: string }>;
  };
  mrReview: {
    status: () => Promise<{ ok: boolean; reviewing?: boolean; activeWorkspaces?: string[]; allowedWorkspaces?: string[]; autoReview?: boolean; error?: string }>;
    allowed: () => Promise<{ ok: boolean; workspaces?: Array<{ path: string; name: string; allowed: boolean }>; error?: string }>;
    setAllowed: (args: { workspaces: string[] }) => Promise<{ ok: boolean; error?: string }>;
    trigger: (args: { workspace: string }) => Promise<{ ok: boolean; message?: string; error?: string }>;
  };
  notify: (title: string, body: string) => void;
  log: {
    list: (opts?: Record<string, unknown>) => Promise<LogEntry[]>;
    onAppended: (callback: (entry: LogEntry) => void) => () => void;
  };
  update: {
    check: () => Promise<void>;
    install: () => Promise<{ ok: boolean; error?: string }>;
    onChecking: (cb: () => void) => () => void;
    onAvailable: (cb: (data: UpdateInfo) => void) => () => void;
    onNone: (cb: () => void) => () => void;
    onProgress: (cb: (data: DownloadProgress) => void) => () => void;
    onDownloaded: (cb: (data: UpdateInfo) => void) => () => void;
    onError: (cb: (data: { message: string }) => void) => () => void;
    onInstalling: (cb: () => void) => () => void;
  };
}

declare global {
  interface Window {
    codeBrainApp: CodebrainApp;
  }
}
