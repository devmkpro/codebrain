/** Contrato compartilhado entre main e renderer do Diário GitLab. Nenhum segredo trafega aqui. */

export interface GitDigestConnection {
  id: string;
  label: string;
  baseUrl: string;
  enabled: boolean;
  /** `all` = todos os commits de todos os projetos que o token enxerga; `mine` = só os do dono do token. */
  scope: "all" | "mine";
  /** Filtro opcional por `grupo/projeto`. Vazio = todos os projetos com push do dono do token. */
  projects: string[];
  /** E-mails extras de autoria (aliases). Os e-mails da conta entram sozinhos. */
  authorEmails: string[];
  username?: string;
  verifiedAt?: string;
  /** Só existe na resposta ao renderer. */
  hasToken?: boolean;
}

export interface GitDigestSummarizer {
  /** `cli:claude` ou id de provider de API (mesma lista do Decisor). */
  providerId: string | null;
  model: string | null;
}

export interface GitDigestSchedule {
  enabled: boolean;
  /** HH:MM no fuso do computador. */
  time: string;
  /** Quantos dias anteriores reprocessar se o app estava fechado. */
  catchUpDays: number;
}

export interface GitDigestConfig {
  version: 1;
  connections: GitDigestConnection[];
  summarizer: GitDigestSummarizer;
  schedule: GitDigestSchedule;
  /** Envia trechos de diff ao modelo. Desligado: só títulos, mensagens e caminhos. */
  includeDiffs: boolean;
}

export interface GitDigestFile {
  path: string;
  status: "added" | "deleted" | "renamed" | "modified";
  additions: number;
  deletions: number;
}

export interface GitDigestCommit {
  sha: string;
  shortSha: string;
  title: string;
  message: string;
  authorName: string;
  committedAt: string;
  webUrl: string;
  refs: string[];
  additions: number;
  deletions: number;
  files: GitDigestFile[];
}

export interface GitDigestProject {
  key: string;
  connectionId: string;
  connectionLabel: string;
  path: string;
  name: string;
  webUrl: string;
  commits: GitDigestCommit[];
}

export interface GitDigestTheme {
  id: string;
  projectKey: string;
  title: string;
  detail: string;
  commits: string[];
  files: string[];
}

export type GitDigestNodeKind = "day" | "project" | "theme" | "file";

export interface GitDigestNode {
  id: string;
  kind: GitDigestNodeKind;
  label: string;
  /** Peso relativo (linhas alteradas ou commits), usado no tamanho do neurônio. */
  weight: number;
  parent: string | null;
  projectKey?: string;
  detail?: string;
  commits?: string[];
}

export interface GitDigestEdge {
  from: string;
  to: string;
  /** `tree` liga pai e filho; `synapse` liga temas que tocaram o mesmo arquivo. */
  kind: "tree" | "synapse";
}

export interface GitDigest {
  date: string;
  generatedAt: string;
  stats: { commits: number; projects: number; files: number; additions: number; deletions: number; authors?: number; merges?: number };
  projects: GitDigestProject[];
  summary: {
    headline: string;
    text: string;
    providerId: string | null;
    model: string | null;
    /** Preenchido quando o modelo falhou; o mapa estrutural continua válido. */
    error?: string;
  };
  themes: GitDigestTheme[];
  map: { nodes: GitDigestNode[]; edges: GitDigestEdge[] };
  /** Falhas parciais (uma conexão fora do ar não derruba o diário inteiro). */
  warnings: string[];
}

export interface GitDigestListItem {
  date: string;
  generatedAt: string;
  commits: number;
  projects: number;
  headline: string;
}

export interface GitDigestStatus {
  encryption: { available: boolean; reason?: string };
  running: string | null;
  lastError: string | null;
  lastRunAt: string | null;
}

export interface GitDigestProviderOption {
  id: string;
  label: string;
  models: string[];
  transport?: "cli" | "api";
  /** Falso quando o harness existe mas não pode resumir agora (ex.: sem chave). */
  available?: boolean;
  reason?: string;
}

type R<T> = Promise<({ ok: true } & T) | { ok: false; error: string }>;

export interface GitDigestBridge {
  getConfig: () => R<{ config: GitDigestConfig; status: GitDigestStatus }>;
  saveSettings: (args: { summarizer?: GitDigestSummarizer; schedule?: GitDigestSchedule; includeDiffs?: boolean }) => R<{ config: GitDigestConfig }>;
  /** `token` só é enviado ao criar ou trocar; nunca volta. */
  upsertConnection: (args: Partial<GitDigestConnection> & { token?: string }) => R<{ config: GitDigestConfig }>;
  removeConnection: (args: { id: string }) => R<{ config: GitDigestConfig }>;
  testConnection: (args: { id: string }) => R<{ user: { username: string; name: string } }>;
  list: () => R<{ items: GitDigestListItem[] }>;
  get: (args: { date: string }) => R<{ digest: GitDigest | null }>;
  generate: (args?: { date?: string }) => R<{ digest: GitDigest }>;
  providers: () => R<{ providers: GitDigestProviderOption[] }>;
  onUpdated: (callback: (date: string) => void) => () => void;
}
