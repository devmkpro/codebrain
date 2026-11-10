import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { sortModelIds, type ModelReleaseInfo } from "../../../src/lib/model-catalog-order";

// Read-only discovery references (every command is also gated by installed help):
// Codex: https://learn.chatgpt.com/docs/cli/reference#codex-debug-models
// Cursor: https://cursor.com/changelog/cli-jan-08-2026
// OpenCode: https://docs.opencode.ai/docs/cli/#models
// Grok: https://docs.x.ai/build/cli/reference
// Kiro: `kiro-cli chat --help` documents --list-models --format json.
// Claude/Copilot: consume only aliases/choices printed by installed --help.

export const MODEL_CATALOG_TTL_MS = 5 * 60_000;
const FAILURE_BACKOFF_MS = 30_000;
export interface CliModelCatalog {
  models: string[];
  metadata?: ModelReleaseInfo[];
  source: string;
  fetchedAt: number | null;
  attemptedAt: number;
  stale: boolean;
  error?: string;
}
export type ModelCommandRunner = (binary: string, args: readonly string[]) => Promise<string>;

/** Only fixed, non-generative catalog/help commands are passed here. Windows
 * npm shims need cmd.exe; reject its metacharacters instead of interpolating
 * untrusted executable names into a shell. No stdout/stderr is logged. */
export const runModelCommand: ModelCommandRunner = (binary, args) =>
  new Promise((resolve, reject) => {
    let command = binary;
    let argv = [...args];
    if (process.platform === "win32" && /\.(cmd|bat)$/i.test(binary)) {
      if ([binary, ...args].some((value) => /["\r\n&|<>^%!]/.test(value)))
        return reject(new Error("caminho de CLI inválido"));
      command = process.env.ComSpec || "cmd.exe";
      argv = ["/d", "/s", "/c", `"${[binary, ...args].map((value) => `"${value}"`).join(" ")}"`];
    }
    execFile(
      command,
      argv,
      {
        encoding: "utf8",
        timeout: 8000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        cwd: os.tmpdir(),
      },
      (error, stdout) => {
        if (error) reject(new Error("consulta de modelos falhou ou excedeu 8 segundos"));
        else resolve(stdout);
      }
    );
  });

export function parseModelCatalog(
  text: string,
  cli: string
): { models: string[]; metadata: ModelReleaseInfo[] } {
  const clean = text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").trim();
  let raw: any;
  try {
    raw = JSON.parse(clean);
  } catch {
    /* Cursor/OpenCode/Grok also expose plain lists. */
  }
  let entries: any[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.models)
      ? raw.models
      : Array.isArray(raw?.data)
        ? raw.data
        : [];
  if (cli === "kimi" && raw?.models && !Array.isArray(raw.models))
    entries = Object.keys(raw.models).map((id) => ({ id }));
  const metadata: ModelReleaseInfo[] = [];
  const ids: string[] = [];
  for (const entry of entries) {
    if (entry?.hidden || entry?.visibility === "hide") continue;
    const id =
      typeof entry === "string"
        ? entry
        : (entry?.slug ?? entry?.model_id ?? entry?.id ?? entry?.model);
    if (typeof id !== "string" || !/^[a-zA-Z0-9][\w./:+-]*$/.test(id)) continue;
    ids.push(id);
    if (typeof entry === "object")
      metadata.push({
        id,
        created: entry.created,
        created_at: entry.created_at,
        release_date: entry.release_date,
        releaseDate: entry.releaseDate,
        release: typeof entry.release === "object" ? entry.release?.date : entry.release,
        date: entry.date,
      });
  }
  if (!raw && cli !== "codex") {
    for (const line of clean.split(/\r?\n/)) {
      const id = line
        .trim()
        .replace(/^[*•]\s*/, "")
        .split(/\s+(?:-|—|\(|\[)|\s{2,}/)[0];
      if (
        /^[a-zA-Z0-9][\w./:+-]*$/.test(id) &&
        (cli !== "opencode" || id.includes("/")) &&
        (/\d|\//.test(id) || /^(auto|default|opus|sonnet|haiku|fable|grok-build)$/.test(id)) &&
        !/^(available|models?|loading|error|usage|id)$/i.test(id)
      )
        ids.push(id);
    }
  }
  return { models: sortModelIds(ids, metadata), metadata };
}

export function createCliModelCatalog(
  options: {
    run?: ModelCommandRunner;
    now?: () => number;
    cacheFile?: string | null;
    codexHome?: () => string;
  } = {}
) {
  const run = options.run ?? runModelCommand;
  const now = options.now ?? Date.now;
  const file =
    options.cacheFile === undefined
      ? path.join(os.homedir(), ".codebrain", "model-catalog.json")
      : options.cacheFile;
  const cache = new Map<string, CliModelCatalog>();
  const pending = new Map<string, Promise<CliModelCatalog>>();
  try {
    const raw = file ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    for (const [key, value] of Object.entries(raw)) {
      const entry = value as CliModelCatalog;
      if (
        Array.isArray(entry?.models) &&
        entry.models.every((id) => typeof id === "string") &&
        typeof entry.attemptedAt === "number"
      )
        cache.set(key, entry);
    }
  } catch {
    /* First use or corrupt cache. */
  }
  function save() {
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(Object.fromEntries(cache)), "utf8");
      fs.renameSync(temp, file);
    } catch {
      /* Persistence failure must not hide usable discovered models. */
    }
  }
  async function discover(
    cli: string,
    binary: string
  ): Promise<{ models: string[]; metadata?: ModelReleaseInfo[]; source: string; stale?: boolean }> {
    if (cli === "codex") {
      let help = "";
      try {
        help = await run(binary, ["debug", "--help"]);
      } catch {
        /* Older versions can still have a disk catalog. */
      }
      if (/^\s*models\s+/m.test(help)) {
        try {
          const found = parseModelCatalog(await run(binary, ["debug", "models"]), cli);
          if (found.models.length) return { ...found, source: "codex-debug-models" };
        } catch {
          /* Bundled catalog and cache are honest offline fallbacks. */
        }
        try {
          const found = parseModelCatalog(await run(binary, ["debug", "models", "--bundled"]), cli);
          if (found.models.length) return { ...found, source: "codex-bundled", stale: true };
        } catch {}
      }
      const home =
        options.codexHome?.() ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
      const found = parseModelCatalog(
        fs.readFileSync(path.join(home, "models_cache.json"), "utf8"),
        cli
      );
      if (found.models.length) return { ...found, source: "codex-disk-cache", stale: true };
      throw new Error("catálogo Codex indisponível; atualize a CLI ou use um modelo manual");
    }
    const helpArgs = cli === "kiro" ? ["chat", "--help"] : ["--help"];
    const help = await run(binary, helpArgs);
    let args: string[] | null = null;
    if (cli === "kiro" && help.includes("--list-models"))
      args = ["chat", "--list-models", "--format", "json"];
    else if (help.includes("--list-models")) args = ["--list-models"];
    else if (
      ["opencode", "grok"].includes(cli) &&
      /^\s*(?:opencode\s+|grok\s+)?models\b[^\n]*(?:list|available)/im.test(help)
    ) {
      args = ["models"];
      if (cli === "opencode" && (await run(binary, ["models", "--help"])).includes("--refresh"))
        args.push("--refresh");
    } else if (cli === "claude") {
      // The installed CLI documents rolling aliases; no inference or OAuth
      // credential-file scraping is needed to discover those aliases.
      const modelHelp = help.match(/--model\b[\s\S]*?(?=\n\s*--[a-z]|\n\s*-[a-z],|$)/)?.[0] ?? "";
      const aliases = [...modelHelp.matchAll(/['`]([a-z][a-z-]*)['`]/g)].map((match) => match[1]);
      if (aliases.length) return { models: sortModelIds(aliases), source: "claude-help-aliases" };
    } else if (cli === "copilot") {
      const choices = help.match(/--model\b[\s\S]*?\(choices:\s*([^)]+)\)/)?.[1];
      if (choices)
        return {
          models: sortModelIds([...choices.matchAll(/["']([^"']+)["']/g)].map((match) => match[1])),
          source: "copilot-help-choices",
        };
    }
    if (!args)
      throw new Error(
        "esta CLI/versão não tem listagem não interativa validada; use seu seletor nativo ou lista manual"
      );
    const found = parseModelCatalog(await run(binary, args), cli);
    if (!found.models.length) throw new Error("a CLI não retornou IDs de modelos reconhecíveis");
    return { ...found, source: `${cli}-cli` };
  }
  return {
    async refresh(
      cli: string,
      binary: string,
      version = "",
      force = false
    ): Promise<CliModelCatalog> {
      const key = JSON.stringify([
        cli,
        binary,
        version,
        cli === "codex"
          ? (options.codexHome?.() ?? process.env.CODEX_HOME ?? "default")
          : "default",
      ]);
      if (pending.has(key)) return pending.get(key)!;
      const previous = cache.get(key);
      const ttl = previous?.stale ? FAILURE_BACKOFF_MS : MODEL_CATALOG_TTL_MS;
      if (!force && previous && now() - previous.attemptedAt < ttl)
        return {
          ...previous,
          stale:
            previous.stale ||
            !previous.fetchedAt ||
            now() - previous.fetchedAt >= MODEL_CATALOG_TTL_MS,
        };
      const work = (async () => {
        let result: CliModelCatalog;
        try {
          const found = await discover(cli, binary);
          result = {
            ...found,
            ...(found.stale && previous?.models.length
              ? { models: previous.models, metadata: previous.metadata, source: previous.source }
              : {}),
            fetchedAt: found.stale ? (previous?.fetchedAt ?? null) : now(),
            attemptedAt: now(),
            stale: Boolean(found.stale),
            ...(found.stale
              ? { error: "catálogo local/bundled; atualização remota não confirmada" }
              : {}),
          };
        } catch (error) {
          result = {
            models: previous?.models ?? [],
            metadata: previous?.metadata,
            source: previous?.source ?? "unavailable",
            fetchedAt: previous?.fetchedAt ?? null,
            attemptedAt: now(),
            stale: true,
            error:
              error instanceof Error && /^(esta CLI|a CLI|catálogo Codex)/.test(error.message)
                ? error.message
                : "não foi possível atualizar o catálogo desta CLI",
          };
        }
        cache.set(key, result);
        save();
        return result;
      })().finally(() => pending.delete(key));
      pending.set(key, work);
      return work;
    },
  };
}
