import { ipcMain } from "electron";
import type { AppContext } from "../context";

export function registerCliHandlers(ctx: AppContext): void {
  ipcMain.handle("cli:detect", () => ctx.cliDetector.getAll());

  ipcMain.handle("cli:redetect", () => {
    const info = ctx.cliDetector.redetect();
    return [
      { name: "openclaude", found: info.openclaude.found, path: info.openclaude.path, version: info.openclaude.version },
      { name: "claude", found: info.claude.found, path: info.claude.path, version: info.claude.version },
      { name: "codex", found: info.codex.found, path: info.codex.path, version: info.codex.version },
      { name: "gemini", found: info.gemini.found, path: info.gemini.path, version: info.gemini.version },
      { name: "kimi", found: info.kimi.found, path: info.kimi.path, version: info.kimi.version },
      { name: "cursor", found: info.cursor.found, path: info.cursor.path, version: info.cursor.version },
      { name: "copilot", found: info.copilot.found, path: info.copilot.path, version: info.copilot.version },
    ];
  });

  ipcMain.handle("cli:install", async () => {
    const { execSync, spawn } = require("node:child_process") as typeof import("node:child_process");
    const IS_WIN = process.platform === "win32";

    let npmPath: string | null = null;
    try {
      const out = execSync(IS_WIN ? "where npm" : "which npm", {
        encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      npmPath = out.split(/\r?\n/)[0]?.trim() || null;
    } catch {
      npmPath = null;
    }

    if (!npmPath) {
      return { ok: false, error: "npm não foi encontrado no PATH. Instale o Node.js em nodejs.org e tente novamente." };
    }

    const TIMEOUT_MS = 120_000;
    return new Promise<{ ok: boolean; error?: string; info?: object }>((resolve) => {
      const child = spawn(
        IS_WIN ? "npm" : npmPath!,
        ["install", "-g", "@gitlawb/openclaude"],
        { stdio: ["ignore", "pipe", "pipe"], shell: IS_WIN },
      );
      let stderr = "";
      let done = false;
      child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        try { child.kill(); } catch {}
        resolve({ ok: false, error: "Timeout: a instalação demorou mais de 2 minutos. Verifique sua conexão e tente novamente." });
      }, TIMEOUT_MS);
      child.on("close", (code: number | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const info = ctx.cliDetector.redetect();
        if (code === 0) {
          resolve({ ok: true, info: { name: "openclaude", found: info.openclaude.found, path: info.openclaude.path, version: info.openclaude.version } });
        } else {
          resolve({ ok: false, error: stderr.trim() || `npm install saiu com código ${code}` });
        }
      });
      child.on("error", (err: Error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ ok: false, error: err.message });
      });
    });
  });

  ipcMain.handle("shells:list", () => ctx.cliDetector.detectShells());
}
