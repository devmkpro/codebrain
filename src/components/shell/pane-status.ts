/* ═══════════════════════════════════════════════════════════════════════════
   ESTADO DE PANE — VOCABULÁRIO ÚNICO
   ═══════════════════════════════════════════════════════════════════════════

   O status de um pane circulava pelo app como string solta ("booting",
   "running", "idle", "error", "hibernated"), e cada superfície decidia por
   conta própria o que mostrar. Pior: `running` só diz que o processo existe —
   um Claude parado no prompt ficava pulsando como se estivesse trabalhando.

   Aqui existe um vocabulário só, de sete estados, que header, NavRail e abas
   importam. Cada estado tem token de cor e forma próprios (ver
   pane-status-glyph.tsx), para nunca depender só de cor.

   Como os tokens de agente derivam da paleta ANSI, um pane que falhou tem
   exatamente o mesmo vermelho de um stderr no terminal ao lado.
   ═══════════════════════════════════════════════════════════════════════════ */

import { readTerminalActivity } from "../../types/terminal-activity";

export type PaneActivity =
  | "idle"
  | "thinking"
  | "running"
  | "waiting"
  | "blocked"
  | "failed"
  | "done";

/** O que a saída do terminal revela neste instante. Sem sinal, `null`. */
export type PaneLiveSignal = "thinking" | "running" | "waiting" | null;

export type ActivityMotion = "none" | "spin" | "pulse" | "attention";

export interface ActivityPresentation {
  activity: PaneActivity;
  /** Rótulo em português, igual em toda superfície. */
  label: string;
  /** Token CSS da cor. */
  color: string;
  /** Só estados ativos se movem. */
  motion: ActivityMotion;
  /** Exige o usuário: pinta o cromo inteiro do pane, não só o ponto. */
  urgent: boolean;
  /** Faz sentido contar o tempo decorrido. */
  ticking: boolean;
}

export const PANE_ACTIVITIES: Record<PaneActivity, ActivityPresentation> = {
  idle: { activity: "idle", label: "ocioso", color: "var(--cb-agent-idle)", motion: "none", urgent: false, ticking: false },
  thinking: { activity: "thinking", label: "pensando", color: "var(--cb-agent-thinking)", motion: "spin", urgent: false, ticking: true },
  running: { activity: "running", label: "executando", color: "var(--cb-agent-running)", motion: "pulse", urgent: false, ticking: true },
  // Amarelo-claro invertido: os seis tokens de agente não cobrem este estado,
  // e ele precisa se separar de "bloqueado", que usa o amarelo em contorno.
  waiting: { activity: "waiting", label: "aguardando você", color: "var(--cb-ansi-bright-yellow)", motion: "attention", urgent: true, ticking: true },
  blocked: { activity: "blocked", label: "bloqueado", color: "var(--cb-agent-blocked)", motion: "none", urgent: false, ticking: true },
  failed: { activity: "failed", label: "falhou", color: "var(--cb-agent-failed)", motion: "none", urgent: false, ticking: false },
  done: { activity: "done", label: "concluído", color: "var(--cb-agent-done)", motion: "none", urgent: false, ticking: false },
};

export interface PaneStatusInput {
  status?: unknown;
  exitCode?: number | null;
  live?: PaneLiveSignal;
  awaitingInput?: boolean;
  handoffStatus?: string;
  contractStatus?: string;
}

const WAITING_STATUSES = new Set(["waiting", "needs_input", "awaiting_input"]);
const BLOCKED_STATUSES = new Set(["blocked", "stuck"]);

/**
 * Traduz o estado cru + sinais vivos no vocabulário de sete estados.
 *
 * A ordem importa: fim de processo vence tudo; "aguardando você" vence
 * qualquer atividade; o sinal vivo vence a entrega anterior, porque um pane
 * que entregou e voltou a trabalhar está trabalhando.
 */
export function derivePaneActivity(pane: PaneStatusInput | null | undefined): PaneActivity {
  const raw = typeof pane?.status === "string" ? pane.status : "";

  if (raw === "exited") return pane?.exitCode == null || pane.exitCode === 0 ? "done" : "failed";
  if (raw === "error" || raw === "failed") return "failed";
  if (pane?.live === "waiting" || pane?.awaitingInput === true || WAITING_STATUSES.has(raw)) return "waiting";
  if (BLOCKED_STATUSES.has(raw)) return "blocked";
  if (pane?.live === "thinking" || pane?.live === "running") return pane.live;

  if (pane?.contractStatus === "failed") return "failed";
  if (pane?.handoffStatus === "blocked") return "blocked";
  if (pane?.handoffStatus === "error" || pane?.handoffStatus === "failed") return "failed";
  if (pane?.handoffStatus === "done" || raw === "done") return "done";

  if (raw === "booting" || raw === "waking") return "running";
  if (raw === "thinking") return "thinking";
  return "idle";
}

export function activityPresentation(activity: PaneActivity): ActivityPresentation {
  return PANE_ACTIVITIES[activity] ?? PANE_ACTIVITIES.idle;
}

export function paneActivityPresentation(pane: PaneStatusInput | null | undefined): ActivityPresentation {
  return activityPresentation(derivePaneActivity(pane));
}

/**
 * Chave do relógio de atividade: alternar entre pensar e executar é o mesmo
 * turno de trabalho e não deve zerar o tempo mostrado no header.
 */
export function activityClockKey(activity: PaneActivity): string {
  return activity === "thinking" || activity === "running" ? "working" : activity;
}

/** `0:42`, `12:05`, `1h02`. Tempo negativo ou inválido vira `0:00`. */
export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}`;
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

// ── Leitura da saída do terminal ────────────────────────────────────────────

/** Remove CSI, OSC e caracteres de controle, preservando quebras de linha. */
export function stripTerminalControls(text: string): string {
  return text
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1B[@-_]/g, "")
    .replace(/[\x00-\x09\x0B-\x1F\x7F]/g, "");
}

const WAITING_PATTERNS = [
  /do you want to (?:proceed|continue|make this edit|create|overwrite|run|allow)/gi,
  /\[(?:y\/n|Y\/n|y\/N)\]|\((?:y\/n|Y\/n|y\/N|yes\/no)\)/g,
  /allow (?:this )?(?:command|execution|tool|edit)\b[^\n]*\?/gi,
  /(?:^|\s)❯\s*1\.\s*(?:yes|sim)\b/gi,
  /press enter to (?:continue|confirm)/gi,
  /waiting for (?:your )?(?:input|approval|confirmation)/gi,
];

const TOOL_MARKER = /\b(?:Bash|Read|Write|Edit|Update|Grep|Glob|WebFetch|Task|exec)\(|\b(?:Running|Executing)\b/;

function lastMatchIndex(pattern: RegExp, text: string): number {
  let last = -1;
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) last = match.index ?? last;
  return last;
}

/**
 * Classifica o fim da saída de um terminal. É heurística sobre texto, então
 * só separa o que dá para separar com baixo custo de erro: pergunta na tela
 * vira "aguardando você"; ferramenta rodando vira "executando"; o resto de
 * uma CLI de IA é "pensando". Em shell puro, saída é sempre execução.
 *
 * `busy` indica bytes recentes, não o fim de um turno. Marcadores explícitos
 * continuam válidos no silêncio, até conclusão ou remoção ANSI da TUI.
 */
export function classifyTerminalOutput(agent: string | undefined, raw: string, busy: boolean): PaneLiveSignal {
  const snapshot = readTerminalActivity(raw);
  const { text } = snapshot;
  const waitingAt = Math.max(...WAITING_PATTERNS.map((pattern) => lastMatchIndex(pattern, text)));
  if (waitingAt >= 0 && waitingAt > snapshot.activeAt && waitingAt > snapshot.completedAt) return "waiting";
  if (snapshot.active) return !agent || agent === "shell" ? "running" : snapshot.active;
  if (snapshot.completedAt >= 0 || /(?:^|\n)\s*[›❯>]\s*(?:Ask Codex to do anything)?\s*$/i.test(text)) return null;
  if (!busy) return null;
  if (!agent || agent === "shell") return "running";
  return TOOL_MARKER.test(text) ? "running" : "thinking";
}

// ── API por string crua (StatusBar e outros leitores só do campo `status`) ──

export type PaneStatus =
  | "booting"
  | "running"
  | "idle"
  | "error"
  | "hibernated"
  | "waking"
  | "blocked"
  | "done"
  | "exited"
  | "unknown";

export interface StatusPresentation {
  /** Token CSS da cor. */
  color: string;
  /** Rótulo curto para leitores de tela e tooltip. */
  label: string;
  /** Pulsa quando o estado é transitório. */
  pulse: boolean;
}

const RAW_ACTIVITY: Record<PaneStatus, PaneActivity> = {
  booting: "running",
  running: "running",
  waking: "running",
  idle: "idle",
  hibernated: "idle",
  unknown: "idle",
  error: "failed",
  blocked: "blocked",
  done: "done",
  exited: "done",
};

/** Normaliza qualquer string de status vinda dos stores. */
export function toPaneStatus(raw: unknown): PaneStatus {
  return typeof raw === "string" && raw in RAW_ACTIVITY ? (raw as PaneStatus) : "unknown";
}

export function statusPresentation(raw: unknown): StatusPresentation {
  const presentation = activityPresentation(RAW_ACTIVITY[toPaneStatus(raw)]);
  return {
    color: presentation.color,
    label: presentation.label,
    pulse: presentation.motion !== "none",
  };
}
