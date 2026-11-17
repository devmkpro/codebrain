/**
 * Cliente mínimo da API v4 do GitLab (gitlab.com ou self-hosted). O token só
 * existe no main process e nunca segue um redirecionamento: `fetch` repassaria
 * o cabeçalho PRIVATE-TOKEN para outro host.
 */
import * as net from "node:net";

export interface GitLabUser {
  id: number;
  username: string;
  name: string;
  emails: string[];
}

export interface GitLabPushEvent {
  projectId: number;
  ref: string;
  createdAt: string;
}

export interface GitLabProject {
  id: number;
  path: string;
  name: string;
  webUrl: string;
}

export interface GitLabCommit {
  sha: string;
  shortSha: string;
  title: string;
  message: string;
  authorName: string;
  authorEmail: string;
  committerEmail: string;
  committedAt: string;
  webUrl: string;
  additions: number;
  deletions: number;
  /** Mais de um pai = merge commit (repete linhas dos commits originais). */
  parentCount: number;
}

export interface GitLabFileChange {
  path: string;
  status: "added" | "deleted" | "renamed" | "modified";
  additions: number;
  deletions: number;
  /** Trecho do diff, já truncado. Só vai ao modelo se o usuário permitir. */
  snippet: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_PAGES = 5;
const SNIPPET_LIMIT = 1_200;
const LOCAL_SUFFIXES = [".local", ".lan", ".internal", ".home.arpa", ".localdomain", ".corp", ".intranet"];

export class GitLabError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

function isPrivateIp(host: string): boolean {
  const ip = host.replace(/^\[|\]$/g, "");
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
  }
  return false;
}

/** HTTP sem TLS só para destinos claramente internos; na internet o token iria em claro. */
function allowsPlainHttp(host: string): boolean {
  const name = host.toLowerCase();
  if (name === "localhost" || isPrivateIp(name)) return true;
  if (!name.includes(".")) return true;
  return LOCAL_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/** Normaliza a URL base: aceita "https://host", "https://host/gitlab" e também colada com /api/v4. */
export function normalizeGitLabUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) throw new GitLabError("Informe a URL do GitLab.");
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new GitLabError("URL do GitLab inválida.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new GitLabError("A URL do GitLab deve usar HTTPS.");
  if (url.username || url.password) throw new GitLabError("Não coloque usuário ou senha na URL; use o campo de token.");
  if (url.search || url.hash) throw new GitLabError("A URL do GitLab não pode ter query ou fragmento.");
  if (url.protocol === "http:" && !allowsPlainHttp(url.hostname))
    throw new GitLabError("Use HTTPS. HTTP só é aceito para GitLab em rede interna (localhost, IP privado ou .local/.lan).");
  const pathname = url.pathname.replace(/\/+$/, "").replace(/\/api\/v4$/i, "");
  return `${url.protocol}//${url.host}${pathname}`;
}

export function validateToken(raw: unknown): string {
  const token = typeof raw === "string" ? raw.trim() : "";
  if (token.length < 8 || token.length > 512 || /[\s\x00-\x1f\x7f]/.test(token)) throw new GitLabError("Token do GitLab inválido.");
  return token;
}

function countDiff(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

export function createGitLabClient(baseUrl: string, token: string, fetchFn: FetchLike = fetch) {
  const api = `${normalizeGitLabUrl(baseUrl)}/api/v4`;
  const secret = validateToken(token);

  async function request(pathAndQuery: string): Promise<{ body: unknown; nextPage: string | null }> {
    let response: Response;
    try {
      response = await fetchFn(`${api}${pathAndQuery}`, {
        headers: { "PRIVATE-TOKEN": secret, Accept: "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const name = (err as { name?: string })?.name;
      throw new GitLabError(name === "TimeoutError" || name === "AbortError" ? "O GitLab não respondeu a tempo." : "Não foi possível alcançar o GitLab.");
    }
    if (response.status >= 300 && response.status < 400)
      throw new GitLabError("O GitLab redirecionou a chamada. Confira a URL base (protocolo e caminho).", response.status);
    if (response.status === 401) throw new GitLabError("Token recusado pelo GitLab (expirado ou revogado).", 401);
    if (response.status === 403) throw new GitLabError("Token sem permissão. Gere um token com escopo read_api.", 403);
    if (!response.ok) throw new GitLabError(`GitLab respondeu HTTP ${response.status}.`, response.status);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new GitLabError("Resposta do GitLab não é JSON. Confira a URL base.");
    }
    const next = response.headers.get("x-next-page");
    return { body, nextPage: next && /^\d+$/.test(next) ? next : null };
  }

  async function paged(pathAndQuery: string, maxPages = MAX_PAGES): Promise<any[]> {
    const items: any[] = [];
    let page: string | null = "1";
    for (let count = 0; page && count < maxPages; count += 1) {
      const separator = pathAndQuery.includes("?") ? "&" : "?";
      const { body, nextPage } = await request(`${pathAndQuery}${separator}per_page=100&page=${page}`);
      if (!Array.isArray(body)) break;
      items.push(...body);
      page = nextPage;
    }
    return items;
  }

  return {
    async currentUser(): Promise<GitLabUser> {
      const { body } = await request("/user");
      const user = body as Record<string, unknown>;
      if (typeof user?.id !== "number" || typeof user.username !== "string")
        throw new GitLabError("Resposta inesperada de /user. Confira a URL base.");
      const emails = [user.email, user.commit_email, user.public_email]
        .filter((value): value is string => typeof value === "string" && value.includes("@"))
        .map((value) => value.toLowerCase());
      return { id: user.id, username: user.username, name: typeof user.name === "string" ? user.name : user.username, emails: [...new Set(emails)] };
    },

    /** Pushes do dono do token. `after`/`before` são datas exclusivas (AAAA-MM-DD). */
    async pushEvents(after: string, before: string): Promise<GitLabPushEvent[]> {
      const raw = await paged(`/events?action=pushed&after=${after}&before=${before}&sort=asc`);
      return raw
        .filter((event) => typeof event?.project_id === "number" && event.push_data?.ref_type === "branch" && event.push_data?.action !== "removed" && typeof event.push_data?.ref === "string")
        .map((event) => ({ projectId: event.project_id, ref: event.push_data.ref, createdAt: String(event.created_at ?? "") }));
    },

    async project(id: number): Promise<GitLabProject> {
      const { body } = await request(`/projects/${id}`);
      const project = body as Record<string, any>;
      return {
        id,
        path: String(project?.path_with_namespace ?? id),
        name: String(project?.name ?? project?.path_with_namespace ?? id),
        webUrl: typeof project?.web_url === "string" ? project.web_url : "",
      };
    },

    async commits(projectId: number, ref: string | null, sinceIso: string, untilIso: string): Promise<GitLabCommit[]> {
      // ref null = todas as branches do projeto (`all=true`).
      const scope = ref ? `ref_name=${encodeURIComponent(ref)}` : "all=true";
      const query = `/projects/${projectId}/repository/commits?${scope}&since=${encodeURIComponent(sinceIso)}&until=${encodeURIComponent(untilIso)}&with_stats=true`;
      const raw = await paged(query, 3);
      return raw
        .filter((commit) => typeof commit?.id === "string")
        .map((commit) => ({
          sha: commit.id,
          shortSha: String(commit.short_id ?? commit.id.slice(0, 8)),
          title: String(commit.title ?? "").slice(0, 300),
          message: String(commit.message ?? "").slice(0, 2_000),
          authorName: String(commit.author_name ?? ""),
          authorEmail: String(commit.author_email ?? "").toLowerCase(),
          committerEmail: String(commit.committer_email ?? "").toLowerCase(),
          committedAt: String(commit.committed_date ?? commit.created_at ?? ""),
          webUrl: typeof commit.web_url === "string" ? commit.web_url : "",
          additions: Number(commit.stats?.additions) || 0,
          deletions: Number(commit.stats?.deletions) || 0,
          parentCount: Array.isArray(commit.parent_ids) ? commit.parent_ids.length : 1,
        }));
    },

    /** Projetos visíveis ao token com atividade desde `sinceIso` (o GitLab inteiro que o token enxerga). */
    async activeProjects(sinceIso: string): Promise<GitLabProject[]> {
      const raw = await paged(`/projects?last_activity_after=${encodeURIComponent(sinceIso)}&archived=false&simple=true&order_by=last_activity_at&sort=desc`);
      return raw
        .filter((project) => typeof project?.id === "number")
        .map((project) => ({
          id: project.id,
          path: String(project.path_with_namespace ?? project.id),
          name: String(project.name ?? project.path_with_namespace ?? project.id),
          webUrl: typeof project.web_url === "string" ? project.web_url : "",
        }));
    },

    async commitFiles(projectId: number, sha: string): Promise<GitLabFileChange[]> {
      const raw = await paged(`/projects/${projectId}/repository/commits/${encodeURIComponent(sha)}/diff`, 1);
      return raw
        .filter((file) => typeof file?.new_path === "string")
        .map((file) => {
          const diff = typeof file.diff === "string" ? file.diff : "";
          const status: GitLabFileChange["status"] = file.new_file ? "added" : file.deleted_file ? "deleted" : file.renamed_file ? "renamed" : "modified";
          return { path: file.new_path, status, ...countDiff(diff), snippet: diff.slice(0, SNIPPET_LIMIT) };
        });
    },
  };
}

export type GitLabClient = ReturnType<typeof createGitLabClient>;
