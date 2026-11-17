/**
 * Diário GitLab: coleta os commits do dia nas conexões configuradas, resume com
 * o harness/modelo padrão e grava o mapa neural do dia. Roda sob demanda e por
 * agendamento diário, recuperando os dias em que o app ficou fechado.
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type {
  GitDigest,
  GitDigestCommit,
  GitDigestConfig,
  GitDigestConnection,
  GitDigestListItem,
  GitDigestProject,
  GitDigestStatus,
} from "../../../../src/types/git-digest";
import {
  addDays,
  buildMap,
  buildSummaryPayload,
  dayBounds,
  DEFAULT_CONFIG,
  fallbackThemes,
  localDateKey,
  normalizeConfig,
  normalizeConnection,
  parseSummary,
  scheduleDue,
  SUMMARY_SYSTEM_PROMPT,
  validateDigestDate,
} from "./digest-core";
import { createGitLabClient, normalizeGitLabUrl, validateToken, type FetchLike, type GitLabClient } from "./gitlab-client";
import type { TokenStore } from "./token-store";

export interface GitDigestServiceOptions {
  dir: string;
  tokens: TokenStore;
  /** Executa o modelo escolhido; providerId/model vêm da config salva. */
  summarize: (args: { providerId: string; model: string; systemPrompt: string; input: string }) => Promise<string>;
  onUpdated?: (date: string) => void;
  fetchFn?: FetchLike;
  now?: () => Date;
}

const MAX_COMMITS_WITH_FILES = 150;
const RETRY_AFTER_MS = 60 * 60_000;
const TICK_MS = 5 * 60_000;

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    })
  );
}

export function createGitDigestService(options: GitDigestServiceOptions) {
  const now = options.now ?? (() => new Date());
  const configPath = path.join(options.dir, "config.json");
  const daysDir = path.join(options.dir, "days");
  const attempts = new Map<string, number>();
  let running: string | null = null;
  let lastError: string | null = null;
  let lastRunAt: string | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  function writeJson(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(temp, file);
  }

  function readConfig(): GitDigestConfig {
    try {
      return normalizeConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
    } catch {
      return normalizeConfig(DEFAULT_CONFIG);
    }
  }

  function publicConfig(config = readConfig()): GitDigestConfig {
    return { ...config, connections: config.connections.map((connection) => ({ ...connection, hasToken: options.tokens.has(connection.id) })) };
  }

  const digestPath = (date: string) => path.join(daysDir, `${date}.json`);

  function readDigest(date: string): GitDigest | null {
    try {
      return JSON.parse(fs.readFileSync(digestPath(validateDigestDate(date, now())), "utf8"));
    } catch {
      return null;
    }
  }

  async function collectConnection(connection: GitDigestConnection, client: GitLabClient, date: string, counters: { merges: number }): Promise<GitDigestProject[]> {
    const { start, end } = dayBounds(date);
    const filter = new Set(connection.projects.map((item) => item.toLowerCase()));
    const toCommit = (commit: Awaited<ReturnType<GitLabClient["commits"]>>[number], ref: string | null): GitDigestCommit => ({
      sha: commit.sha,
      shortSha: commit.shortSha,
      title: commit.title,
      message: commit.message,
      authorName: commit.authorName,
      committedAt: commit.committedAt,
      webUrl: commit.webUrl,
      refs: ref ? [ref] : [],
      additions: commit.additions,
      deletions: commit.deletions,
      files: [],
    });
    const inDay = (iso: string) => {
      const at = Date.parse(iso);
      return Number.isFinite(at) && at >= start.getTime() && at < end.getTime();
    };
    const finish = (project: { id: number; path: string; name: string; webUrl: string }, commits: Map<string, GitDigestCommit>): GitDigestProject => ({
      key: `${connection.id}:${project.id}`,
      connectionId: connection.id,
      connectionLabel: connection.label,
      path: project.path,
      name: project.name,
      webUrl: project.webUrl,
      commits: [...commits.values()].sort((a, b) => a.committedAt.localeCompare(b.committedAt)),
    });

    // ── Git inteiro: todos os projetos com atividade, todos os autores, todas as branches ──
    if (connection.scope !== "mine") {
      const active = (await client.activeProjects(start.toISOString())).filter((project) => !filter.size || filter.has(project.path.toLowerCase()));
      const projects: GitDigestProject[] = [];
      await mapLimit(active, 4, async (project) => {
        const commits = new Map<string, GitDigestCommit>();
        for (const commit of await client.commits(project.id, null, start.toISOString(), end.toISOString())) {
          if (!inDay(commit.committedAt) || commits.has(commit.sha)) continue;
          // Merge repete as linhas dos commits originais; fica fora das contas e do mapa.
          if (commit.parentCount > 1) {
            counters.merges += 1;
            continue;
          }
          commits.set(commit.sha, toCommit(commit, null));
        }
        if (commits.size) projects.push(finish(project, commits));
      });
      return projects.sort((a, b) => b.commits.length - a.commits.length);
    }

    // ── Só os meus: pushes do dono do token ──
    const user = await client.currentUser();
    const identity = new Set([...user.emails, ...connection.authorEmails]);
    // Pushes até o fim do dia seguinte: commit feito à noite e enviado de manhã conta no dia em que foi feito.
    const pushEnd = end.getTime() + 86_400_000;
    const events = (await client.pushEvents(addDays(date, -2), addDays(date, 3))).filter((event) => {
      const at = Date.parse(event.createdAt);
      return Number.isFinite(at) && at >= start.getTime() && at < pushEnd;
    });
    const refsByProject = new Map<number, Set<string>>();
    for (const event of events) {
      const refs = refsByProject.get(event.projectId) ?? new Set<string>();
      refs.add(event.ref);
      refsByProject.set(event.projectId, refs);
    }
    const projects: GitDigestProject[] = [];
    for (const [projectId, refs] of refsByProject) {
      const project = await client.project(projectId);
      if (filter.size && !filter.has(project.path.toLowerCase())) continue;
      const commits = new Map<string, GitDigestCommit>();
      for (const ref of refs) {
        for (const commit of await client.commits(projectId, ref, start.toISOString(), end.toISOString())) {
          const mine = identity.has(commit.authorEmail) || identity.has(commit.committerEmail) || (!identity.size && commit.authorName === user.name);
          if (!mine || !inDay(commit.committedAt)) continue;
          const existing = commits.get(commit.sha);
          if (existing) {
            if (!existing.refs.includes(ref)) existing.refs.push(ref);
            continue;
          }
          if (commit.parentCount > 1) {
            counters.merges += 1;
            continue;
          }
          commits.set(commit.sha, toCommit(commit, ref));
        }
      }
      if (commits.size) projects.push(finish(project, commits));
    }
    return projects;
  }

  async function attachFiles(projects: GitDigestProject[], clients: Map<string, GitLabClient>, snippets: Map<string, string>, warnings: string[]) {
    const jobs = projects.flatMap((project) => project.commits.map((commit) => ({ project, commit })));
    let failed = 0;
    await mapLimit(jobs.slice(0, MAX_COMMITS_WITH_FILES), 4, async ({ project, commit }) => {
      const client = clients.get(project.connectionId);
      if (!client) return;
      try {
        const files = await client.commitFiles(Number(project.key.split(":").pop()), commit.sha);
        commit.files = files.map(({ snippet, ...file }) => {
          if (snippet) snippets.set(`${project.key}::${commit.sha}::${file.path}`, snippet);
          return file;
        });
      } catch {
        failed += 1;
      }
    });
    if (failed) warnings.push(`${failed} commit(s) sem lista de arquivos (o GitLab recusou o diff).`);
    if (jobs.length > MAX_COMMITS_WITH_FILES) warnings.push(`Arquivos detalhados só nos primeiros ${MAX_COMMITS_WITH_FILES} de ${jobs.length} commits.`);
  }

  /** Sem modelo: texto corrido montado dos dados, por projeto e por pessoa. */
  function plainSummary(projects: GitDigestProject[]): string {
    const joinNames = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`);
    return projects
      .map((project) => {
        const byAuthor = new Map<string, number>();
        for (const commit of project.commits) byAuthor.set(commit.authorName || "alguém", (byAuthor.get(commit.authorName || "alguém") ?? 0) + 1);
        const people = joinNames([...byAuthor.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name} (${count})`));
        const topics = project.commits.slice(0, 4).map((commit) => commit.title.replace(/^\w+(\([^)]*\))?!?:\s*/, "").trim()).filter(Boolean);
        const more = project.commits.length > topics.length ? `, entre outras ${project.commits.length - topics.length} mudança(s)` : "";
        return `Em ${project.path}, ${people} ${byAuthor.size > 1 ? "fizeram" : "fez"} ${project.commits.length} commit(s): ${topics.join("; ")}${more}.`;
      })
      .join("\n\n");
  }

  async function generate(dateInput?: string): Promise<GitDigest> {
    const date = validateDigestDate(dateInput ?? localDateKey(now()), now());
    if (running) throw new Error(`Já estou gerando o diário de ${running}.`);
    running = date;
    attempts.set(date, Date.now());
    try {
      const config = readConfig();
      const active = config.connections.filter((connection) => connection.enabled && options.tokens.has(connection.id));
      if (!active.length) throw new Error("Nenhuma conexão GitLab ativa com token salvo.");
      const warnings: string[] = [];
      const clients = new Map<string, GitLabClient>();
      const projects: GitDigestProject[] = [];
      let failures = 0;
      const counters = { merges: 0 };
      for (const connection of active) {
        const token = options.tokens.get(connection.id);
        if (!token) {
          failures += 1;
          warnings.push(`${connection.label}: não foi possível decifrar o token; salve-o de novo.`);
          continue;
        }
        try {
          const client = createGitLabClient(connection.baseUrl, token, options.fetchFn);
          clients.set(connection.id, client);
          projects.push(...(await collectConnection(connection, client, date, counters)));
        } catch (err) {
          failures += 1;
          warnings.push(`${connection.label}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      // Todas as conexões falharam: não grava um diário "vazio" que esconderia o erro.
      if (failures === active.length) throw new Error(warnings.join(" ") || "Nenhuma conexão respondeu.");

      const snippets = new Map<string, string>();
      await attachFiles(projects, clients, snippets, warnings);

      const allCommits = projects.flatMap((project) => project.commits);
      const files = new Set(projects.flatMap((project) => project.commits.flatMap((commit) => commit.files.map((file) => `${project.key}::${file.path}`))));
      const stats = {
        commits: allCommits.length,
        projects: projects.length,
        files: files.size,
        additions: allCommits.reduce((sum, commit) => sum + commit.additions, 0),
        deletions: allCommits.reduce((sum, commit) => sum + commit.deletions, 0),
        authors: new Set(allCommits.map((commit) => commit.authorName).filter(Boolean)).size,
        merges: counters.merges,
      };

      const { providerId, model } = config.summarizer;
      const summary: GitDigest["summary"] = {
        headline: stats.commits ? `${stats.commits} commit(s) de ${stats.authors} pessoa(s) em ${stats.projects} projeto(s)` : "Nenhum commit neste dia",
        text: stats.commits ? plainSummary(projects) : "",
        providerId,
        model,
      };
      let themes = fallbackThemes(projects);
      if (stats.commits && providerId && model) {
        try {
          const budget = providerId.startsWith("cli:") ? 100_000 : 60_000;
          const input = buildSummaryPayload(date, projects, config.includeDiffs ? snippets : new Map(), budget);
          const parsed = parseSummary(await options.summarize({ providerId, model, systemPrompt: SUMMARY_SYSTEM_PROMPT, input }), projects);
          if (parsed.headline) summary.headline = parsed.headline;
          if (parsed.text) summary.text = parsed.text;
          themes = parsed.themes;
        } catch (err) {
          summary.error = err instanceof Error ? err.message : String(err);
        }
      } else if (stats.commits) {
        summary.error = "Sem harness/modelo padrão: o texto foi montado direto dos commits. Escolha um harness para um resumo escrito pelo modelo.";
      }

      const digest: GitDigest = {
        date,
        generatedAt: now().toISOString(),
        stats,
        projects,
        summary,
        themes,
        map: buildMap(date, projects, themes),
        warnings,
      };
      writeJson(digestPath(date), digest);
      lastError = null;
      options.onUpdated?.(date);
      return digest;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      running = null;
      lastRunAt = now().toISOString();
    }
  }

  /** Um dia por ciclo: atrasados (ou gerados antes do fim do dia) primeiro, depois hoje no horário. */
  async function tick(): Promise<void> {
    const config = readConfig();
    if (!config.schedule.enabled || running) return;
    if (!config.connections.some((connection) => connection.enabled && options.tokens.has(connection.id))) return;
    const current = now();
    const today = localDateKey(current);
    const recentlyTried = (date: string) => Date.now() - (attempts.get(date) ?? 0) < RETRY_AFTER_MS;
    for (let back = config.schedule.catchUpDays; back >= 1; back -= 1) {
      const date = addDays(today, -back);
      const digest = readDigest(date);
      const partial = !digest || Date.parse(digest.generatedAt) < dayBounds(date).end.getTime();
      if (partial && !recentlyTried(date)) {
        await generate(date).catch(() => undefined);
        return;
      }
    }
    if (scheduleDue(config.schedule.time, current) && !readDigest(today) && !recentlyTried(today))
      await generate(today).catch(() => undefined);
  }

  return {
    getConfig: () => publicConfig(),
    status(): GitDigestStatus {
      return { encryption: options.tokens.status(), running, lastError, lastRunAt };
    },

    saveSettings(raw: any): GitDigestConfig {
      const current = readConfig();
      const next = normalizeConfig({
        ...current,
        summarizer: raw?.summarizer ?? current.summarizer,
        schedule: raw?.schedule ?? current.schedule,
        includeDiffs: raw?.includeDiffs ?? current.includeDiffs,
      });
      writeJson(configPath, next);
      return publicConfig(next);
    },

    /** Cria/atualiza conexão. Token novo é verificado no GitLab antes de ser cifrado e salvo. */
    async upsertConnection(raw: any): Promise<GitDigestConfig> {
      const config = readConfig();
      const existing = config.connections.find((connection) => connection.id === raw?.id);
      if (raw?.id && !existing) throw new Error("Conexão não encontrada.");
      const baseUrl = normalizeGitLabUrl(raw?.baseUrl ?? existing?.baseUrl);
      const tokenInput = typeof raw?.token === "string" && raw.token.trim() ? validateToken(raw.token) : null;
      const id = existing?.id ?? randomUUID();
      const token = tokenInput ?? (existing ? options.tokens.get(existing.id) : null);
      if (!token) throw new Error("Informe o token do GitLab (escopo read_api).");
      const encryption = options.tokens.status();
      if (tokenInput && !encryption.available) throw new Error(encryption.reason);
      const needsCheck = !!tokenInput || !existing || existing.baseUrl !== baseUrl;
      const user = needsCheck ? await createGitLabClient(baseUrl, token, options.fetchFn).currentUser() : null;
      const { token: _secret, hasToken: _has, ...fields } = raw ?? {};
      const connection = normalizeConnection({
        ...existing,
        ...fields,
        id,
        baseUrl,
        username: user?.username ?? existing?.username,
        verifiedAt: user ? now().toISOString() : existing?.verifiedAt,
      });
      if (!connection) throw new Error("Conexão inválida.");
      if (tokenInput) options.tokens.set(id, tokenInput);
      const connections = existing ? config.connections.map((item) => (item.id === id ? connection : item)) : [...config.connections, connection];
      const next = normalizeConfig({ ...config, connections });
      writeJson(configPath, next);
      return publicConfig(next);
    },

    removeConnection(id: unknown): GitDigestConfig {
      const config = readConfig();
      if (typeof id !== "string" || !config.connections.some((connection) => connection.id === id)) throw new Error("Conexão não encontrada.");
      options.tokens.remove(id);
      const next = normalizeConfig({ ...config, connections: config.connections.filter((connection) => connection.id !== id) });
      writeJson(configPath, next);
      return publicConfig(next);
    },

    async testConnection(id: unknown): Promise<{ username: string; name: string }> {
      const connection = readConfig().connections.find((item) => item.id === id);
      if (!connection) throw new Error("Conexão não encontrada.");
      const token = options.tokens.get(connection.id);
      if (!token) throw new Error("Token ausente ou ilegível; salve-o de novo.");
      const user = await createGitLabClient(connection.baseUrl, token, options.fetchFn).currentUser();
      return { username: user.username, name: user.name };
    },

    list(): GitDigestListItem[] {
      let files: string[];
      try {
        files = fs.readdirSync(daysDir).filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file));
      } catch {
        return [];
      }
      return files
        .sort()
        .reverse()
        .slice(0, 400)
        .map((file) => {
          try {
            const digest: GitDigest = JSON.parse(fs.readFileSync(path.join(daysDir, file), "utf8"));
            return { date: digest.date, generatedAt: digest.generatedAt, commits: digest.stats.commits, projects: digest.stats.projects, headline: digest.summary.headline };
          } catch {
            return null;
          }
        })
        .filter((item): item is GitDigestListItem => !!item);
    },

    get: readDigest,
    generate,
    tick,
    start(): void {
      if (timer) return;
      timer = setInterval(() => void tick(), TICK_MS);
      timer.unref?.();
      // Primeira verificação depois do boot, sem disputar a inicialização.
      setTimeout(() => void tick(), 45_000).unref?.();
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}

export type GitDigestService = ReturnType<typeof createGitDigestService>;
