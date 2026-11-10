import { ipcMain } from "electron";
import type { AppContext } from "../context";
import {
  CLI_REGISTRY,
  buildRegistryView,
  getHarness,
  installRecipes,
  type InstallRecipe,
} from "../services/spawn/cli-registry";

type InstallMethod = InstallRecipe;

// Harness recipes live in the registry; 9router is a proxy, not a harness.
const CLI_INSTALL: Record<string, InstallMethod> = {
  ...installRecipes(),
  "9router": { via: "npm", pkg: "9router" },
};

/** Vendor command for this OS, or null when none is documented. */
function scriptFor(recipe: Extract<InstallMethod, { via: "script" }>): string | null {
  return (process.platform === "win32" ? recipe.win : recipe.unix) ?? null;
}

function findNpm(): string | null {
  const { execSync } = require("node:child_process") as typeof import("node:child_process");
  const IS_WIN = process.platform === "win32";
  try {
    const out = execSync(IS_WIN ? "where npm" : "which npm", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out.split(/\r?\n/)[0]?.trim() || null;
  } catch {
    return null;
  }
}

function runInstallNpm(npmPath: string, pkg: string): Promise<{ ok: boolean; error?: string }> {
  const IS_WIN = process.platform === "win32";
  const { spawn } = require("node:child_process") as typeof import("node:child_process");
  const TIMEOUT_MS = 120_000;

  return new Promise((resolve) => {
    const child = spawn(IS_WIN ? "npm" : npmPath, ["install", "-g", pkg], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: IS_WIN,
    });
    let stderr = "";
    let done = false;
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        child.kill();
      } catch {}
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

function runInstallScript(cmd: string): Promise<{ ok: boolean; error?: string }> {
  const { spawn } = require("node:child_process") as typeof import("node:child_process");
  const TIMEOUT_MS = 120_000;

  return new Promise((resolve) => {
    const child = spawn(cmd, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    } as any);
    let stderr = "";
    let done = false;
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        child.kill();
      } catch {}
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
  ipcMain.handle("cli:detect", () => ctx.cliDetector.getAllAsync());

  ipcMain.handle("cli:redetect", async () => {
    const info = (await ctx.cliDetector.redetectAsync()) as unknown as Record<
      string,
      { found?: boolean; path?: string; version?: string } | undefined
    >;
    return [...CLI_REGISTRY.map((entry) => entry.id as string), "9router"].map((name) => ({
      name,
      found: info[name]?.found ?? false,
      path: info[name]?.path,
      version: info[name]?.version,
    }));
  });

  ipcMain.handle("cli:registry", async () =>
    buildRegistryView(
      (await ctx.cliDetector.getAllAsync()) as unknown as Parameters<typeof buildRegistryView>[0]
    )
  );

  // Legacy: install openclaude only
  ipcMain.handle("cli:install", async () => {
    const npmPath = findNpm();
    if (!npmPath)
      return { ok: false, error: "npm não encontrado no PATH. Instale o Node.js em nodejs.org." };
    const result = await runInstallNpm(npmPath, "@gitlawb/openclaude");
    if (result.ok) {
      const info = await ctx.cliDetector.redetectAsync();
      return {
        ok: true,
        info: {
          name: "openclaude",
          found: info.openclaude.found,
          path: info.openclaude.path,
          version: info.openclaude.version,
        },
      };
    }
    return result;
  });

  // Generic: install any supported CLI by name
  ipcMain.handle("cli:install-cli", async (_event, cli: string) => {
    const recipe = Object.hasOwn(CLI_INSTALL, cli) ? CLI_INSTALL[cli] : undefined;
    if (!recipe) return { ok: false, error: `CLI desconhecido: ${cli}` };

    let result: { ok: boolean; error?: string };

    if (recipe.via === "npm") {
      const npmPath = findNpm();
      if (!npmPath)
        return { ok: false, error: "npm não encontrado no PATH. Instale o Node.js em nodejs.org." };
      result = await runInstallNpm(npmPath, recipe.pkg);
    } else {
      const script = scriptFor(recipe);
      if (!script) {
        const docs = getHarness(cli)?.docsUrl;
        return {
          ok: false,
          error: `Sem instalador automático documentado para este sistema.${docs ? ` Veja ${docs}` : ""}`,
        };
      }
      result = await runInstallScript(script);
    }

    if (result.ok) {
      const info = await ctx.cliDetector.redetectAsync();
      const cliInfo = (info as any)[cli];
      return {
        ok: true,
        info: { name: cli, found: cliInfo?.found, path: cliInfo?.path, version: cliInfo?.version },
      };
    }
    return result;
  });

  // Returns install info for a CLI (method + command shown to user)
  ipcMain.handle("cli:install-info", (_event, cli: string) => {
    const recipe = Object.hasOwn(CLI_INSTALL, cli) ? CLI_INSTALL[cli] : undefined;
    if (!recipe) return null;
    if (recipe.via === "npm") return { via: "npm", cmd: `npm install -g ${recipe.pkg}` };
    const script = scriptFor(recipe);
    if (!script)
      return {
        via: "manual",
        cmd: "",
        description: recipe.description,
        docsUrl: getHarness(cli)?.docsUrl,
      };
    return { via: "script", cmd: script, description: recipe.description };
  });

  // Checks whether a 9Router instance is actually serving requests at baseUrl
  // (self-host default localhost:20128, or a remote/VPS deployment). The
  // "9router" binary being installed just means the CLI exists — the server
  // still needs to be started (`9router`) before providers can route through it.
  ipcMain.handle("cli:ping-9router", async (_event, baseUrl?: string) => {
    const base = (baseUrl?.trim() || "http://localhost:20128").replace(/\/+$/, "");
    try {
      const resp = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(4000) });
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
      const json = (await resp.json().catch(() => null)) as any;
      const count = Array.isArray(json?.data) ? json.data.length : 0;
      return { ok: true, baseUrl: base, modelCount: count };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  ipcMain.handle("shells:list", () => ctx.cliDetector.detectShells());
}
