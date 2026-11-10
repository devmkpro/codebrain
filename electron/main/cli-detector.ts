import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { exec, execFile, execSync } from "node:child_process";
import { CLI_REGISTRY, detectHarnesses, harnessSearchPaths } from "./services/spawn/cli-registry";

const IS_WIN = process.platform === "win32";

export interface CliInfo {
  found: boolean;
  path?: string;
  version?: string;
}

export interface AllCliInfo {
  openclaude: CliInfo;
  claude: CliInfo;
  codex: CliInfo;
  gemini: CliInfo;
  kimi: CliInfo;
  cursor: CliInfo;
  copilot: CliInfo;
  kiro?: CliInfo;
  opencode?: CliInfo;
  grok?: CliInfo;
  antigravity?: CliInfo;
  hermes?: CliInfo;
  muse?: CliInfo;
  commandcode?: CliInfo;
  "9router": CliInfo;
  shell: { path: string };
}

function commonPaths(binary: string): string[] {
  const home = os.homedir();
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
  // NVM: scan for the latest installed node version
  const nvmPaths: string[] = [];
  try {
    const nvmVersionsDir = `${home}/.nvm/versions/node`;
    if (fs.existsSync(nvmVersionsDir)) {
      const versions = fs.readdirSync(nvmVersionsDir).sort().reverse();
      for (const v of versions.slice(0, 3)) {
        nvmPaths.push(`${nvmVersionsDir}/${v}/bin/${binary}`);
      }
    }
  } catch {}

  // FNM: scan active multishells
  const fnmPaths: string[] = [];
  try {
    const fnmMultishells = `${home}/.local/share/fnm/multishells`;
    if (fs.existsSync(fnmMultishells)) {
      const shells = fs.readdirSync(fnmMultishells).sort().reverse();
      for (const s of shells.slice(0, 3)) {
        fnmPaths.push(`${fnmMultishells}/${s}/${binary}`);
      }
    }
  } catch {}

  return [
    ...nvmPaths,
    ...fnmPaths,
    `${home}/.volta/bin/${binary}`,
    `${home}/.local/share/pnpm/${binary}`,
    `${home}/.local/bin/${binary}`,
    `${home}/.claude/local/${binary}`,
    `${home}/.bun/bin/${binary}`,
    `${home}/.npm-global/bin/${binary}`,
    "/opt/homebrew/bin/" + binary,
    "/usr/local/bin/" + binary,
    "/usr/bin/" + binary,
  ];
}

function tryWhich(binary: string): string | null {
  // Stage 1: native which/where command
  try {
    const cmd = IS_WIN ? `where ${JSON.stringify(binary)}` : `which ${JSON.stringify(binary)}`;
    const result = execSync(cmd, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    }).trim();
    const lines = result
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const preferred = IS_WIN
      ? (lines.find((l) => /\.(cmd|exe|bat)$/i.test(l)) ?? lines[0])
      : lines[0];
    if (preferred) return preferred;
  } catch {}

  // Stage 2 (Linux/macOS): try command -v in login shell
  if (!IS_WIN) {
    try {
      const shell = process.env["SHELL"] ?? "/bin/bash";
      const result = execSync(`${shell} -lic ${JSON.stringify("command -v " + binary)}`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 3000,
      }).trim();
      if (result && fs.existsSync(result)) return result;
    } catch {}
  }

  // Stage 3: check commonPaths candidates
  for (const candidate of fallbackPaths(binary)) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

function fallbackPaths(binary: string): string[] {
  const searchEnv = {
    ...process.env,
    LOCALAPPDATA: process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
  };
  return [
    ...harnessSearchPaths(binary, process.platform, searchEnv, os.homedir()),
    ...commonPaths(binary),
  ];
}

function runProbe(file: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const options = {
      encoding: "utf8" as const,
      timeout: 3000,
      windowsHide: true,
      maxBuffer: 256 * 1024,
    };
    const done = (error: Error | null, stdout: string) => resolve(error ? null : stdout.trim());
    // Windows cannot execFile a .cmd/.bat shim; names/arguments here come only from the registry.
    if (IS_WIN && /\.(cmd|bat)$/i.test(file)) {
      if (/["\r\n]/.test(file)) return resolve(null);
      exec(`"${file}" ${args.join(" ")}`, options, done);
    } else execFile(file, args, options, done);
  });
}

async function detectCliAsync(binary: string, requireVersion = false): Promise<CliInfo> {
  const output = await runProbe(IS_WIN ? "where.exe" : "which", [binary]);
  const lines = (output ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let found =
    (IS_WIN ? lines.find((line) => /\.(cmd|exe|bat)$/i.test(line)) : lines[0]) ?? lines[0];
  if (!found && !IS_WIN) {
    const candidate = await runProbe(process.env.SHELL || "/bin/bash", [
      "-lic",
      `command -v ${binary}`,
    ]);
    if (candidate && fs.existsSync(candidate)) found = candidate;
  }
  if (!found) found = fallbackPaths(binary).find((candidate) => fs.existsSync(candidate));
  if (!found) return { found: false };
  const version = await runProbe(found, ["--version"]);
  if (requireVersion && !version) return { found: false };
  return { found: true, path: found, ...(version ? { version } : {}) };
}

function tryVersion(binPath: string): string | undefined {
  try {
    return execSync(`"${binPath}" --version`, {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function detectCli(binary: string, requireVersion = false): CliInfo {
  const found = tryWhich(binary);
  if (!found) return { found: false };
  const version = tryVersion(found);
  // For some CLIs (e.g. cursor-agent), the file may exist but not be functional.
  // requireVersion=true means we only report found if --version succeeds.
  if (requireVersion && !version) return { found: false };
  return { found: true, path: found, version };
}

export class CliDetector {
  private cache: AllCliInfo | null = null;
  private pending: Promise<AllCliInfo> | null = null;

  /** Usado no startup/onboarding: processos filhos não bloqueiam o event loop do Electron. */
  redetectAsync(): Promise<AllCliInfo> {
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const entries: Array<readonly [string, CliInfo]> = new Array(CLI_REGISTRY.length);
      let next = 0;
      // A startup refresh must not fan out one child process per harness. Each
      // worker finishes discovery/version checks before taking the next entry.
      await Promise.all(Array.from({ length: Math.min(2, CLI_REGISTRY.length) }, async () => {
        while (next < CLI_REGISTRY.length) {
          const index = next++;
          const entry = CLI_REGISTRY[index];
          let result: CliInfo = { found: false };
          for (const binary of entry.binaries) {
            result = await detectCliAsync(binary, entry.requireVersion);
            if (result.found) break;
          }
          entries[index] = [entry.id, result];
        }
      }));
      const proxy = await detectCliAsync("9router");
      this.cache = {
        ...Object.fromEntries(entries),
        "9router": proxy,
        shell: {
          path: IS_WIN ? process.env.COMSPEC || "cmd.exe" : process.env.SHELL || "/bin/bash",
        },
      } as unknown as AllCliInfo;
      return this.cache;
    })().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  getAllAsync(): Promise<AllCliInfo> {
    return this.pending ?? (this.cache ? Promise.resolve(this.cache) : this.redetectAsync());
  }

  detect(): AllCliInfo {
    const shell = IS_WIN
      ? (process.env["COMSPEC"] ?? "cmd.exe")
      : (process.env["SHELL"] ?? "/bin/bash");
    return {
      ...detectHarnesses(CLI_REGISTRY, detectCli),
      "9router": detectCli("9router"),
      shell: { path: shell },
    } as unknown as AllCliInfo;
  }

  getAll(): AllCliInfo {
    if (!this.cache) this.cache = this.detect();
    return this.cache;
  }

  redetect(): AllCliInfo {
    this.cache = this.detect();
    return this.cache;
  }

  detectShells(): string[] {
    const home = os.homedir();
    const candidates = IS_WIN
      ? ["powershell.exe", "pwsh.exe", "cmd.exe", "wsl.exe"]
      : ["/bin/bash", "/bin/zsh", "/bin/fish", "/usr/bin/bash", "/usr/bin/zsh"];
    return candidates.filter((s) => fs.existsSync(s));
  }
}
