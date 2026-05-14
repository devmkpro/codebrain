import { EventEmitter } from "node:events";
import { execSync, existsSync } from "node:child_process";
import * as nodefs from "node:fs";
import * as nodeos from "node:os";
import * as nodepath from "node:path";
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
  if (IS_WIN) return process.env["COMSPEC"] ?? "cmd.exe";
  return process.env["SHELL"] ?? "/bin/bash";
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
  try {
    const cmd = IS_WIN ? `where ${JSON.stringify(binary)}` : `which ${JSON.stringify(binary)}`;
    const result = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const lines = result.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const preferred = IS_WIN ? (lines.find((l) => /\.(cmd|exe|bat)$/i.test(l)) ?? lines[0]) : lines[0];
    if (preferred) { pathCache.set(binary, preferred); return preferred; }
  } catch {}
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
  if (agent === "shell") return { binary, args: [...defaults.args, ...extraArgs] };
  const resolved = which(binary);
  if (!resolved) {
    const fallback = defaultShell();
    process.stderr.write(`[pty] WARNING: binary "${binary}" not found in PATH. Falling back to ${fallback}\n`);
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
    const directScript = nodepath.join(binDir, "node_modules", `@gitlawb`, scriptName, "bin", scriptName);
    try {
      if (nodefs.existsSync(directScript)) {
        const nodeExe = nodepath.join(binDir, "node.exe");
        return {
          binary: nodefs.existsSync(nodeExe) ? nodeExe : "node",
          args: [directScript, ...defaults.args, ...extraArgs],
        };
      }
    } catch (e) {
      process.stderr.write(`[resolveCommand] direct error: ${e}\n`);
    }

    // Fallback to cmd.exe
    const comspec = process.env["COMSPEC"] ?? "cmd.exe";
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

    const ptyProcess = pty.spawn(binary, args, { name: "xterm-256color", cols, rows, cwd, env });
    const buffer = new OutputBuffer();

    ptyProcess.onData((data: string) => {
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
    (state.pty as any).write(data);
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
