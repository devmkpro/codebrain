/**
 * Uso por conta de CLI: o que já foi gasto na janela de 5 horas e na de 7 dias.
 *
 * O parsing é puro e testado com fixtures. A leitura em disco é assíncrona e
 * cede o event loop entre arquivos, porque roda no main process.
 */
import { createReadStream } from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";

export interface UsageWindow {
  id: "5h" | "7d";
  label: string;
  usedPct: number | null;
  tokens: number | null;
  resetsAt: number | null;
  source: "medido" | "estimado";
}

export interface ClaudeUsageEntry {
  key: string;
  at: number;
  tokens: number;
}

type WindowId = UsageWindow["id"];
type FetchFn = typeof fetch;

const HOUR_MS = 3_600_000;
const FIVE_HOURS_MS = 5 * HOUR_MS;
const SEVEN_DAYS_MS = 7 * 24 * HOUR_MS;
const LABELS: Record<WindowId, string> = { "5h": "5 horas", "7d": "7 dias" };

const OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_TIMEOUT_MS = 8000;
const MAX_LINE_CHARS = 2_000_000;
const CODEX_TAIL_BYTES = 256 * 1024;
const CODEX_MAX_FILES = 8;

const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

const asNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const clampPct = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;

/** Uma linha de transcript do Claude, ou null se ela não carrega consumo. */
export function parseClaudeUsageLine(line: string): ClaudeUsageEntry | null {
  if (!line.includes('"usage"') || line.length > MAX_LINE_CHARS) return null;
  let row: any;
  try {
    row = JSON.parse(line);
  } catch {
    return null;
  }
  const usage = row?.message?.usage;
  if (!usage || typeof usage !== "object") return null;
  const at = Date.parse(row.timestamp);
  if (!Number.isFinite(at)) return null;
  const tokens =
    asNumber(usage.input_tokens) +
    asNumber(usage.output_tokens) +
    asNumber(usage.cache_creation_input_tokens);
  if (tokens <= 0) return null;
  // O CLI repete a mesma resposta em várias linhas, uma por bloco de conteúdo.
  const key =
    row.message.id && row.requestId
      ? `${row.message.id}:${row.requestId}`
      : `${row.uuid ?? at}:${tokens}`;
  return { key, at, tokens };
}

/** Soma por janela, contando cada resposta uma vez só. */
export function aggregateClaudeUsage(
  entries: Iterable<ClaudeUsageEntry>,
  now: number
): Record<WindowId, number> {
  const unique = new Map<string, ClaudeUsageEntry>();
  for (const entry of entries) {
    if (
      !Number.isFinite(entry.at) ||
      entry.at > now ||
      !Number.isFinite(entry.tokens) ||
      entry.tokens < 0
    )
      continue;
    // Streaming snapshots can precede the final usage for the same response.
    if (entry.tokens > (unique.get(entry.key)?.tokens ?? -1)) unique.set(entry.key, entry);
  }
  const totals: Record<WindowId, number> = { "5h": 0, "7d": 0 };
  for (const entry of unique.values()) {
    const age = now - entry.at;
    if (age > SEVEN_DAYS_MS) continue;
    totals["7d"] += entry.tokens;
    if (age <= FIVE_HOURS_MS) totals["5h"] += entry.tokens;
  }
  return totals;
}

export interface OauthWindow {
  usedPct: number;
  resetsAt: number | null;
}

/** Resposta do endpoint de uso da assinatura. Campo ausente vira null. */
export function parseOauthUsage(json: unknown): Partial<Record<WindowId, OauthWindow>> {
  const parse = (raw: any): OauthWindow | undefined => {
    const usedPct = clampPct(raw?.utilization);
    if (usedPct === null) return undefined;
    const parsed = typeof raw.resets_at === "number" ? raw.resets_at : Date.parse(raw.resets_at);
    return { usedPct, resetsAt: Number.isFinite(parsed) ? parsed : null };
  };
  const body = json as any;
  const result: Partial<Record<WindowId, OauthWindow>> = {};
  const fiveHour = parse(body?.five_hour);
  const sevenDay = parse(body?.seven_day);
  if (fiveHour) result["5h"] = fiveHour;
  if (sevenDay) result["7d"] = sevenDay;
  return result;
}

export function buildClaudeWindows(
  tokens: Record<WindowId, number>,
  oauth: Partial<Record<WindowId, OauthWindow>> | null
): UsageWindow[] {
  return (["5h", "7d"] as const).map((id) => ({
    id,
    label: LABELS[id],
    tokens: tokens[id],
    usedPct: oauth?.[id]?.usedPct ?? null,
    resetsAt: oauth?.[id]?.resetsAt ?? null,
    source: oauth?.[id] ? "medido" : "estimado",
  }));
}

// O id da janela vem da duração: o plano pode trazer só a semanal em `primary`.
function codexWindow(
  raw: any,
  fallback: WindowId,
  now: number,
  eventAt: number
): UsageWindow | null {
  const usedPct = clampPct(raw?.used_percent);
  if (usedPct === null) return null;
  const minutes = asNumber(raw.window_minutes);
  const id: WindowId = minutes > 0 ? (minutes <= 6 * 60 ? "5h" : "7d") : fallback;
  let resetsAt: number | null = null;
  if (typeof raw.resets_at === "number") resetsAt = raw.resets_at * 1000;
  else if (typeof raw.resets_in_seconds === "number" && eventAt)
    resetsAt = eventAt + raw.resets_in_seconds * 1000;
  // A janela já virou desde o último evento: o gasto registrado não vale mais.
  if (resetsAt !== null && resetsAt <= now) {
    return { id, label: LABELS[id], usedPct: 0, tokens: null, resetsAt: null, source: "estimado" };
  }
  return { id, label: LABELS[id], usedPct, tokens: null, resetsAt, source: "medido" };
}

/** Último `token_count` com limites num trecho de sessão do Codex. */
export function parseCodexRateLimits(text: string, now: number): UsageWindow[] | null {
  const lines = text.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.includes('"token_count"') || !line.includes('"rate_limits"')) continue;
    let row: any;
    try {
      row = JSON.parse(line);
    } catch {
      continue; // o trecho pode começar no meio de uma linha
    }
    const limits = row?.payload?.rate_limits ?? row?.rate_limits;
    if (!limits) continue;
    const eventAt = Date.parse(row.timestamp) || 0;
    const windows = [
      codexWindow(limits.primary, "5h", now, eventAt),
      codexWindow(limits.secondary, "7d", now, eventAt),
    ].filter((window): window is UsageWindow => window !== null);
    if (windows.length) return windows.sort((a, b) => a.id.localeCompare(b.id));
  }
  return null;
}

// ── Leitura em disco ────────────────────────────────────────────────────────

interface CachedFile {
  mtimeMs: number;
  size: number;
  entries: ClaudeUsageEntry[];
}

const claudeFileCache = new Map<string, CachedFile>();

async function readClaudeFile(file: string): Promise<ClaudeUsageEntry[]> {
  const entries: ClaudeUsageEntry[] = [];
  const stream = createReadStream(file, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const entry = parseClaudeUsageLine(line);
      if (entry) entries.push(entry);
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  return entries;
}

async function listRecentTranscripts(
  projectsDir: string,
  now: number
): Promise<{ file: string; mtimeMs: number; size: number }[]> {
  const found: { file: string; mtimeMs: number; size: number }[] = [];
  let projects: string[];
  try {
    projects = await fsp.readdir(projectsDir);
  } catch {
    return found;
  }
  for (const project of projects) {
    const dir = path.join(projectsDir, project);
    let names: string[];
    try {
      names = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const file = path.join(dir, name);
      try {
        const stat = await fsp.stat(file);
        if (now - stat.mtimeMs <= SEVEN_DAYS_MS)
          found.push({ file, mtimeMs: stat.mtimeMs, size: stat.size });
      } catch {
        // arquivo removido entre o readdir e o stat
      }
    }
  }
  return found;
}

async function fetchOauthUsage(
  configDir: string,
  fetchFn: FetchFn
): Promise<Partial<Record<WindowId, OauthWindow>> | null> {
  try {
    const raw = await fsp.readFile(path.join(configDir, ".credentials.json"), "utf8");
    const token = JSON.parse(raw)?.claudeAiOauth?.accessToken;
    if (!token) return null;
    const response = await fetchFn(OAUTH_USAGE_URL, {
      headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" },
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return parseOauthUsage(await response.json());
  } catch {
    return null;
  }
}

export async function collectClaudeUsage(
  configDir: string,
  options: { fetchFn?: FetchFn; now?: number } = {}
): Promise<UsageWindow[]> {
  const now = options.now ?? Date.now();
  const projectsDir = path.join(configDir, "projects");
  const files = await listRecentTranscripts(projectsDir, now);
  const current = new Set(files.map((candidate) => candidate.file));
  for (const key of claudeFileCache.keys()) {
    if (key.startsWith(projectsDir + path.sep) && !current.has(key)) claudeFileCache.delete(key);
  }

  const all: ClaudeUsageEntry[] = [];
  for (const { file, mtimeMs, size } of files) {
    let cached = claudeFileCache.get(file);
    if (!cached || cached.mtimeMs !== mtimeMs || cached.size !== size) {
      try {
        cached = { mtimeMs, size, entries: await readClaudeFile(file) };
        claudeFileCache.set(file, cached);
      } catch {
        continue;
      }
    }
    for (const entry of cached.entries) all.push(entry);
    await yieldToLoop();
  }

  const oauth = await fetchOauthUsage(configDir, options.fetchFn ?? fetch);
  return buildClaudeWindows(aggregateClaudeUsage(all, now), oauth);
}

async function readTail(file: string, bytes: number): Promise<string> {
  const handle = await fsp.open(file, "r");
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

const descendingDirs = async (dir: string): Promise<string[]> => {
  try {
    return (await fsp.readdir(dir))
      .filter((name) => /^\d+$/.test(name))
      .sort((a, b) => Number(b) - Number(a));
  } catch {
    return [];
  }
};

async function newestCodexSessions(home: string): Promise<string[]> {
  const root = path.join(home, "sessions");
  const files: string[] = [];
  for (const year of await descendingDirs(root)) {
    for (const month of await descendingDirs(path.join(root, year))) {
      for (const day of await descendingDirs(path.join(root, year, month))) {
        const dir = path.join(root, year, month, day);
        const stamped: { file: string; mtimeMs: number }[] = [];
        let names: string[] = [];
        try {
          names = await fsp.readdir(dir);
        } catch {
          continue;
        }
        for (const name of names) {
          if (!name.endsWith(".jsonl")) continue;
          const file = path.join(dir, name);
          try {
            stamped.push({ file, mtimeMs: (await fsp.stat(file)).mtimeMs });
          } catch {
            // arquivo removido entre o readdir e o stat
          }
        }
        stamped.sort((a, b) => b.mtimeMs - a.mtimeMs);
        files.push(...stamped.map((entry) => entry.file));
        if (files.length >= CODEX_MAX_FILES) return files.slice(0, CODEX_MAX_FILES);
      }
    }
  }
  return files;
}

export async function readCodexRateLimits(
  home: string,
  now: number = Date.now()
): Promise<UsageWindow[]> {
  for (const file of await newestCodexSessions(home)) {
    try {
      const windows = parseCodexRateLimits(await readTail(file, CODEX_TAIL_BYTES), now);
      if (windows) return windows;
    } catch {
      // sessão ilegível: tenta a anterior
    }
    await yieldToLoop();
  }
  return [];
}
