import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

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
    const result = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const lines = result.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const preferred = IS_WIN ? (lines.find((l) => /\.(cmd|exe|bat)$/i.test(l)) ?? lines[0]) : lines[0];
    if (preferred) return preferred;
  } catch {}

  // Stage 2 (Linux/macOS): try command -v in login shell
  if (!IS_WIN) {
    try {
      const shell = process.env["SHELL"] ?? "/bin/bash";
      const result = execSync(`${shell} -lic ${JSON.stringify("command -v " + binary)}`, {
        encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000,
      }).trim();
      if (result && fs.existsSync(result)) return result;
    } catch {}
  }

  // Stage 3: check commonPaths candidates
  for (const candidate of commonPaths(binary)) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

function tryVersion(binPath: string): string | undefined {
  try {
    return execSync(`"${binPath}" --version`, {
      encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"],
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

  detect(): AllCliInfo {
    const shell = IS_WIN ? (process.env["COMSPEC"] ?? "cmd.exe") : (process.env["SHELL"] ?? "/bin/bash");
    return {
      openclaude: detectCli("openclaude"),
      claude: detectCli("claude"),
      codex: detectCli("codex"),
      gemini: detectCli("gemini"),
      kimi: detectCli("kimi"),
      cursor: detectCli("cursor-agent", true), // requireVersion — file may exist but not be functional
      copilot: detectCli("copilot"),
      shell: { path: shell },
    };
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
