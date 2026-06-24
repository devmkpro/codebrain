import { EventEmitter } from "node:events";
import { execSync } from "node:child_process";
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
  claude: { binary: "claude", args: [] },
  gemini: { binary: "gemini", args: [] },      // Gemini CLI nativo
  "gemini-cli": { binary: "gemini", args: [] }, // alias para gemini
  codex: { binary: "codex", args: [] },
  kimi: { binary: "kimi", args: [] },          // Kimi (Moonshot)
  cursor: { binary: "cursor-agent", args: [] },   // Cursor CLI (installs to %LOCALAPPDATA%\cursor-agent\)
  copilot: { binary: "copilot", args: [] },    // GitHub Copilot
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
    // Scan for node-vX.Y.Z-win-x64 directories in Program Files (npm global bins live there)
    const nodeDirs: string[] = [];
    try {
      const pfEntries = nodefs.readdirSync(programFiles);
      for (const entry of pfEntries) {
        if (/^node-v\d/.test(entry)) nodeDirs.push(`${programFiles}\\${entry}`);
      }
    } catch {}

    const dirs = [
      roamingNpm,
      `${appData}\\npm`,
      `${localAppData}\\Programs\\${binary}`,
      `${localAppData}\\${binary}\\bin`,
      `${localAppData}\\cursor-agent`,           // Cursor CLI installer path (Windows)
      `${home}\\.local\\bin`,
      `${home}\\.bun\\bin`,
      `${programFiles}\\nodejs`,
      `${programFiles}\\${binary}`,
      ...nodeDirs,                               // node-vX.Y.Z-win-x64 (npm global installs)
    ];
    const paths: string[] = [];
    for (const d of dirs) for (const e of exts) paths.push(`${d}\\${binary}${e}`);
    return paths;
  }
  // NVM: scan for the latest installed node version
  const nvmPaths: string[] = [];
  try {
    const nvmVersionsDir = `${home}/.nvm/versions/node`;
    if (nodefs.existsSync(nvmVersionsDir)) {
      const versions = nodefs.readdirSync(nvmVersionsDir).sort().reverse();
      for (const v of versions.slice(0, 3)) {
        nvmPaths.push(`${nvmVersionsDir}/${v}/bin/${binary}`);
      }
    }
  } catch {}

  // FNM: scan active multishells
  const fnmPaths: string[] = [];
  try {
    const fnmMultishells = `${home}/.local/share/fnm/multishells`;
    if (nodefs.existsSync(fnmMultishells)) {
      const shells = nodefs.readdirSync(fnmMultishells).sort().reverse();
      for (const s of shells.slice(0, 3)) {
        fnmPaths.push(`${fnmMultishells}/${s}/${binary}`);
      }
    }
  } catch {}

  // Scan node-vX.Y.Z dirs under /usr/local/lib (some Linux setups)
  const nodeLibPaths: string[] = [];
  try {
    const nodeLib = "/usr/local/lib";
    if (nodefs.existsSync(nodeLib)) {
      for (const entry of nodefs.readdirSync(nodeLib)) {
        if (/^node[_-]?v?\d/.test(entry)) nodeLibPaths.push(`${nodeLib}/${entry}/bin/${binary}`);
      }
    }
  } catch {}

  return [
    ...nvmPaths,
    ...fnmPaths,
    ...nodeLibPaths,
    `${home}/.volta/bin/${binary}`,
    `${home}/.local/share/pnpm/${binary}`,
    `${home}/.local/bin/${binary}`,
    `${home}/.claude/local/${binary}`,
    `${home}/.kimi-code/bin/${binary}`,          // Kimi (macOS/Linux installer)
    `${home}/.cursor-agent/bin/${binary}`,       // Cursor (macOS/Linux installer)
    `${home}/.bun/bin/${binary}`,
    `${home}/.npm-global/bin/${binary}`,
    "/opt/homebrew/bin/" + binary,               // Homebrew (macOS Apple Silicon)
    "/usr/local/bin/" + binary,                  // Homebrew (macOS Intel) + Linux
    "/usr/bin/" + binary,
    "/snap/bin/" + binary,                       // Snap packages (Ubuntu/Linux)
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

  // Windows: Electron may have a stripped PATH — also search the user/system registry PATH
  if (IS_WIN) {
    try {
      const userPath = execSync(
        `reg query "HKCU\\Environment" /v PATH`,
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
      ).match(/PATH\s+REG(?:_EXPAND)?_SZ\s+(.+)/i)?.[1]?.trim() ?? "";
      const sysPath = execSync(
        `reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" /v PATH`,
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
      ).match(/PATH\s+REG(?:_EXPAND)?_SZ\s+(.+)/i)?.[1]?.trim() ?? "";
      const allDirs = [...new Set([userPath, sysPath].join(";").split(";").filter(Boolean))];
      for (const dir of allDirs) {
        for (const ext of [".cmd", ".exe", ".bat", ""]) {
          const candidate = nodepath.join(dir, binary + ext);
          if (nodefs.existsSync(candidate)) {
            pathCache.set(binary, candidate);
            // Also prepend this dir to process.env.PATH so subsequent `where` calls find it
            prependWindowsRuntimePath(candidate);
            return candidate;
          }
        }
      }
    } catch {}
  }

  for (const candidate of commonPaths(binary)) {
    if (nodefs.existsSync(candidate)) { pathCache.set(binary, candidate); return candidate; }
  }

  pathCache.set(binary, null);
  return null;
}

// ── Windows helpers (ported from spawn pattern) ───────────────────────────

/**
 * Quote a single argument for use inside a cmd.exe double-quoted string.
 * Backslashes do NOT need escaping in cmd.exe (unlike Unix shells).
 * Only escape cmd.exe metacharacters: % ^ & | < > ( ) "
 */
function quoteWindowsCmdArg(arg: string): string {
  if (arg.length === 0) return '""';
  // Escape cmd metacharacters EXCEPT backslash (\ is literal in cmd.exe)
  const escaped = arg.replace(/([%^&|<>()"!])/g, "^$1");
  // Wrap in quotes if contains spaces or special chars
  return escaped.includes(" ") || escaped !== arg ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

/**
 * Build cmd.exe args array for running a .cmd/.bat file via `cmd.exe /d /s /c "call \"path\" args"`.
 * Returns string[] for node-pty: ["/d", "/s", "/c", "\"call ...\""]
 *
 * CRITICAL: With /s, cmd.exe strips ONLY the outermost pair of quotes from the /c argument.
 * All inner quotes must use \" and the entire command MUST be wrapped in outer quotes.
 * Without outer quotes, args containing spaces (e.g. JSON --settings) break cmd.exe parsing.
 */
function buildWindowsCmdLine(resolved: string, args: string[]): string[] {
  // Quote path: "C:\path\to\file.cmd"
  const quotedPath = `"${resolved}"`;
  // Quote args that contain spaces with \" escaping for cmd.exe /s
  const quotedArgs = args.map(a => {
    if (!a.includes(" ")) return a;
    // Escape inner quotes for cmd.exe /s context: " → \"
    return `"${a.replace(/"/g, '\\"')}"`;
  });
  const inner = ["call", quotedPath, ...quotedArgs].join(" ");
  // Wrap entire command in outer quotes — cmd.exe /s will strip these
  return ["/d", "/s", "/c", `"${inner.replace(/"/g, '\\"')}"`];
}

/**
 * Read a Windows npm .cmd shim and extract the underlying Node.js script path.
 * Returns null if the shim doesn't follow the standard npm pattern.
 */
function windowsNodeScriptFromShim(shimPath: string): string | null {
  if (!/\.(cmd|bat)$/i.test(shimPath)) return null;
  try {
    const source = nodefs.readFileSync(shimPath, "utf8");
    const shimDir = nodepath.dirname(shimPath);

    // Pattern 1: standard npm shim — `node  "%~dp0\node_modules\pkg\bin\script.js"  %*`
    // Also handles `"%_prog%"  "%dp0%\node_modules\..."` (GitHub Copilot / newer npm pattern)
    const patterns: RegExp[] = [
      // GitHub Copilot / newer npm pattern: "%_prog%"  "%dp0%\node_modules\pkg\file.js" %*
      // or: "%dp0%\node_modules\pkg\file.js" %*
      /"%(?:~)?dp0%?\\([^"\r\n]+\.js)"\s*%\*/i,
      // Standard npm: node  "%~dp0\node_modules\pkg\bin\script.js"  %*
      /node(?:\.exe)?\s+"%(~)?dp0%?\\([^"\r\n]+\.js)"/i,
      // Inline node invocation: "%_prog%"  "%dp0%\path\script.js"
      /"[^"]*node[^"]*"\s+"[^"]*dp0[^"]*\\([^"\r\n]+\.js)"/i,
      // Plain: node  "path\to\script.js"  (absolute or relative)
      /\bnode(?:\.exe)?\s+"([^"\r\n]+\.js)"/i,
      // Plain without quotes: node path/to/script.js
      /\bnode(?:\.exe)?\s+([^\s\r\n"]+\.js)/i,
      // ── Extensionless scripts (e.g. openclaude bin) ──
      // "%_prog%"  "%dp0%\node_modules\@scope\pkg\bin\name" %*  (no .js extension)
      /"%_prog%"\s+"%dp0%\\([^"\r\n]+)"\s*%\*/i,
      // node  "%~dp0\path\to\script"  (extensionless, with quotes)
      /node(?:\.exe)?\s+"%(~)?dp0%?\\([^"\r\n]+)"/i,
      // ── Catch-all: any %dp0%\...path ending in .js (handles NVM4W and other variants) ──
      /%(?:~)?dp0%?\\([^"\r\n]+\.js)/i,
      // Catch-all extensionless: any %dp0%\...path to node_modules\...\bin
      /%(?:~)?dp0%?\\(node_modules\\[^"\r\n]+\\bin[^"\r\n]*)/i,
    ];

    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (!match) continue;
      // Get last capture group (handles optional groups)
      const rawPath = (match[match.length - 1] ?? "")
        .replace(/%(?:~)?dp0%?\\/gi, "")   // strip %dp0%\ and %~dp0\
        .replace(/^\.\//, "");
      if (!rawPath) continue;
      const resolved = nodepath.isAbsolute(rawPath)
        ? rawPath
        : nodepath.join(shimDir, rawPath);
      if (nodefs.existsSync(resolved)) return resolved;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve a Windows .cmd shim to a {binary: node.exe, args: [script.js, ...]} object.
 * Lets us bypass cmd.exe entirely — no quoting/space-in-path issues.
 */
function resolveWindowsNodeShim(shimPath: string, args: string[]): { binary: string; args: string[] } | null {
  const script = windowsNodeScriptFromShim(shimPath);
  if (!script) return null;
  const nodeBinary = which("node") ?? process.env["NODE"] ?? "node";
  return { binary: nodeBinary, args: [script, ...args] };
}

/**
 * Prepend the binary's own directory to the process PATH so sibling tools
 * (node.exe, etc.) are findable at runtime without relying on the user's PATH.
 */
function prependWindowsRuntimePath(resolvedBinary: string): void {
  try {
    const dir = nodepath.dirname(resolvedBinary);
    const current = (process.env["PATH"] ?? "").split(";");
    if (!current.some(p => p.toLowerCase() === dir.toLowerCase())) {
      process.env["PATH"] = [dir, ...current].join(";");
      log.info(`[pty] Prepended to PATH: ${dir}`);
    }
  } catch {}
}

export function resolveCommand(agent: PaneAgent, extraArgs: string[] = []): { binary: string; args: string[]; fellBackToOpenClaude: boolean } {
  const defaults = AGENT_DEFAULTS[agent] ?? { binary: agent, args: [] };
  const binary = defaults.binary;

  if (agent === "shell") {
    const resolvedShell = which(binary) ?? binary;
    return { binary: resolvedShell, args: [...defaults.args, ...extraArgs], fellBackToOpenClaude: false };
  }

  let resolved = which(binary);
  let fellBackToOpenClaude = false;
  if (!resolved && agent === "claude") {
    // Claude CLI not installed — fall back to OpenClaude
    resolved = which("openclaude");
    if (resolved) {
      fellBackToOpenClaude = true;
      log.warn(`[pty] "claude" binary not found, falling back to "openclaude": ${resolved}`);
    }
  }
  if (!resolved && agent === "cursor") {
    // Cursor CLI installs as "cursor-agent" (Windows installer to %LOCALAPPDATA%\cursor-agent\)
    // or as "agent" subcommand on some platforms. Try "agent" as fallback.
    resolved = which("agent");
    if (resolved) log.info(`[pty] cursor: "cursor-agent" not found, using "agent": ${resolved}`);
  }
  // Strip claude-specific CLI flags when falling back to openclaude
  // OpenClaude handles provider routing via env vars, not CLI flags
  if (fellBackToOpenClaude && extraArgs.length > 0) {
    const filtered: string[] = [];
    for (let i = 0; i < extraArgs.length; i++) {
      if (extraArgs[i] === "--provider" || extraArgs[i] === "--model" || extraArgs[i] === "--permission-mode") {
        i++; // skip the flag value
        continue;
      }
      filtered.push(extraArgs[i]);
    }
    extraArgs = filtered;
  }
  if (!resolved) {
    const fallback = defaultShell();
    log.warn(`[pty] binary "${binary}" not found in PATH. Falling back to shell: ${fallback}`);
    return { binary: fallback, args: [], fellBackToOpenClaude: false };
  }

  if (IS_WIN) {
    // Add the binary's directory to PATH so sibling binaries are findable at runtime
    prependWindowsRuntimePath(resolved);

    // Handle the NVM-on-Windows case: `where claude` returns claude.exe directly (not claude.cmd),
    // but the .exe is a Node.js wrapper (no PE32 MZ header) that fails with ERR_UNKNOWN_FILE_EXTENSION
    // when Node.js v24+ tries to import it via the ESM loader.
    // In this case, look for a .cmd shim in the same directory and use that path instead.
    if (/\.exe$/i.test(resolved)) {
      try {
        const buf = Buffer.alloc(2);
        const fd = nodefs.openSync(resolved, "r");
        nodefs.readSync(fd, buf, 0, 2, 0);
        nodefs.closeSync(fd);
        const isNativePE = buf[0] === 0x4d && buf[1] === 0x5a; // "MZ" header
        if (!isNativePE) {
          // Not a native PE32 binary — try to find a .cmd shim in the same directory
          const base = resolved.replace(/\.exe$/i, "");
          const cmdPath = base + ".cmd";
          const batPath = base + ".bat";
          const shimPath = nodefs.existsSync(cmdPath) ? cmdPath : nodefs.existsSync(batPath) ? batPath : null;
          if (shimPath) {
            log.info(`[pty] Non-native .exe detected (no MZ), rerouting to .cmd shim: ${shimPath}`);
            resolved = shimPath;
          } else {
            // No .cmd found — try resolving via node directly using the package's main script
            // Look for the JS entry point in the same bin/ directory
            const binDir = nodepath.dirname(resolved);
            const binName = nodepath.basename(base);
            const jsScript = [
              nodepath.join(binDir, binName + ".js"),
              nodepath.join(binDir, binName),
            ].find(p => nodefs.existsSync(p));
            if (jsScript) {
              const nodeBinary = which("node") ?? process.env["NODE"] ?? "node";
              log.info(`[pty] Non-native .exe, using node script: ${nodeBinary} ${jsScript}`);
              return { binary: nodeBinary, args: [jsScript, ...defaults.args, ...extraArgs], fellBackToOpenClaude };
            }
            log.warn(`[pty] Non-native .exe and no .cmd/.js fallback found: ${resolved}`);
          }
        }
      } catch {}
    }

    if (/\.(cmd|bat)$/i.test(resolved)) {
      // Step 1: try .exe variant (avoids cmd.exe wrapper — faster, no quoting issues)
      // Only use the .exe if it's a genuine native PE32 binary (magic bytes "MZ" = 0x4D 0x5A).
      // Some CLIs (e.g. @anthropic-ai/claude-code on NVM) ship a Node.js wrapper with a .exe
      // extension that fails when spawned directly — Node's ESM loader rejects ".exe" extension.
      const exePath = resolved.replace(/\.(cmd|bat)$/i, ".exe");
      try {
        if (nodefs.existsSync(exePath)) {
          const buf = Buffer.alloc(2);
          const fd = nodefs.openSync(exePath, "r");
          nodefs.readSync(fd, buf, 0, 2, 0);
          nodefs.closeSync(fd);
          const isNativePE = buf[0] === 0x4d && buf[1] === 0x5a; // "MZ" header
          if (isNativePE) {
            return { binary: exePath, args: [...defaults.args, ...extraArgs], fellBackToOpenClaude: false };
          }
          log.info(`[pty] Skipping non-native .exe (no MZ header): ${exePath}`);
        }
      } catch {}

      // Step 1.5: detect .cmd shims that invoke PowerShell (e.g. cursor-agent.cmd → cursor-agent.ps1)
      // Run powershell.exe directly to bypass cmd.exe quoting issues.
      try {
        const shimSrc = nodefs.readFileSync(resolved, "utf8");
        const ps1Match = shimSrc.match(/powershell(?:\.exe)?\s[^"]*"([^"]+\.ps1)"/i);
        if (ps1Match) {
          const ps1Path = ps1Match[1].replace(/%SCRIPT_DIR%|%~dp0[^\\]*/gi, nodepath.dirname(resolved));
          const ps1Resolved = ps1Path.includes("%") ? nodepath.join(nodepath.dirname(resolved), nodepath.basename(ps1Path)) : ps1Path;
          if (nodefs.existsSync(ps1Resolved)) {
            const powershell = `${process.env["SystemRoot"] ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
            log.info(`[pty] Windows PowerShell shim: ${resolved} → powershell ${ps1Resolved}`);
            return { binary: powershell, args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1Resolved, ...defaults.args, ...extraArgs], fellBackToOpenClaude: false };
          }
        }
      } catch {}

      // Step 2: read the .cmd shim to find the underlying Node.js script, run with node.exe directly.
      // This bypasses cmd.exe entirely — no quoting issues, no space-in-path bugs.
      // Pattern: npm-installed CLIs on Windows ship as <name>.cmd shims pointing to <name>.js
      const nodeShim = resolveWindowsNodeShim(resolved, [...defaults.args, ...extraArgs]);
      if (nodeShim) {
        log.info(`[pty] Windows node shim: ${resolved} → node ${nodeShim.args[0]}`);
        return { ...nodeShim, fellBackToOpenClaude: false };
      }

      // Step 3: fallback — run via cmd.exe using `call "path" args` pattern.
      // buildWindowsCmdLine returns string[] ready for node-pty spawn.
      const comspec = process.env["COMSPEC"] ?? "cmd.exe";
      const cmdArgs = buildWindowsCmdLine(resolved, [...defaults.args, ...extraArgs]);
      log.info(`[pty] Windows cmd.exe fallback: ${comspec} ${cmdArgs.join(" ")}`);
      return { binary: comspec, args: cmdArgs, fellBackToOpenClaude: false };
    }
  }

  return { binary: resolved, args: [...defaults.args, ...extraArgs], fellBackToOpenClaude };
}

export function isTerminalAgent(agent: string): boolean {
  return agent === "openclaude" || agent === "claude" || agent === "gemini" || agent === "gemini-cli" || agent === "codex";
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
    const { binary, args, fellBackToOpenClaude } = resolveCommand(config.agent, config.args ?? []);
    const cwd = config.cwd ?? nodeos.homedir();
    const cols = config.cols ?? DEFAULT_COLS;
    const rows = config.rows ?? DEFAULT_ROWS;

    // Build environment with provider settings if needed.
    // On Windows, process.env can be very large (long PATH, Electron vars).
    // Passing the full env to CreateProcess causes error 206 (command line too long).
    // Filter to only essential variables + our provider config.
    const essentialVars = [
      "PATH", "Path", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
      "TEMP", "TMP", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT",
      "NODE", "NODE_PATH", "NVM_DIR", "FNM_DIR", "SHELL",
      "LANG", "LC_ALL", "LC_CTYPE",
      "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "GEMINI_API_KEY", "OPENAI_API_KEY",
      "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY",
      "MIMO_API_KEY", "XAI_API_KEY", "DEEPSEEK_API_KEY",
      "CODEBRAIN_WORKSPACE", "CODEBRAIN_MCP_URL", "CODEBRAIN_MCP_SSE_URL", "CODEBRAIN_MCP_PORT",
      "CLAUDE_CODE_USE_GEMINI", "CLAUDE_CODE_MODEL_NAME", "CLAUDE_CODE_PROVIDER_NAME",
      "CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED", "CLAUDE_CODE_DISABLE_PROXY",
      "GEMINI_BASE_URL", "ANTHROPIC_BASE_URL", "ANTHROPIC_REAL_BASE_URL",
      "OPENAI_BASE_URL",
      "MODEL", "ANTHROPIC_MODEL", "GEMINI_MODEL", "OPENAI_MODEL",
    ];
    const filteredEnv: Record<string, string> = {};
    for (const key of essentialVars) {
      if (process.env[key] !== undefined) {
        filteredEnv[key] = process.env[key] as string;
      }
    }
    const env: Record<string, string> = {
      ...filteredEnv,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      FORCE_COLOR: "1",
      ...config.env,
    };

    const fallbackNote = fellBackToOpenClaude ? " ⚠️ CLAUDE→OPENCLAUDE FALLBACK (claude CLI não instalado)" : "";
    log.info(`[pty:spawn] binary="${binary}" args=[${args.join(", ")}] cwd="${cwd}"${fallbackNote}`);
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
    let textToWrite = data;
    let trailingCr = false;
    if (data.endsWith('\r')) {
      textToWrite = data.slice(0, -1);
      trailingCr = true;
    }

    // ── Chunked write for large pastes ──
    // ConPTY named pipe buffer is ~4-64KB; shell input buffer is ~8KB (cmd.exe).
    // Sending large text as one write causes silent truncation.
    // Split into small chunks with delays so the PTY can process each one.
    const CHUNK_SIZE = 2048;
    const CHUNK_DELAY_MS = 15;

    if (textToWrite.length <= CHUNK_SIZE) {
      // Small write — send directly (no chunking needed)
      (state.pty as any).write(textToWrite);
      if (trailingCr) {
        setTimeout(() => (state.pty as any).write('\r'), 50);
      }
    } else {
      // Large write — chunk with delays to prevent ConPTY buffer overflow
      const chunks: string[] = [];
      for (let i = 0; i < textToWrite.length; i += CHUNK_SIZE) {
        chunks.push(textToWrite.slice(i, i + CHUNK_SIZE));
      }
      let delay = 0;
      for (const chunk of chunks) {
        setTimeout(() => (state.pty as any).write(chunk), delay);
        delay += CHUNK_DELAY_MS;
      }
      if (trailingCr) {
        setTimeout(() => (state.pty as any).write('\r'), delay + 50);
      }
    }
  }

  /**
   * Write text to PTY stdin while suppressing the echo from the output.
   * The PTY normally echoes stdin back as output — this method tracks the
   * sent text so the onData handler can filter it out from the output events.
   *
   * If useBracketedPaste=true, wraps the data in bracketed paste escape codes
   * (\x1b[200~ ... \x1b[201~) so readline treats \n as literal newlines instead
   * of Enter keypresses. This preserves multi-line prompt formatting.
   */
  writeSilent(paneId: string, data: string, useBracketedPaste = false): void {
    const state = this.panes.get(paneId);
    if (!state) return;
    const cleanText = data.replace(/\r/g, "").replace(/\n/g, "");
    if (cleanText.length > 0) {
      this.pendingEcho.set(paneId, { cleanText, consumed: 0, time: Date.now() });
    }
    const payload = useBracketedPaste ? `\x1b[200~${data}\x1b[201~` : data;
    (state.pty as any).write(payload);
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
