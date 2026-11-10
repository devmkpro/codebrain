import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as nodefs from "node:fs";
import * as nodeos from "node:os";
import * as nodepath from "node:path";
import log from "electron-log/main.js";
import { OutputBuffer } from "./output-buffer";
import { IdleDetector } from "./idle-detector";
import { PtyInputQueue } from "./pty-input";
import { buildPtyEnvironment } from "./pty-environment";
import { waitForTerminalReady, type TerminalReadyOptions, type TerminalReadyResult } from "./services/terminal-prompt";
import { getHarness, harnessAgentDefaults, harnessSearchPaths } from "./services/spawn/cli-registry";
import { briefSummary, shellMetadata, type SpawnBrief, type ShellMetadata } from "./services/spawn/spawn-metadata";

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
  /** Internal, sanitized task metadata. Not the generated submission payload. */
  spawnBrief?: SpawnBrief;
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
  hasInitialPrompt?: boolean;
  initialPromptId?: string;
  promptSubmitted?: boolean;
  promptDeliveryState?: SpawnBrief["delivery"]["state"];
  shell?: ShellMetadata;
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
  ...harnessAgentDefaults(),
  shell: { binary: defaultShell(), args: [] },
};

const KNOWN_BINARIES = new Set([...Object.values(AGENT_DEFAULTS).map((entry) => entry.binary), "node", "agent"]);

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
      const pfEntries = nodefs.readdirSync(programFiles).sort().reverse();
      for (const entry of pfEntries) {
        if (/^node-v\d/.test(entry)) nodeDirs.push(`${programFiles}\\${entry}`);
        if (nodeDirs.length >= 3) break;
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

function executableFile(candidate: string): boolean {
  try {
    if (!nodefs.statSync(candidate).isFile()) return false;
    if (!IS_WIN) nodefs.accessSync(candidate, nodefs.constants.X_OK);
    return true;
  } catch { return false; }
}

/** Deterministic PATH lookup; never runs the binary, a login shell or where.exe. */
function findInPath(binary: string, value: string): string | null {
  const suffixes = IS_WIN && !nodepath.extname(binary)
    ? [...new Set((process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").map((ext) => ext.toLowerCase()).filter((ext) => /^\.(exe|cmd|bat|com)$/.test(ext))), ""]
    : [""];
  const directories = [...new Set(value.split(nodepath.delimiter))].slice(0, 256);
  for (const entry of directories) {
    const dir = entry.trim().replace(/^"|"$/g, "");
    // Do not synchronously probe UNC/device paths, empty PATH entries or cwd.
    if (!dir || !nodepath.isAbsolute(dir) || (IS_WIN && /^\\\\/.test(dir))) continue;
    for (const suffix of suffixes) {
      const candidate = nodepath.join(dir, binary + suffix);
      if (executableFile(candidate)) return candidate;
    }
  }
  return null;
}

function which(binary: string): string | null {
  const cached = pathCache.get(binary);
  if (cached && executableFile(cached)) return cached;
  pathCache.delete(binary);
  const remember = (candidate: string) => { pathCache.set(binary, candidate); return candidate; };

  if (nodepath.isAbsolute(binary) || /[\\/]/.test(binary)) {
    const absolute = nodepath.resolve(binary);
    if (executableFile(absolute)) return remember(absolute);
    if (IS_WIN && !nodepath.extname(absolute)) {
      for (const ext of [".exe", ".cmd", ".bat"]) if (executableFile(absolute + ext)) return remember(absolute + ext);
    }
    return null;
  }

  const fromPath = findInPath(binary, process.env.PATH ?? process.env.Path ?? "");
  if (fromPath) return remember(fromPath);
  for (const candidate of [...harnessSearchPaths(binary), ...commonPaths(binary)]) {
    if (executableFile(candidate)) return remember(candidate);
  }

  // Known harnesses must not synchronously start discovery processes in the UI
  // main thread. A miss is deliberately not cached, so later installation works.
  if (KNOWN_BINARIES.has(binary) || !/^[a-zA-Z0-9_.+-]+$/.test(binary)) return null;

  // Compatibility fallback for custom commands only. Direct argv avoids cmd.exe
  // quoting/profile work; one total budget bounds where + both registry probes.
  const deadline = Date.now() + 750;
  const probe = (executable: string, args: string[]): string => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return "";
    try {
      return execFileSync(executable, args, {
        encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
        timeout: Math.min(250, remaining), windowsHide: true, maxBuffer: 128 * 1024,
      }).trim();
    } catch { return ""; }
  };
  const system32 = nodepath.join(process.env.SystemRoot ?? "C:\\Windows", "System32");
  const discovered = IS_WIN ? probe(nodepath.join(system32, "where.exe"), [binary]) : probe("/usr/bin/which", ["--", binary]);
  for (const candidate of discovered.split(/\r?\n/)) if (candidate && executableFile(candidate)) return remember(candidate);
  if (IS_WIN) {
    for (const key of ["HKCU\\Environment", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"]) {
      const registryPath = probe(nodepath.join(system32, "reg.exe"), ["query", key, "/v", "PATH"])
        .match(/PATH\s+REG(?:_EXPAND)?_SZ\s+(.+)/i)?.[1]?.trim() ?? "";
      const expanded = registryPath.replace(/%([^%]+)%/g, (match, name) => process.env[name] ?? match);
      const result = findInPath(binary, expanded);
      if (result) { prependWindowsRuntimePath(result); return remember(result); }
    }
  } else {
    const shell = process.env.SHELL ?? "/bin/bash";
    const result = probe(shell, ["-lic", `command -v -- ${binary}`]);
    if (result && executableFile(result)) return remember(result);
  }
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
  // When we can't avoid cmd.exe (no .cmd→.js shim available), write a temp .cmd script.
  // Strategy for --settings: Claude CLI accepts `--settings <file-or-json>`.
  // Write the JSON to a temp file and pass the file path — avoids all cmd.exe quoting issues.
  const tmpDir = nodepath.join(nodeos.tmpdir(), "codebrain-cmd");
  if (!nodefs.existsSync(tmpDir)) nodefs.mkdirSync(tmpDir, { recursive: true });
  const tmpScript = nodepath.join(tmpDir, `run-${Date.now()}-${Math.random().toString(36).slice(2)}.cmd`);

  // Separate --settings from other args — write JSON to a temp file
  const settingsIdx = args.indexOf("--settings");
  const settingsJson = settingsIdx >= 0 ? args[settingsIdx + 1] : null;
  const otherArgs = settingsIdx >= 0
    ? args.filter((_, i) => i !== settingsIdx && i !== settingsIdx + 1)
    : args;

  // Write settings JSON to a temp file so cmd.exe can't mangle the quotes
  let settingsFile: string | null = null;
  if (settingsJson) {
    settingsFile = nodepath.join(tmpDir, `settings-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    nodefs.writeFileSync(settingsFile, settingsJson, "utf8");
  }

  const scriptLines = [
    "@echo off",
    `call "${resolved}" ${otherArgs.map(a => `"${a.replace(/"/g, '""')}"`).join(" ")}${settingsFile ? ` --settings "${settingsFile}"` : ""}`,
  ];
  nodefs.writeFileSync(tmpScript, scriptLines.join("\r\n"), "utf8");
  // tmpScript path has no spaces (it's in %TEMP%), so no quoting needed.
  return ["/d", "/s", "/c", tmpScript];
}

/**
 * Cleanup old temp scripts and settings files from %TEMP%/codebrain-cmd/.
 * Removes files older than 1 hour to avoid accumulation while not deleting
 * files that might still be in use by a running process.
 */
function cleanupTempScripts(): void {
  if (!IS_WIN) return;
  const tmpDir = nodepath.join(nodeos.tmpdir(), "codebrain-cmd");
  try {
    if (!nodefs.existsSync(tmpDir)) return;
    const files = nodefs.readdirSync(tmpDir);
    const maxAge = 60 * 60 * 1000; // 1 hour
    const now = Date.now();
    let cleaned = 0;
    for (const file of files) {
      if (/^(run-.*\.cmd|settings-.*\.json)$/.test(file)) {
        const filePath = nodepath.join(tmpDir, file);
        try {
          const stat = nodefs.statSync(filePath);
          if (now - stat.mtimeMs > maxAge) {
            nodefs.unlinkSync(filePath);
            cleaned++;
          }
        } catch { /* ignore individual file errors */ }
      }
    }
    // Remove directory if empty
    if (cleaned > 0) {
      const remaining = nodefs.readdirSync(tmpDir);
      if (remaining.length === 0) nodefs.rmdirSync(tmpDir);
    }
  } catch { /* ignore cleanup errors */ }
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
        .replace(/^\.\//, "")
        .replace(/^"|"$/g, "");              // strip surrounding quotes
      if (!rawPath) continue;
      // Reject .exe files — they may be Node.js SEA wrappers (e.g. claude.exe)
      // that fail with ERR_UNKNOWN_FILE_EXTENSION under Node.js 24+ ESM loader.
      // Only .js and extensionless scripts are valid Node.js entry points.
      if (/\.exe$/i.test(rawPath)) continue;
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

export function resolveCommand(agent: PaneAgent, extraArgs: string[] = []): { binary: string; args: string[]; fellBackToOpenClaude: boolean; unavailable: boolean } {
  const defaults = AGENT_DEFAULTS[agent] ?? { binary: agent, args: [] };
  const binary = defaults.binary;

  if (agent === "shell") {
    const resolvedShell = which(binary) ?? binary;
    return { binary: resolvedShell, args: [...defaults.args, ...extraArgs], fellBackToOpenClaude: false, unavailable: false };
  }

  let resolved = which(binary);
  const fellBackToOpenClaude = false;
  if (!resolved && agent === "cursor") {
    // Cursor CLI installs as "cursor-agent" (Windows installer to %LOCALAPPDATA%\cursor-agent\)
    // or as "agent" subcommand on some platforms. Try "agent" as fallback.
    resolved = which("agent");
    if (resolved) log.info(`[pty] cursor: "cursor-agent" not found, using "agent": ${resolved}`);
  }
  if (!resolved) {
    const fallback = defaultShell();
    log.warn(`[pty] binary "${binary}" not found in PATH.`);
    return { binary: fallback, args: [], fellBackToOpenClaude: false, unavailable: true };
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
              return { binary: nodeBinary, args: [jsScript, ...defaults.args, ...extraArgs], fellBackToOpenClaude, unavailable: false };
            }
            log.warn(`[pty] Non-native .exe and no .cmd/.js fallback found: ${resolved}`);
          }
        }
      } catch {}
    }

    if (/\.(cmd|bat)$/i.test(resolved)) {
      // Step 1: try .exe variant (avoids cmd.exe wrapper — faster, no quoting issues)
      // Some CLIs (e.g. @anthropic-ai/claude-code) ship a Node.js SEA (Single Executable
      // Application) wrapper with a .exe extension. These have MZ headers but are NOT
      // native binaries — they fail with ERR_UNKNOWN_FILE_EXTENSION under Node.js 24+.
      // There's no reliable heuristic to distinguish them from real native PE binaries,
      // so we always prefer the .cmd shim when it exists. The .cmd shim is what npm
      // created and is guaranteed to work.
      // Only try .exe directly if no .cmd/.bat exists (edge case). When both exist,
      // skip the .exe optimization and fall through to the .cmd/node-shim path.

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
            return { binary: powershell, args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1Resolved, ...defaults.args, ...extraArgs], fellBackToOpenClaude: false, unavailable: false };
          }
        }
      } catch {}

      // Step 2: read the .cmd shim to find the underlying Node.js script, run with node.exe directly.
      // This bypasses cmd.exe entirely — no quoting issues, no space-in-path bugs.
      // Pattern: npm-installed CLIs on Windows ship as <name>.cmd shims pointing to <name>.js
      const nodeShim = resolveWindowsNodeShim(resolved, [...defaults.args, ...extraArgs]);
      if (nodeShim) {
        log.info(`[pty] Windows node shim: ${resolved} → node ${nodeShim.args[0]}`);
        return { ...nodeShim, fellBackToOpenClaude: false, unavailable: false };
      }

      // Step 3: fallback — run via cmd.exe using `call "path" args` pattern.
      // buildWindowsCmdLine returns string[] ready for node-pty spawn.
      const comspec = process.env["COMSPEC"] ?? "cmd.exe";
      const cmdArgs = buildWindowsCmdLine(resolved, [...defaults.args, ...extraArgs]);
      log.info(`[pty] Windows cmd.exe fallback: ${comspec} ${cmdArgs.join(" ")}`);
      return { binary: comspec, args: cmdArgs, fellBackToOpenClaude: false, unavailable: false };
    }
  }

  return { binary: resolved, args: [...defaults.args, ...extraArgs], fellBackToOpenClaude, unavailable: false };
}

export function isTerminalAgent(agent: string): boolean {
  return agent === "shell" || agent === "gemini-cli" || Boolean(getHarness(agent));
}

interface PaneState {
  pty: unknown; // node-pty IPty
  buffer: OutputBuffer;
  config: SpawnConfig;
  paneId: string;
  exitedAt?: number;
  shell?: ShellMetadata;
  initialDelivery?: { fingerprint: string; pending?: Promise<TerminalReadyResult>; attempted: boolean; result?: TerminalReadyResult };
}

export class PtyManager extends EventEmitter {
  private panes = new Map<string, PaneState>();
  private zombieBuffers = new Map<string, { buffer: OutputBuffer; exitedAt: number }>();
  private idleDetector = new IdleDetector();
  private inputs = new Map<string, PtyInputQueue>();

  constructor() {
    super();
    cleanupTempScripts();
    this.idleDetector.on("idle", ({ paneId, lastOutput }: { paneId: string; lastOutput: string[] }) => {
      this.emit("idle", { paneId, idle: { lastOutput } });
    });
    // The standalone MCP daemon owns its shutdown sequence so it can close
    // the HTTP server and remove daemon.json before exiting. The regular app
    // keeps the historical signal handling here.
    if (process.env.CODEBRAIN_MANAGED_SIGNALS !== "1") {
      const shutdown = () => {
        process.stderr.write("[pty] Received shutdown signal — killing all panes\n");
        this.killAll();
        process.exit(0);
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    }
  }

  private reapZombies(): void {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, z] of this.zombieBuffers) {
      if (z.exitedAt < cutoff) this.zombieBuffers.delete(id);
    }
  }

  // Trusted argv is a separate main-only argument, never a renderer/IPC config field.
  async spawn(config: SpawnConfig, command?: { binary: string; args: string[] }): Promise<string> {
    this.reapZombies();
    // Dynamic import to handle optional pty dependency
    const pty = await import("@lydell/node-pty");
    const { nanoid } = await import("nanoid");
    const paneId = config.paneId ?? nanoid();
    const { binary, args, fellBackToOpenClaude } = command
      ? { ...command, fellBackToOpenClaude: false }
      : resolveCommand(config.agent, config.args ?? []);
    const cwd = config.cwd ?? nodeos.homedir();
    const cols = config.cols ?? DEFAULT_COLS;
    const rows = config.rows ?? DEFAULT_ROWS;

    // Keep the environment bounded without dropping Windows installer identity.
    const env = buildPtyEnvironment(process.env, config.env);

    const fallbackNote = fellBackToOpenClaude ? " ⚠️ CLAUDE→OPENCLAUDE FALLBACK (claude CLI não instalado)" : "";
    log.info(`[pty:spawn] binary="${binary}" args=[${args.join(", ")}] cwd="${cwd}"${fallbackNote}`);
    const ptyProcess = pty.spawn(binary, args, { name: "xterm-256color", cols, rows, cwd, env });
    const buffer = new OutputBuffer();

    ptyProcess.onData((data: string) => {
      // A TUI redraw is a stateful ANSI stream, not detachable "echo" text.
      // Dropping even a matching prompt frame loses cursor/erase operations.
      buffer.push(data);
      this.idleDetector.activity(paneId, buffer);
      this.emit("output", paneId, data);
    });

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      this.inputs.get(paneId)?.cancel();
      this.inputs.delete(paneId);
      this.idleDetector.cancel(paneId);
      const state = this.panes.get(paneId);
      if (state) {
        this.zombieBuffers.set(paneId, { buffer: state.buffer, exitedAt: Date.now() });
        this.panes.delete(paneId);
      }
      this.emit("exit", paneId, exitCode);
    });

    this.inputs.set(paneId, new PtyInputQueue(
      (text) => ptyProcess.write(text),
      (error) => log.warn(`[pty:write] pane=${paneId}: ${String(error)}`),
    ));
    this.panes.set(paneId, { pty: ptyProcess, buffer, config: { ...config, cols, rows }, paneId, shell: shellMetadata(config.agent, binary) });
    return paneId;
  }

  write(paneId: string, data: string): void {
    this.inputs.get(paneId)?.enqueue(data);
  }

  /** Submit a prompt as one ordered PTY operation (paste, then Enter). */
  submit(paneId: string, data: string): void {
    const state = this.panes.get(paneId);
    if (!state) throw new Error(`pane not found: ${paneId}`);
    const normalized = data.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const input = this.inputs.get(paneId)!;
    // Give the TUI an event-loop turn to consume Paste before the Enter event.
    input.enqueue(`\x1b[200~${normalized}\x1b[201~`, 150);
    input.enqueue("\r");
  }

  /** Wait/retry observation only. A native paste/Enter is never retried automatically. */
  async submitWhenReady(
    paneId: string,
    data: string,
    options: TerminalReadyOptions = {},
  ): Promise<TerminalReadyResult> {
    const state = this.panes.get(paneId);
    if (!state) return { ok: false, promptSubmitted: false, deliveryState: "not_submitted", waitedMs: 0, error: "O terminal encerrou antes de aceitar o prompt." };
    const fingerprint = createHash("sha256").update(data).digest("hex");
    const previous = state.initialDelivery;
    if (previous?.fingerprint === fingerprint && previous.pending) return previous.pending;
    if (previous?.attempted) {
      if (previous.fingerprint === fingerprint && previous.result) return previous.result;
      return { ok: false, promptSubmitted: false, deliveryState: "uncertain", waitedMs: 0, error: "Já houve uma tentativa de envio neste pane; releia o terminal antes de reenviar." };
    }
    if (previous?.pending) return { ok: false, promptSubmitted: false, deliveryState: "not_submitted", waitedMs: 0, error: "Outro prompt já está aguardando prontidão neste pane." };
    const delivery: NonNullable<PaneState["initialDelivery"]> = { fingerprint, attempted: false };
    state.initialDelivery = delivery;
    const startedAt = Date.now();
    const brief = state.config.spawnBrief;
    if (brief) brief.delivery = { state: "pending", promptSubmitted: false };
    delivery.pending = (async () => {
      let result: TerminalReadyResult;
      const ready = await waitForTerminalReady(
        () => state.buffer.readRawText(),
        () => this.panes.get(paneId) === state,
        { ...options, agent: state.config.agent },
      );
      if (!ready.ok) result = { ...ready, promptSubmitted: false, deliveryState: "not_submitted" };
      else {
        try {
          const input = this.inputs.get(paneId);
          if (this.panes.get(paneId) !== state || !input) throw new Error("Terminal input closed.");
          delivery.attempted = true;
          const normalized = data.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
          input.enqueue(`\x1b[200~${normalized}\x1b[201~`, 150);
          await input.enqueueAndWait("\r");
          result = { ...ready, waitedMs: Date.now() - startedAt, promptSubmitted: true, deliveryState: "submitted" };
        } catch {
          // Native write may have partly succeeded: never blind-retry this payload.
          result = { ...ready, ok: false, waitedMs: Date.now() - startedAt, promptSubmitted: false,
            deliveryState: delivery.attempted ? "uncertain" : "not_submitted",
            error: "Não foi possível confirmar o envio de Enter ao terminal. Releia o pane antes de reenviar." };
        }
      }
      if (brief) brief.delivery = { state: result.deliveryState!, promptSubmitted: result.promptSubmitted === true, ...(result.error ? { error: result.error } : {}) };
      delivery.result = result;
      delivery.pending = undefined;
      return result;
    })();
    return delivery.pending;
  }

  /**
   * Programmatic input (historical name retained for bridge compatibility).
   * Never filter PTY output: prompt redraws also contain ANSI cursor state.
   *
   * If useBracketedPaste=true, wraps the data in bracketed paste escape codes
   * (\x1b[200~ ... \x1b[201~) so readline treats \n as literal newlines instead
   * of Enter keypresses. This preserves multi-line prompt formatting.
   */
  writeSilent(paneId: string, data: string, useBracketedPaste = false): void {
    const payload = useBracketedPaste ? `\x1b[200~${data}\x1b[201~` : data;
    this.write(paneId, payload);
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
    this.inputs.get(paneId)?.cancel();
    this.inputs.delete(paneId);
    try { (state.pty as any).kill(); } catch {}
    this.idleDetector.cancel(paneId);
    this.zombieBuffers.set(paneId, { buffer: state.buffer, exitedAt: Date.now() });
    this.panes.delete(paneId);
  }

  resize(paneId: string, cols: number, rows: number): void {
    const state = this.panes.get(paneId);
    if (!state) return;
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 1) return;
    if (state.config.cols === cols && state.config.rows === rows) return;
    try {
      (state.pty as any).resize(cols, rows);
      state.config.cols = cols;
      state.config.rows = rows;
    } catch {}
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
      ...briefSummary(s.config.spawnBrief),
      ...(s.shell ? { shell: s.shell } : {}),
    }));
  }

  setSession(paneId: string, session: Record<string, unknown>): void {
    const state = this.panes.get(paneId);
    if (state) state.config.session = session;
  }

  /** Explicit bounded read-back; never included in list(). */
  getSpawnBrief(paneId: string): SpawnBrief | undefined {
    const brief = this.panes.get(paneId)?.config.spawnBrief;
    return brief ? { ...brief, delivery: { ...brief.delivery } } : undefined;
  }

  /**
   * PID do processo do terminal, ou null se o pane não existe.
   *
   * O HUD de performance (`diagnostics:perfSnap`) já chamava isto como
   * `getPid?.(paneId)`, mas o método nunca existiu — o encadeamento opcional
   * fazia a chamada virar `undefined` calada, e a coluna de PID aparecia
   * vazia para todo pane desde sempre.
   */
  getPid(paneId: string): number | null {
    const state = this.panes.get(paneId);
    if (!state) return null;
    const pid = (state.pty as { pid?: number }).pid;
    return typeof pid === "number" ? pid : null;
  }

  killAll(): void {
    for (const [paneId] of this.panes) {
      this.kill(paneId);
    }
  }
}
