/* ═══════════════════════════════════════════════════════════════════════════
   ESTADO DE PANE — VOCABULÁRIO VISUAL
   ═══════════════════════════════════════════════════════════════════════════

   O status de um pane circulava pelo app como string solta ("booting",
   "running", "idle", "error", "hibernated"), e cada componente decidia por
   conta própria qual cor usar. O resultado é que o mesmo estado aparecia em
   tons diferentes conforme onde era mostrado.

   Aqui ele vira um mapeamento único para token de cor e rótulo em português.
   Como os tokens de agente derivam da paleta ANSI, um pane com erro tem
   exatamente o mesmo vermelho de um stderr no terminal ao lado.
   ═══════════════════════════════════════════════════════════════════════════ */

export type PaneStatus =
  | "booting"
  | "running"
  | "idle"
  | "error"
  | "hibernated"
  | "unknown";

export interface StatusPresentation {
  /** Token CSS da cor. */
  color: string;
  /** Rótulo curto para leitores de tela e tooltip. */
  label: string;
  /** Pulsa quando o estado é transitório. */
  pulse: boolean;
}

const PRESENTATION: Record<PaneStatus, StatusPresentation> = {
  booting: { color: "var(--cb-agent-running)", label: "iniciando", pulse: true },
  running: { color: "var(--cb-agent-thinking)", label: "trabalhando", pulse: true },
  idle: { color: "var(--cb-agent-done)", label: "ocioso", pulse: false },
  error: { color: "var(--cb-agent-failed)", label: "erro", pulse: false },
  hibernated: { color: "var(--cb-agent-idle)", label: "hibernado", pulse: false },
  unknown: { color: "var(--cb-agent-idle)", label: "desconhecido", pulse: false },
};

/** Normaliza qualquer string de status vinda dos stores. */
export function toPaneStatus(raw: unknown): PaneStatus {
  return typeof raw === "string" && raw in PRESENTATION
    ? (raw as PaneStatus)
    : "unknown";
}

export function statusPresentation(raw: unknown): StatusPresentation {
  return PRESENTATION[toPaneStatus(raw)];
}
