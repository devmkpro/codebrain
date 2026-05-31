import { ipcMain } from "electron";
import type { AppContext } from "../context";

type InstallMethod =
  | { via: "npm"; pkg: string }
  | { via: "script"; unix: string; win: string; description: string };

// Install recipe for each CLI
const CLI_INSTALL: Record<string, InstallMethod> = {
  openclaude: { via: "npm", pkg: "@gitlawb/openclaude" },
  codex:      { via: "npm", pkg: "@openai/codex" },
  gemini:     { via: "npm", pkg: "@google/gemini-cli" },
  kimi: {
    via: "script",
    unix: "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash",
    win:  "powershell -ExecutionPolicy Bypass -c \"irm https://code.kimi.com/kimi-code/install.ps1 | iex\"",
    description: "Script oficial do Kimi Code CLI",
  },
};

function findNpm(): string | null {
  const { execSync } = require("node:child_process") as typeof import("node:child_process");
  const IS_WIN = process.platform === "win32";
  try {
    const out = execSync(IS_WIN ? "where npm" : "which npm", {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out.split(/\r?\n/)[0]?.trim() || null;
  } catch {
    return null;
  }
}

function runInstallNpm(
  npmPath: string,
  pkg: string,
): Promise<{ ok: boolean; error?: string }> {
  const IS_WIN = process.platform === "win32";
  const { spawn } = require("node:child_process") as typeof import("node:child_process");
  const TIMEOUT_MS = 120_000;

  return new Promise((resolve) => {
    const child = spawn(
      IS_WIN ? "npm" : npmPath,
      ["install", "-g", pkg],
      { stdio: ["ignore", "pipe", "pipe"], shell: IS_WIN },
    );
    let stderr = "";
    let done = false;
    child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill(); } catch {}
      resolve({ ok: false, error: "Timeout: instalação demorou mais de 2 minutos." });
    }, TIMEOUT_MS);
    child.on("close", (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: stderr.trim() || `npm install saiu com código ${code}` });
    });
    child.on("error", (err: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
  });
}

function runInstallScript(
  recipe: Extract<InstallMethod, { via: "script" }>,
): Promise<{ ok: boolean; error?: string }> {
  const IS_WIN = process.platform === "win32";
  const { spawn } = require("node:child_process") as typeof import("node:child_process");
  const cmd = IS_WIN ? recipe.win : recipe.unix;
  const TIMEOUT_MS = 120_000;

  return new Promise((resolve) => {
    const child = spawn(cmd, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    } as any);
    let stderr = "";
    let done = false;
    child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill(); } catch {}
      resolve({ ok: false, error: "Timeout: instalação demorou mais de 2 minutos." });
    }, TIMEOUT_MS);
    child.on("close", (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: stderr.slice(-500) || `Script saiu com código ${code}` });
    });
    child.on("error", (err: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
  });
}

export function registerCliHandlers(ctx: AppContext): void {
  ipcMain.handle("cli:detect", () => ctx.cliDetector.getAll());

  ipcMain.handle("cli:redetect", () => {
    const info = ctx.cliDetector.redetect();
    return [
      { name: "openclaude", found: info.openclaude.found, path: info.openclaude.path, version: info.openclaude.version },
      { name: "claude",     found: info.claude.found,     path: info.claude.path,     version: info.claude.version },
      { name: "codex",      found: info.codex.found,      path: info.codex.path,      version: info.codex.version },
      { name: "gemini",     found: info.gemini.found,     path: info.gemini.path,     version: info.gemini.version },
      { name: "kimi",       found: info.kimi.found,       path: info.kimi.path,       version: info.kimi.version },
      { name: "cursor",     found: info.cursor.found,     path: info.cursor.path,     version: info.cursor.version },
      { name: "copilot",    found: info.copilot.found,    path: info.copilot.path,    version: info.copilot.version },
    ];
  });

  // Legacy: install openclaude only
  ipcMain.handle("cli:install", async () => {
    const npmPath = findNpm();
    if (!npmPath) return { ok: false, error: "npm não encontrado no PATH. Instale o Node.js em nodejs.org." };
    const result = await runInstallNpm(npmPath, "@gitlawb/openclaude");
    if (result.ok) {
      const info = ctx.cliDetector.redetect();
      return { ok: true, info: { name: "openclaude", found: info.openclaude.found, path: info.openclaude.path, version: info.openclaude.version } };
    }
    return result;
  });

  // Generic: install any supported CLI by name
  ipcMain.handle("cli:install-cli", async (_event, cli: string) => {
    const recipe = CLI_INSTALL[cli];
    if (!recipe) return { ok: false, error: `CLI desconhecido: ${cli}` };

    let result: { ok: boolean; error?: string };

    if (recipe.via === "npm") {
      const npmPath = findNpm();
      if (!npmPath) return { ok: false, error: "npm não encontrado no PATH. Instale o Node.js em nodejs.org." };
      result = await runInstallNpm(npmPath, recipe.pkg);
    } else {
      result = await runInstallScript(recipe);
    }

    if (result.ok) {
      const info = ctx.cliDetector.redetect();
      const cliInfo = (info as any)[cli];
      return { ok: true, info: { name: cli, found: cliInfo?.found, path: cliInfo?.path, version: cliInfo?.version } };
    }
    return result;
  });

  // Returns install info for a CLI (method + command shown to user)
  ipcMain.handle("cli:install-info", (_event, cli: string) => {
    const recipe = CLI_INSTALL[cli];
    if (!recipe) return null;
    const IS_WIN = process.platform === "win32";
    if (recipe.via === "npm") return { via: "npm", cmd: `npm install -g ${recipe.pkg}` };
    return { via: "script", cmd: IS_WIN ? recipe.win : recipe.unix, description: recipe.description };
  });

  ipcMain.handle("shells:list", () => ctx.cliDetector.detectShells());
}
