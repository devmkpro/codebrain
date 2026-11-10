/* Regras da Central sem React: transições de finding, escada de decisão, leitura
   do recibo, validação da tabela e modelo das barras de uso. Tudo aqui é testável
   sem DOM e sem a ponte de preload. */

import type {
  Account,
  CatalogItem,
  Effort,
  Finding,
  FindingSeverity,
  FindingStatus,
  HandoffEvidence,
  HarnessDecider,
  HarnessRow,
  HarnessTable,
  MediaProvider,
  SpawnReceipt,
  Tier,
  UsageWindow,
} from "./types";

/* ── Findings ─────────────────────────────────────────────────────────── */

/** Espelho de TRANSITIONS em packages/memory/findings-store.js. */
export const FINDING_TRANSITIONS: Record<FindingStatus, FindingStatus[]> = {
  open: ["fixed", "needs_decision"],
  fixed: ["verified", "reopened"],
  reopened: ["fixed", "needs_decision"],
  needs_decision: ["open"],
  verified: ["reopened"],
};

export const FINDING_STATUSES: FindingStatus[] = [
  "open",
  "reopened",
  "needs_decision",
  "fixed",
  "verified",
];

export const FINDING_STATUS_LABEL: Record<FindingStatus, string> = {
  open: "aberto",
  fixed: "corrigido",
  reopened: "reaberto",
  needs_decision: "precisa de decisão",
  verified: "verificado",
};

export const FINDING_ACTION_LABEL: Record<FindingStatus, string> = {
  open: "voltar a abrir",
  fixed: "marcar corrigido",
  reopened: "reabrir",
  needs_decision: "pedir decisão",
  verified: "confirmar correção",
};

export const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  high: "alta",
  medium: "média",
  low: "baixa",
};

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function allowedTransitions(status: string): FindingStatus[] {
  return FINDING_TRANSITIONS[status as FindingStatus] ?? [];
}

export type TransitionField = "note" | "evidence";

export function transitionField(target: FindingStatus): TransitionField | null {
  if (target === "fixed") return "note";
  if (target === "verified" || target === "reopened") return "evidence";
  return null;
}

export interface TransitionInput {
  note?: string;
  evidence?: string;
  actor?: string;
}

/** Devolve a mensagem de bloqueio, ou null quando a transição pode seguir. */
export function validateTransition(
  finding: Pick<Finding, "status" | "fixed_by">,
  target: FindingStatus,
  input: TransitionInput
): string | null {
  if (!allowedTransitions(finding.status).includes(target)) {
    return `De ${FINDING_STATUS_LABEL[finding.status] ?? finding.status} não dá para ir para ${FINDING_STATUS_LABEL[target]}.`;
  }
  if (target === "fixed" && !input.note?.trim()) {
    return "Conte a causa e como você validou a correção.";
  }
  if ((target === "verified" || target === "reopened") && !input.evidence?.trim()) {
    return "Diga o que você refez para chegar a essa conclusão.";
  }
  if (target === "verified" && input.actor && input.actor === finding.fixed_by) {
    return "Quem corrigiu não pode confirmar a própria correção.";
  }
  return null;
}

export function sortFindings<T extends Pick<Finding, "severity" | "id">>(findings: T[]): T[] {
  return [...findings].sort(
    (a, b) =>
      (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) ||
      a.id.localeCompare(b.id, "pt-BR", { numeric: true })
  );
}

/* ── Escada de decisão ────────────────────────────────────────────────── */

export interface LadderStep {
  id: "pedido" | "tipo" | "decisor" | "palavras" | "padrao";
  label: string;
  detail: string;
  off?: boolean;
}

/** Ordem real de `decideHarness`: a primeira que responder vence. */
export function ladderSteps(decider?: Pick<HarnessDecider, "enabled"> | null): LadderStep[] {
  return [
    { id: "pedido", label: "pedido", detail: "o piloto mandou" },
    { id: "tipo", label: "tipo indicado", detail: "linha apontada" },
    {
      id: "decisor",
      label: "decisor",
      detail: decider?.enabled ? "modelo barato escolhe" : "desligado",
      off: !decider?.enabled,
    },
    { id: "palavras", label: "palavras-chave", detail: "pistas no texto" },
    { id: "padrao", label: "padrão", detail: "linha Geral" },
  ];
}

export type SourceKey = "pedido" | "decisor" | "palavra-chave" | "padrao" | "desconhecido";

export interface SourceInfo {
  key: SourceKey;
  label: string;
  color: string;
}

export function sourceInfo(source: string | null | undefined): SourceInfo {
  switch (source) {
    case "pedido":
      return { key: "pedido", label: "pedido", color: "var(--cb-ansi-blue)" };
    case "decisor":
      return { key: "decisor", label: "decisor", color: "var(--cb-accent)" };
    case "palavra-chave":
      return { key: "palavra-chave", label: "palavra-chave", color: "var(--cb-ansi-cyan)" };
    case "padrao":
    case "padrão":
      return { key: "padrao", label: "padrão", color: "var(--cb-fg-2)" };
    default:
      return { key: "desconhecido", label: "sem registro", color: "var(--cb-fg-3)" };
  }
}

/* ── Recibo ───────────────────────────────────────────────────────────── */

export interface ParsedReceipt {
  /** Por que este tipo foi escolhido. */
  why: string | null;
  warnings: string[];
  review: boolean;
}

const stripMarker = (line: string) => line.replace(/^\s*▸\s*/, "").trim();

export function parseReceipt(text: string | null | undefined): ParsedReceipt {
  const lines = String(text ?? "")
    .split("\n")
    .map(stripMarker)
    .filter(Boolean);
  const warningLine = lines.find((line) => line.startsWith("avisos:"));
  return {
    why: lines[0] ?? null,
    warnings: warningLine
      ? warningLine
          .slice("avisos:".length)
          .split(";")
          .map((part) => part.trim())
          .filter(Boolean)
      : [],
    review: lines.some((line) => line.startsWith("revisão:")),
  };
}

/** SQLite grava segundos e o renderer usa milissegundos. Datas em texto também chegam. */
export function toEpochMs(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return toEpochMs(numeric);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export interface MissionWindow {
  createdAt: number;
  operationalMissionId?: string;
  pilotPaneId?: string;
}

/**
 * Quais recibos pertencem a esta missão. O id operacional manda quando o recibo
 * o traz; sem ele, vale a janela de tempo entre esta missão e a seguinte.
 */
export function receiptsForMission(
  receipts: SpawnReceipt[],
  mission: MissionWindow,
  nextMissionCreatedAt?: number | null
): SpawnReceipt[] {
  return receipts.filter((receipt) => {
    if (mission.pilotPaneId && receipt.pane_id === mission.pilotPaneId) return false;
    if (receipt.mission_id && mission.operationalMissionId) {
      return receipt.mission_id === mission.operationalMissionId;
    }
    const at = toEpochMs(receipt.created_at);
    if (at == null) return false;
    // Tolerância de 2s: o relógio do SQLite trunca para segundos.
    if (at < mission.createdAt - 2000) return false;
    return nextMissionCreatedAt == null || at < nextMissionCreatedAt - 2000;
  });
}

export function hasEvidence(evidence: HandoffEvidence | null | undefined): boolean {
  if (!evidence) return false;
  return Boolean(
    evidence.checks?.length ||
    evidence.commands?.length ||
    evidence.files?.length ||
    evidence.tested?.trim()
  );
}

export function evidenceSummary(evidence: HandoffEvidence | null | undefined): string | null {
  if (!hasEvidence(evidence)) return null;
  const parts: string[] = [];
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (evidence!.checks?.length)
    parts.push(count(evidence!.checks.length, "verificação", "verificações"));
  if (evidence!.commands?.length) {
    const failed = evidence!.commands.filter((command) => command.exitCode).length;
    parts.push(
      `${count(evidence!.commands.length, "comando", "comandos")}${failed ? ` (${failed} com erro)` : ""}`
    );
  }
  if (evidence!.files?.length) parts.push(count(evidence!.files.length, "arquivo", "arquivos"));
  if (evidence!.tested?.trim()) parts.push("testado");
  return parts.join(" · ");
}

export interface DeliveryState {
  label: string;
  color: string;
  /** Ponto pulsando: o ajudante ainda está trabalhando. */
  live: boolean;
  delivered: boolean;
}

/** Estado da entrega. `paneStatus` undefined significa que o pane já não existe. */
export function deliveryState(
  receipt: Pick<SpawnReceipt, "handoff_status" | "handoff_evidence" | "handoff_contract">,
  paneStatus: string | undefined
): DeliveryState {
  const status = receipt.handoff_status;
  if (status === "done") {
    if (receipt.handoff_contract === "failed") {
      return {
        label: "entregue, contrato reprovado",
        color: "var(--cb-danger)",
        live: false,
        delivered: true,
      };
    }
    if (!hasEvidence(receipt.handoff_evidence)) {
      return { label: "entregue sem prova", color: "var(--cb-warn)", live: false, delivered: true };
    }
    return { label: "entregue", color: "var(--cb-success)", live: false, delivered: true };
  }
  if (status === "blocked")
    return { label: "travado", color: "var(--cb-agent-blocked)", live: false, delivered: false };
  if (status === "error")
    return { label: "deu erro", color: "var(--cb-agent-failed)", live: false, delivered: false };
  if (paneStatus === undefined)
    return { label: "fechado sem entrega", color: "var(--cb-fg-2)", live: false, delivered: false };
  if (paneStatus === "error")
    return {
      label: "terminal com erro",
      color: "var(--cb-agent-failed)",
      live: false,
      delivered: false,
    };
  if (paneStatus === "idle")
    return {
      label: "parado, sem entrega",
      color: "var(--cb-agent-blocked)",
      live: false,
      delivered: false,
    };
  if (paneStatus === "hibernated")
    return { label: "hibernado", color: "var(--cb-agent-idle)", live: false, delivered: false };
  return { label: "trabalhando", color: "var(--cb-agent-running)", live: true, delivered: false };
}

/** Findings ligados a um ajudante: quem reportou ou quem corrigiu. */
export function findingsForHelper(
  findings: Finding[],
  receipt: Pick<SpawnReceipt, "pane_id" | "name">
): Finding[] {
  const actors = new Set([receipt.pane_id, receipt.name].filter(Boolean));
  return findings.filter(
    (finding) => actors.has(finding.reporter ?? "") || actors.has(finding.fixed_by ?? "")
  );
}

/* ── Tabela de tarefas ────────────────────────────────────────────────── */

export const DEFAULT_ROW_ID = "geral";
export const TIERS: Tier[] = ["fast", "balanced", "deep"];
export const EFFORTS: Effort[] = ["low", "medium", "high"];
export const TIER_LABEL: Record<Tier, string> = {
  fast: "rápido",
  balanced: "equilibrado",
  deep: "profundo",
};
export const EFFORT_LABEL: Record<Effort, string> = { low: "baixo", medium: "médio", high: "alto" };

export interface TableIssue {
  rowId: string | null;
  field: string;
  message: string;
}

export function validateTable(table: HarnessTable): TableIssue[] {
  const issues: TableIssue[] = [];
  const seen = new Set<string>();
  for (const row of table.rows) {
    if (!row.name.trim())
      issues.push({ rowId: row.id, field: "name", message: "Dê um nome a este tipo." });
    if (seen.has(row.id))
      issues.push({
        rowId: row.id,
        field: "id",
        message: `Já existe um tipo com o código ${row.id}.`,
      });
    seen.add(row.id);
    row.fallbacks.forEach((fallback) => {
      if (!fallback.cli.trim())
        issues.push({
          rowId: row.id,
          field: "fallbacks",
          message: "Toda reserva precisa de uma CLI.",
        });
    });
  }
  if (!table.rows.some((row) => row.id === DEFAULT_ROW_ID)) {
    issues.push({
      rowId: null,
      field: "rows",
      message: "A linha Geral não pode faltar: é ela que responde quando nada combina.",
    });
  }
  const { decider } = table;
  if (decider.minConfidence < 0 || decider.minConfidence > 1) {
    issues.push({
      rowId: null,
      field: "minConfidence",
      message: "A confiança mínima vai de 0% a 100%.",
    });
  }
  if (decider.enabled && !decider.providerId) {
    issues.push({
      rowId: null,
      field: "providerId",
      message: "Para ligar o Decisor, escolha quem responde por ele.",
    });
  }
  if (decider.enabled && !decider.model) {
    issues.push({
      rowId: null,
      field: "model",
      message: "Para ligar o Decisor, escolha o modelo.",
    });
  }
  return issues;
}

/** Slug estável e único para uma linha criada na tela. */
export function newRowId(name: string, existing: string[]): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "tipo";
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function blankRow(existing: string[]): HarnessRow {
  return {
    id: newRowId("novo tipo", existing),
    name: "Novo tipo",
    description: "",
    tier: "balanced",
    effort: "medium",
    keywords: [],
    examples: [],
    notExamples: [],
    cli: null,
    model: null,
    accountId: null,
    agentName: null,
    skills: [],
    fallbacks: [],
    review: false,
  };
}

/** Texto digitado vira lista: por vírgula ou por linha, sem vazios nem repetidos. */
export function parseList(text: string, separator: RegExp = /[,\n]/): string[] {
  const seen = new Set<string>();
  return text
    .split(separator)
    .map((part) => part.trim())
    .filter((part) => part && !seen.has(part) && seen.add(part));
}

export interface DecisionView {
  decided: boolean;
  taskLabel: string | null;
  confidence: number | null;
  reason: string | null;
}

/** `decision` chega como id, como objeto do decisor, ou nulo quando ele desistiu. */
export function decisionView(result: {
  decision?: unknown;
  reason?: string | null;
  taskName?: string | null;
}): DecisionView {
  const raw = result.decision;
  if (raw && typeof raw === "object") {
    const decision = raw as { taskId?: string; confidence?: number; reason?: string };
    return {
      decided: true,
      taskLabel: result.taskName ?? decision.taskId ?? null,
      confidence: typeof decision.confidence === "number" ? decision.confidence : null,
      reason: decision.reason || result.reason || null,
    };
  }
  if (typeof raw === "string" && raw) {
    return {
      decided: true,
      taskLabel: result.taskName ?? raw,
      confidence: null,
      reason: result.reason ?? null,
    };
  }
  return { decided: false, taskLabel: null, confidence: null, reason: result.reason ?? null };
}

/* ── Contas ───────────────────────────────────────────────────────────── */

export type UsageBar =
  | { kind: "measured"; pct: number }
  | { kind: "estimated"; tokens: number }
  | { kind: "none" };

/** Porcentagem só existe quando foi medida: token sem limite conhecido nunca vira %. */
export function usageBar(window: Pick<UsageWindow, "usedPct" | "tokens">): UsageBar {
  if (typeof window.usedPct === "number" && Number.isFinite(window.usedPct)) {
    return { kind: "measured", pct: Math.min(100, Math.max(0, window.usedPct)) };
  }
  if (typeof window.tokens === "number" && Number.isFinite(window.tokens) && window.tokens > 0) {
    return { kind: "estimated", tokens: window.tokens };
  }
  return { kind: "none" };
}

export function usageColor(pct: number): string {
  if (pct >= 90) return "var(--cb-danger)";
  if (pct >= 70) return "var(--cb-warn)";
  return "var(--cb-ansi-cyan)";
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000)
    return `${(tokens / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000).toLocaleString("pt-BR")} mil`;
  return tokens.toLocaleString("pt-BR");
}

export function formatReset(
  resetsAt: number | string | null | undefined,
  now: number
): string | null {
  const at = toEpochMs(resetsAt);
  if (at == null) return null;
  const minutes = Math.round((at - now) / 60000);
  if (minutes <= 0) return "renovando";
  if (minutes < 60) return `renova em ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `renova em ${hours}h${minutes % 60 ? ` ${minutes % 60}min` : ""}`;
  return `renova em ${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function groupAccounts(accounts: Account[]): { cli: string; accounts: Account[] }[] {
  const groups = new Map<string, Account[]>();
  for (const account of accounts) {
    groups.set(account.cli, [...(groups.get(account.cli) ?? []), account]);
  }
  return [...groups.entries()].map(([cli, list]) => ({ cli, accounts: list }));
}

/* ── Catálogo ─────────────────────────────────────────────────────────── */

export function isBuiltin(item: Pick<CatalogItem, "name" | "builtin">): boolean {
  return Boolean(item.builtin) || item.name.startsWith("cb-");
}

export interface CatalogFilter {
  query: string;
  kind: "all" | "skill" | "agent";
  category: string;
  cli: string;
}

export function filterCatalog(items: CatalogItem[], filter: CatalogFilter): CatalogItem[] {
  const query = filter.query.trim().toLowerCase();
  return items.filter((item) => {
    if (filter.kind !== "all" && item.kind !== filter.kind) return false;
    if (filter.category && (item.category ?? "") !== filter.category) return false;
    if (filter.cli && !(item.installedIn ?? []).some((install) => install.cli === filter.cli))
      return false;
    if (!query) return true;
    return `${item.name} ${item.description ?? ""}`.toLowerCase().includes(query);
  });
}

const uniqueSorted = (values: (string | null | undefined)[]) =>
  [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) =>
    a.localeCompare(b, "pt-BR")
  );

export const catalogCategories = (items: CatalogItem[]) =>
  uniqueSorted(items.map((item) => item.category));

export const catalogClis = (items: CatalogItem[]) =>
  uniqueSorted(items.flatMap((item) => (item.installedIn ?? []).map((install) => install.cli)));

export function copyTargets(item: CatalogItem, clis: string[]): string[] {
  const installed = new Set((item.installedIn ?? []).map((install) => install.cli));
  return [...new Set(clis)].filter((cli) => !installed.has(cli));
}

/** O modo vem do backend: capacidade declarada não prova instalação nativa. */
export function catalogCopyModeMessage(mode: unknown): string {
  switch (mode) {
    case "native-skill":
      return "native-skill: skill no formato nativo do destino.";
    case "skill-persona":
      return "skill-persona: agente adaptado como skill, não como agente nativo.";
    case "codebrain-files":
      return "codebrain-files: arquivos portáveis Codebrain, sem instalação nativa; acesso pelo catálogo/entrypoint.";
    default:
      return "O backend não informou o modo de compatibilidade; instalação nativa não confirmada.";
  }
}

/* ── Mídia ────────────────────────────────────────────────────────────── */

export interface MediaDraft {
  kind: string;
  prompt: string;
  provider: string;
}

export function providersForKind(providers: MediaProvider[], kind: string): MediaProvider[] {
  return providers.filter((provider) => provider.kinds.includes(kind));
}

export function validateMediaDraft(draft: MediaDraft, providers: MediaProvider[]): string | null {
  if (!draft.prompt.trim()) return "Descreva o que você quer gerar.";
  if (!providersForKind(providers, draft.kind).length) {
    return draft.kind === "video"
      ? "Nenhum provedor conectado gera vídeo."
      : "Nenhum provedor conectado gera imagem.";
  }
  if (
    draft.provider &&
    !providersForKind(providers, draft.kind).some((provider) => provider.id === draft.provider)
  ) {
    return "Esse provedor não gera esse tipo de mídia.";
  }
  return null;
}

/* ── Texto ────────────────────────────────────────────────────────────── */

export function timeAgo(value: number | string | null | undefined, now: number): string | null {
  const at = toEpochMs(value);
  if (at == null) return null;
  const minutes = Math.round((now - at) / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  return `há ${Math.round(hours / 24)}d`;
}

export const basename = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
