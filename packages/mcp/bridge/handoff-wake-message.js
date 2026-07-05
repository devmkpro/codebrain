"use strict";

/**
 * handoff-wake-message — Pure builder for the human-legible wake message
 * poked into an orchestrator's PTY input on a worker handoff.
 *
 * Ported from Overclock sidecar (handoffWakeMessage.js).
 * Pure function — no side effects, no deps, unit-testable.
 *
 * The message contract:
 *   - pane label + item reference (when the worker's summary cites one)
 *   - human summary
 *   - technical pointer (separate field for voice consumers)
 *
 * Item refs follow the kanban convention: F-012, C-012.1, T-003
 */

/** Matches item ids: F-012, C-012.1, T-003, ktask_xxx */
const ITEM_REF_RE = /\b([FCT]-\d{3}(?:\.\d+)?|ktask_[a-z0-9_]+)\b/;

/**
 * Extract the FIRST item id a worker's summary cites, if any.
 * Returns undefined when the summary doesn't reference a specific item.
 *
 * @param {string} summary
 * @returns {string|undefined}
 */
function extractItemRef(summary) {
  if (!summary || typeof summary !== "string") return undefined;
  return ITEM_REF_RE.exec(summary)?.[1];
}

/** Status → glyph mapping */
const STATUS_GLYPHS = {
  done: "✓",
  progress: "▸",
  awaiting_clarification: "❓",
  stalled: "…",
  blocked: "⚠",
  error: "✗",
  dead: "✗",
};

/**
 * Build the two-part wake message (human + technical).
 * Separated so a voice consumer can narrate `human` and drop `technical`.
 *
 * @param {{ paneId: string, summary: string, status: string, artifacts?: string[] }} entry
 * @param {string} [squadRole] — optional human-readable role label
 * @returns {{ human: string, technical: string }}
 */
function buildWakeMessageParts(entry, squadRole) {
  const isClarify = entry.status === "awaiting_clarification";
  const isStalled = entry.status === "stalled";
  const glyph = STATUS_GLYPHS[entry.status] || "⚠";

  const paneLabel = squadRole || entry.paneId.split("_").pop() || entry.paneId;
  const itemRef = extractItemRef(entry.summary);
  const label = itemRef ? `${paneLabel} · ${itemRef}` : paneLabel;

  let body;
  let technical;

  if (isClarify) {
    const question = entry.artifacts?.question || entry.summary;
    body = `pergunta: "${question}" — repasse ao humano e escreva a resposta de volta no pane. O pane está vivo, não respawne.`;
    technical = `Responda via mcp__codebrain__pane_write({paneId:"${entry.paneId}",text:"<resposta>"})`;
  } else {
    body = entry.summary || (entry.status ? `status=${entry.status}` : "handoff sem summary/status (registro incompleto)");
    if (entry.status === "blocked") {
      body += " — precisa da sua orientação.";
    } else if (entry.status === "error" || entry.status === "dead") {
      body += " — não declare done; investigue ou re-invoque.";
    } else if (isStalled) {
      body += " — vivo mas quieto; sonde antes de agir.";
    }
    technical = `Detalhes: mcp__codebrain__handoff_wait({paneIds:["${entry.paneId}"]})`;
  }

  return { human: `${glyph} ${label}: ${body}`, technical };
}

/**
 * Build the raw wake message text (human + technical joined).
 *
 * @param {{ paneId: string, summary: string, status: string, artifacts?: string[] }} entry
 * @param {string} [squadRole]
 * @returns {string}
 */
function buildWakeMessage(entry, squadRole) {
  const { human, technical } = buildWakeMessageParts(entry, squadRole);
  return technical ? `${human} ${technical}` : human;
}

module.exports = {
  extractItemRef,
  buildWakeMessageParts,
  buildWakeMessage,
  STATUS_GLYPHS,
  ITEM_REF_RE,
};
