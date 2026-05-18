import { EventEmitter } from "node:events";
import { execSync, existsSync } from "node:child_process";
import * as nodefs from "node:fs";
import * as nodeos from "node:os";
import * as nodepath from "node:path";
import log from "electron-log/main.js";
import { OutputBuffer } from "./output-buffer";
import { IdleDetector } from "./idle-detector";

const IS_WIN = process.platform === "win32";

const DEFAULT_COLS = 220;
const DEFAULT_ROWS = 50;
const KILL_GRACE_MS = 3000;

export type PaneAgent = "openclaude" | "claude" | "gemini" | "codex" | "shell" | string;

export interface SpawnConfig {
  paneId?: string;
  agent: PaneAgent;
  cwd?: string;
  workspacePath?: string;
  args?: string[];
  session?: Record<string, unknown>;
  claudeSessionId?: string;
  providerId?: string;
  model?: string;
  permissionMode?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  role?: string;
  taskId?: string;
  activityId?: string;
}

export interface PaneInfo {
  paneId: string;
  agent: PaneAgent;
  cwd: string;
  workspacePath?: string;
  args?: string[];
  session?: Record<string, unknown>;
  claudeSessionId?: string;
  providerId?: string;
  model?: string;
}

function defaultShell(): string {
  if (IS_WIN) {
    const comspec = process.env["COMSPEC"];
    if (comspec && nodefs.existsSync(comspec)) return comspec;
    const systemRoot = process.env["SystemRoot"] ?? "C:\\Windows";
    const cmdPath = nodepath.join(systemRoot, "System32", "cmd.exe");
    if (nodefs.existsSync(cmdPath)) return cmdPath;
    return "cmd.exe";
  }
  const shell = process.env["SHELL"] ?? "/bin/bash";
  if (nodefs.existsSync(shell)) return shell;
  return "/bin/bash";
}

const pathCache = new Map<string, string | null>();

const AGENT_DEFAULTS: Record<string, { binary: string; args: string[] }> = {
  openclaude: { binary: "openclaude", args: [] },
  claude: { binary: "openclaude", args: [] },
  gemini: { binary: "openclaude", args: [] },
  codex: { binary: "codex", args: [] },
  shell: { binary: defaultShell(), args: [] },
};

function commonPaths(binary: string): string[] {
  const home = nodeos.homedir();
  if (IS_WIN) {
    const appData = process.env["APPDATA"] ?? `${home}\\AppData\\Roaming`;
    const localAppData = process.env["LOCALAPPDATA"] ?? `${home}\\AppData\\Local`;
    const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
    const roamingNpm = `${home}\\AppData\\Roaming\\npm`;
    const exts = [".cmd", ".exe", ".bat", ""];
    const dirs = [
      roamingNpm,
      `${appData}\\npm`,
      `${localAppData}\\Programs\\${binary}`,
      `${localAppData}\\${binary}\\bin`,
      `${home}\\.local\\bin`,
      `${home}\\.bun\\bin`,
      `${programFiles}\\nodejs`,
      `${programFiles}\\${binary}`,
    ];
    const paths: string[] = [];
    for (const d of dirs) for (const e of exts) paths.push(`${d}\\${binary}${e}`);
    return paths;
  }
  return [
    `${home}/.local/bin/${binary}`,
    `${home}/.claude/local/${binary}`,
    `${home}/.bun/bin/${binary}`,
    `${home}/.npm-global/bin/${binary}`,
    "/opt/homebrew/bin/" + binary,
    "/usr/local/bin/" + binary,
    "/usr/bin/" + binary,
  ];
}

function which(binary: string): string | null {
  if (pathCache.has(binary)) return pathCache.get(binary) ?? null;

  // If already an absolute path, verify existence and return
  if (nodepath.isAbsolute(binary)) {
    if (nodefs.existsSync(binary)) {
      pathCache.set(binary, binary);
      return binary;
    }
    // On Windows, try common extensions if absolute path doesn't have one
    if (IS_WIN && !nodepath.extname(binary)) {
      for (const ext of [".exe", ".cmd", ".bat"]) {
        const withExt = binary + ext;
        if (nodefs.existsSync(withExt)) {
          pathCache.set(binary, withExt);
          return withExt;
        }
      }
    }
  }

  try {
    const cmd = IS_WIN ? `where ${JSON.stringify(binary)}` : `which ${JSON.stringify(binary)}`;
    const result = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const lines = result.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    
    // Windows: prefer known executable extensions to avoid matching extensionless files (like unix scripts)
    const preferred = IS_WIN 
      ? (lines.find((l) => /\.(cmd|exe|bat)$/i.test(l)) ?? lines[0]) 
      : lines[0];

    if (preferred && nodefs.existsSync(preferred)) {
      pathCache.set(binary, preferred);
      return preferred;
    }
  } catch (err) {
    log.warn(`[pty] which(${binary}) failed:`, err instanceof Error ? err.message : String(err));
  }

  if (!IS_WIN) {
    try {
      const shell = process.env["SHELL"] ?? "/bin/bash";
      const result = execSync(`${shell} -lic ${JSON.stringify("command -v " + binary)}`, {
        encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000,
      }).trim();
      if (result && nodefs.existsSync(result)) { pathCache.set(binary, result); return result; }
    } catch {}
  }

  for (const candidate of commonPaths(binary)) {
    if (nodefs.existsSync(candidate)) { pathCache.set(binary, candidate); return candidate; }
  }

  pathCache.set(binary, null);
  return null;
}

export function resolveCommand(agent: PaneAgent, extraArgs: string[] = []): { binary: string; args: string[] } {
  const defaults = AGENT_DEFAULTS[agent] ?? { binary: agent, args: [] };
  const binary = defaults.binary;
  
  if (agent === "shell") {
    const resolvedShell = which(binary) ?? binary;
    return { binary: resolvedShell, args: [...defaults.args, ...extraArgs] };
  }

  const resolved = which(binary);
  if (!resolved) {
    const fallback = defaultShell();
    log.warn(`[pty] binary "${binary}" not found in PATH. Falling back to shell: ${fallback}`);
    return { binary: fallback, args: [] };
  }

  if (IS_WIN && (/\.(cmd|bat)$/i.test(resolved))) {
    // Try .exe variant first (avoids cmd.exe wrapper issues with ConPTY)
    const exePath = resolved.replace(/\.(cmd|bat)$/i, ".exe");
    try {
      if (nodefs.existsSync(exePath)) {
        return { binary: exePath, args: [...defaults.args, ...extraArgs] };
      }
    } catch {}

    // Try node_modules direct path (bypasses .cmd wrapper entirely)
    const scriptName = nodepath.basename(resolved, nodepath.extname(resolved));
    const binDir = nodepath.dirname(resolved);
    const directScript = nodepath.join(binDir, "node_modules", "@gitlawb", scriptName, "bin", scriptName);
    try {
      if (nodefs.existsSync(directScript)) {
        let nodeBinary = which("node");
        if (!nodeBinary && process.env.NODE) {
          nodeBinary = process.env.NODE;
        }
        // Fallback to "node" and let the OS figure it out if all else fails
        if (!nodeBinary) nodeBinary = "node";
        
        return {
          binary: nodeBinary,
          args: [directScript, ...defaults.args, ...extraArgs],
        };
      }
    } catch (e) {
      log.error(`[resolveCommand] direct script resolution error:`, e);
    }

    // Fallback to cmd.exe via defaultShell()
    const comspec = defaultShell();
    return { binary: comspec, args: ["/d", "/c", resolved, ...defaults.args, ...extraArgs] };
  }

  return { binary: resolved, args: [...defaults.args, ...extraArgs] };
}

export function isTerminalAgent(agent: string): boolean {
  return agent === "openclaude" || agent === "claude" || agent === "gemini";
}

interface PaneState {
  pty: unknown; // node-pty IPty
  buffer: OutputBuffer;
  config: SpawnConfig;
  paneId: string;
  exitedAt?: number;
}

export class PtyManager extends EventEmitter {
  private panes = new Map<string, PaneState>();
  private zombieBuffers = new Map<string, { buffer: OutputBuffer; exitedAt: number }>();
  private idleDetector = new IdleDetector();
  // Echo suppression: tracks text sent programmatically that should be suppressed from output
  private pendingEcho = new Map<string, { cleanText: string; consumed: number; time: number }>();

  constructor() {
    super();
    this.idleDetector.on("idle", ({ paneId, lastOutput }: { paneId: string; lastOutput: string[] }) => {
      this.emit("idle", { paneId, idle: { lastOutput } });
    });
    const shutdown = () => {
      process.stderr.write("[pty] Received shutdown signal — killing all panes\n");
      this.killAll();
      process.exit(0);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }

  private reapZombies(): void {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, z] of this.zombieBuffers) {
      if (z.exitedAt < cutoff) this.zombieBuffers.delete(id);
    }
  }

  async spawn(config: SpawnConfig): Promise<string> {
    this.reapZombies();
    // Dynamic import to handle optional pty dependency
    const pty = await import("@lydell/node-pty");
    const { nanoid } = await import("nanoid");
    const paneId = config.paneId ?? nanoid();
    const { binary, args } = resolveCommand(config.agent, config.args ?? []);
    const cwd = config.cwd ?? nodeos.homedir();
    const cols = config.cols ?? DEFAULT_COLS;
    const rows = config.rows ?? DEFAULT_ROWS;

    // Build environment with provider settings if needed
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      TERM: "xterm-256color",
      ...config.env,
    };

    log.info(`[pty:spawn] binary="${binary}" args=[${args.join(", ")}] cwd="${cwd}"`);
    const ptyProcess = pty.spawn(binary, args, { name: "xterm-256color", cols, rows, cwd, env });
    const buffer = new OutputBuffer();

    ptyProcess.onData((data: string) => {
      // Check if this output is an echo of text sent via writeSilent()
      const pending = this.pendingEcho.get(paneId);
      if (pending && Date.now() - pending.time < 10000 && pending.consumed < pending.cleanText.length) {
        const cleanData = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\r/g, "").replace(/\n/g, "");
        if (cleanData.length > 0) {
          // Search for the expected echo text as a substring of cleanData.
          // Readline prefixes the echo with the prompt ("> ") and cursor movement
          // codes, so we can't match from position 0 — we search for the text anywhere.
          const remaining = pending.cleanText.substring(pending.consumed);
          const startIdx = cleanData.indexOf(remaining[0]);
          let matchedCount = 0;
          if (startIdx >= 0) {
            for (let i = 0; i < cleanData.length - startIdx && i < remaining.length; i++) {
              if (cleanData[startIdx + i] === remaining[i]) {
                matchedCount++;
              } else {
                break;
              }
            }
          }
          if (matchedCount > 0) {
            pending.consumed += matchedCount;
            if (pending.consumed >= pending.cleanText.length) {
              this.pendingEcho.delete(paneId);
            }
            // Push to buffer (for pane_read) but signal echo to renderer
            buffer.push(data);
            this.idleDetector.activity(paneId, buffer);
            this.emit("output-echo", paneId, data);
            return;
          }
        }
      }
      buffer.push(data);
      this.idleDetector.activity(paneId, buffer);
      this.emit("output", paneId, data);
    });

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      this.idleDetector.cancel(paneId);
      const state = this.panes.get(paneId);
      if (state) {
        this.zombieBuffers.set(paneId, { buffer: state.buffer, exitedAt: Date.now() });
        this.panes.delete(paneId);
      }
      this.emit("exit", paneId, exitCode);
    });

    this.panes.set(paneId, { pty: ptyProcess, buffer, config, paneId });
    return paneId;
  }

  write(paneId: string, data: string): void {
    const state = this.panes.get(paneId);
    if (!state) return;

    // Split text and newline to avoid race condition on large inputs
    if (data.endsWith('\r')) {
      const text = data.slice(0, -1);
      (state.pty as any).write(text);
      // Using a small timeout to allow the PTY to process the text before the "Enter"
      setTimeout(() => (state.pty as any).write('\r'), 50);
    } else {
      (state.pty as any).write(data);
    }
  }

  /**
   * Write text to PTY stdin while suppressing the echo from the output.
   * The PTY normally echoes stdin back as output — this method tracks the
   * sent text so the onData handler can filter it out from the output events.
   */
  writeSilent(paneId: string, data: string): void {
    const state = this.panes.get(paneId);
    if (!state) return;
    const cleanText = data.replace(/\r/g, "").replace(/\n/g, "");
    if (cleanText.length > 0) {
      this.pendingEcho.set(paneId, { cleanText, consumed: 0, time: Date.now() });
    }
    (state.pty as any).write(data);
  }

  hasPane(paneId: string): boolean {
    return this.panes.has(paneId);
  }

  /**
   * Inject text directly into a pane's output buffer and emit as output.
   * Used for system notifications (e.g., inter-agent messages).
   */
  injectOutput(paneId: string, text: string): void {
    const state = this.panes.get(paneId);
    if (!state) return;
    const data = text + "\r\n";
    state.buffer.push(data);
    this.idleDetector.activity(paneId, state.buffer);
    this.emit("output", paneId, data);
  }

  read(paneId: string, lastN = 50): string[] {
    const state = this.panes.get(paneId);
    if (state) return state.buffer.readPlain(lastN);
    return this.zombieBuffers.get(paneId)?.buffer.readPlain(lastN) ?? [];
  }

  readRaw(paneId: string, lastN = 50): string[] {
    const state = this.panes.get(paneId);
    if (state) return state.buffer.readRaw(lastN);
    return this.zombieBuffers.get(paneId)?.buffer.readRaw(lastN) ?? [];
  }

  readRawText(paneId: string): string {
    const state = this.panes.get(paneId);
    if (state) return state.buffer.readRawText();
    return this.zombieBuffers.get(paneId)?.buffer.readRawText() ?? "";
  }

  kill(paneId: string): void {
    const state = this.panes.get(paneId);
    if (!state) return;
    try { (state.pty as any).kill(); } catch {}
    this.idleDetector.cancel(paneId);
    this.zombieBuffers.set(paneId, { buffer: state.buffer, exitedAt: Date.now() });
    this.panes.delete(paneId);
  }

  resize(paneId: string, cols: number, rows: number): void {
    const state = this.panes.get(paneId);
    if (!state) return;
    try { (state.pty as any).resize(cols, rows); } catch {}
  }

  list(): PaneInfo[] {
    return Array.from(this.panes.values()).map((s) => ({
      paneId: s.paneId,
      agent: s.config.agent,
      cwd: s.config.cwd ?? "",
      workspacePath: s.config.workspacePath,
      args: s.config.args,
      session: s.config.session,
      claudeSessionId: s.config.claudeSessionId,
      providerId: s.config.providerId,
      model: s.config.model,
    }));
  }

  killAll(): void {
    for (const [paneId] of this.panes) {
      this.kill(paneId);
    }
  }
}
