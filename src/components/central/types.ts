/* Formas estreitas do que a Central consome da ponte de preload.
   Ficam aqui, e não em electron.d.ts, porque a Central só depende do subconjunto
   que usa, e tolera campo ausente vindo de uma versão mais velha do processo main. */

export type SectionId = "missao" | "tarefas" | "catalogo" | "contas" | "findings" | "midia" | "acessos";

export type Tier = "fast" | "balanced" | "deep";
export type Effort = "low" | "medium" | "high";

export interface HarnessFallback {
  cli: string;
  model: string | null;
}

export interface HarnessRow {
  id: string;
  name: string;
  description: string;
  tier: Tier;
  effort: Effort;
  keywords: string[];
  examples?: string[];
  notExamples?: string[];
  cli: string | null;
  model: string | null;
  accountId: string | null;
  agentName: string | null;
  skills: string[];
  fallbacks: HarnessFallback[];
  review: boolean;
}

export interface HarnessDecider {
  enabled: boolean;
  providerId: string | null;
  model: string | null;
  minConfidence: number;
  timeoutMs: number;
}

export interface HarnessTable {
  version: number;
  tierModels: Record<string, Partial<Record<Tier, string>>>;
  decider: HarnessDecider;
  rows: HarnessRow[];
}

export interface DeciderProvider {
  id: string;
  label: string;
  models: string[];
  /** Ausente nas versões antigas do main, que listavam apenas APIs. */
  transport?: "cli" | "api";
  cli?: string;
  authentication?: "existing-login";
}

export interface HandoffEvidence {
  commands?: { cmd: string; exitCode?: number }[];
  checks?: { requirement: string; status?: string; verify?: string }[];
  files?: string[];
  tested?: string;
}

export interface SpawnReceipt {
  id?: string;
  mission_id?: string | null;
  pane_id: string;
  name?: string | null;
  task_id?: string | null;
  task_name?: string | null;
  source?: string | null;
  agent?: string | null;
  model?: string | null;
  effort?: string | null;
  account?: string | null;
  skills?: string[] | null;
  receipt?: string | null;
  reused?: boolean | number | null;
  created_at?: number | string | null;
  handoff_summary?: string | null;
  handoff_status?: string | null;
  handoff_evidence?: HandoffEvidence | null;
  handoff_contract?: string | null;
  handoff_at?: number | string | null;
}

export type FindingStatus = "open" | "fixed" | "reopened" | "needs_decision" | "verified";
export type FindingSeverity = "high" | "medium" | "low";

export interface FindingEvidence {
  text: string;
  actor?: string | null;
  at?: number | null;
}

export interface Finding {
  id: string;
  mission_id?: string | null;
  title: string;
  category?: string | null;
  severity: FindingSeverity;
  status: FindingStatus;
  location?: string | null;
  steps?: string | null;
  expected?: string | null;
  observed?: string | null;
  evidence?: FindingEvidence[] | null;
  reporter?: string | null;
  fixed_by?: string | null;
  fix_note?: string | null;
  fix_commit?: string | null;
  verified_by?: string | null;
  created_at?: number | null;
  updated_at?: number | null;
}

export interface CatalogInstall {
  cli: string;
  path: string;
}

export interface CatalogItem {
  kind: "skill" | "agent";
  name: string;
  description?: string | null;
  installedIn?: CatalogInstall[] | null;
  disabled?: boolean;
  category?: string | null;
  builtin?: boolean;
  allowedSkills?: string[] | null;
}

export interface UsageWindow {
  id: string;
  label: string;
  usedPct?: number | null;
  tokens?: number | null;
  resetsAt?: number | string | null;
  source?: string | null;
}

export interface Account {
  id: string;
  cli: string;
  label: string;
  configDir?: string | null;
  isDefault?: boolean;
  locked?: boolean;
  loggedIn?: boolean;
  usedPct?: number | null;
  windows?: UsageWindow[] | null;
}

export type MediaKind = "image" | "video";

export interface MediaProvider {
  id: string;
  label: string;
  kinds: string[];
}

export interface MediaItem {
  name: string;
  path: string;
  kind: string;
  createdAt?: number | string | null;
  url?: string | null;
}
