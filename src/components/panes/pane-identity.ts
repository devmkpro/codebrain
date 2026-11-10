/* ═══════════════════════════════════════════════════════════════════════════
   IDENTIDADE DE PANE
   ═══════════════════════════════════════════════════════════════════════════

   O que transforma "um terminal" em "aquele terminal": nome (o objetivo),
   CLI, modelo, esforço, conta, tipo de tarefa, diretório e a entrega.

   Funções puras — header, NavRail e janela destacada leem daqui, então um
   mesmo pane nunca aparece com dois nomes.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface PaneIdentityInput {
  agent?: string;
  title?: string;
  label?: string;
  kind?: string;
  model?: string;
}

export interface CliIdentity {
  label: string;
  /** Token ANSI — a marca de cada CLI também sai da paleta do terminal. */
  color: string;
}

const CLIS: Record<string, CliIdentity> = {
  claude: { label: "claude", color: "var(--cb-ansi-bright-red)" },
  codex: { label: "codex", color: "var(--cb-ansi-green)" },
  gemini: { label: "gemini", color: "var(--cb-ansi-blue)" },
  kimi: { label: "kimi", color: "var(--cb-ansi-cyan)" },
  cursor: { label: "cursor", color: "var(--cb-ansi-white)" },
  copilot: { label: "copilot", color: "var(--cb-ansi-bright-cyan)" },
  openclaude: { label: "openclaude", color: "var(--cb-ansi-bright-magenta)" },
  shell: { label: "shell", color: "var(--cb-fg-2)" },
};

export function cliIdentity(agent?: string): CliIdentity {
  const key = (agent ?? "shell").toLowerCase();
  return CLIS[key] ?? { label: key, color: "var(--cb-fg-1)" };
}

export interface PaneName {
  name: string;
  /** Ninguém nomeou este pane: o nome é só a CLI. */
  isDefault: boolean;
}

export function paneDisplayName(pane: PaneIdentityInput): PaneName {
  const label = pane.label?.trim();
  if (label) return { name: label, isDefault: false };
  // `title` nasce igual ao agente; só conta como nome se alguém o trocou.
  const title = pane.title?.trim();
  if (title && title !== pane.agent) return { name: title, isDefault: false };
  return { name: cliIdentity(pane.agent).label, isDefault: true };
}

/** `claude-opus-4-8` → `opus-4-8`; `anthropic/claude-3.5` → `claude-3.5`. */
export function modelShortName(model?: string | null): string | null {
  if (!model) return null;
  const last = model.split("/").pop() ?? model;
  return last.replace(/^claude-/, "").slice(0, 22) || null;
}

export function pathBasename(path?: string | null): string {
  if (!path) return "";
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

const EFFORT_LABELS: Record<string, string> = {
  low: "baixo",
  medium: "médio",
  high: "alto",
  xhigh: "muito alto",
  max: "máximo",
};

export function effortLabel(effort?: string | null): string | null {
  if (!effort) return null;
  return EFFORT_LABELS[effort.toLowerCase()] ?? effort;
}

export type RoleLabel = "piloto" | "ajudante";

/** Papel só aparece quando há papel de verdade — pane avulso não é "worker". */
export function roleLabel(pane: { role?: string | null; parentPaneId?: string | null }): RoleLabel | null {
  if (pane.role === "orchestrator" || pane.role === "pilot") return "piloto";
  if (pane.parentPaneId || pane.role === "helper") return "ajudante";
  return null;
}

// ── Entrega ─────────────────────────────────────────────────────────────────

export type DeliveryTone = "ok" | "warn" | "danger";

export interface DeliveryBadge {
  tone: DeliveryTone;
  text: string;
}

export interface PaneDeliveryInput {
  handoffStatus?: string;
  evidence?: string;
  contractStatus?: string;
}

/** O backend prefixa "⚠ " e "evidência: "; o badge já diz isso visualmente. */
function cleanEvidence(evidence?: string): string {
  return (evidence ?? "")
    .replace(/^[\s⚠️]+/u, "")
    .replace(/^evid[eê]ncia:\s*/i, "")
    .trim();
}

export function deliveryBadge(pane: PaneDeliveryInput): DeliveryBadge | null {
  const evidence = cleanEvidence(pane.evidence);
  if (pane.contractStatus === "failed" || /contrato reprovado/i.test(evidence)) {
    return { tone: "danger", text: "contrato reprovado" };
  }
  if (!pane.handoffStatus && !evidence) return null;
  if (!evidence || /sem evid[eê]ncia/i.test(evidence)) return { tone: "warn", text: "sem evidência" };
  return { tone: "ok", text: evidence };
}

// ── Lista do NavRail ────────────────────────────────────────────────────────

export interface RailPane {
  id: string;
  agent?: string;
  role?: string;
  parentPaneId?: string;
  registryMissionId?: string;
}

export interface RailRow<T> {
  pane: T;
  depth: number;
  /** Último ajudante do piloto: a guia de árvore termina aqui. */
  last: boolean;
}

function isPilot(pane: RailPane): boolean {
  return pane.role === "orchestrator" || pane.role === "pilot";
}

/**
 * Ordena a lista com cada ajudante logo abaixo do seu piloto.
 *
 * O vínculo vem de `parentPaneId`; sem ele, de estar na mesma missão
 * operacional de um piloto. Sem nenhum dos dois, o pane fica solto e na
 * ordem original.
 */
export function groupPanesForRail<T extends RailPane>(panes: T[]): RailRow<T>[] {
  const byId = new Map(panes.map((pane) => [pane.id, pane]));
  const pilots = panes.filter(isPilot);

  const parentOf = (pane: T): T | undefined => {
    const parent = pane.parentPaneId ? byId.get(pane.parentPaneId) : undefined;
    if (parent && parent.id !== pane.id) return parent;
    if (isPilot(pane) || pane.agent === "shell" || !pane.registryMissionId) return undefined;
    return pilots.find((pilot) => pilot.registryMissionId === pane.registryMissionId);
  };

  const rootOf = (pane: T): T => {
    const seen = new Set([pane.id]);
    let current = pane;
    for (let parent = parentOf(current); parent; parent = parentOf(current)) {
      // Ciclo em dado externo: o pane fica solto em vez de sumir da lista.
      if (seen.has(parent.id)) return pane;
      seen.add(parent.id);
      current = parent;
    }
    return current;
  };

  const helpers = new Map<string, T[]>();
  const roots: T[] = [];
  for (const pane of panes) {
    const root = rootOf(pane);
    if (root.id === pane.id) roots.push(pane);
    else helpers.set(root.id, [...(helpers.get(root.id) ?? []), pane]);
  }

  return roots.flatMap((root) => {
    const children = helpers.get(root.id) ?? [];
    return [
      { pane: root, depth: 0, last: children.length === 0 },
      ...children.map((pane, index) => ({ pane, depth: 1, last: index === children.length - 1 })),
    ];
  });
}
