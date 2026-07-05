"use strict";

/**
 * clarify-broadcast — Pure extractor for the pane:clarify push payload.
 *
 * Ported from Overclock sidecar (clarifyBroadcast.js).
 * Pure function — no side effects, no deps, unit-testable.
 *
 * When a worker submits a handoff with status='awaiting_clarification',
 * this extracts { paneId, question, suggestions } from the handoff entry.
 * The caller then uses this payload to push a clarification request to the
 * orchestrator or directly to the user.
 */

/**
 * Extract a clarification broadcast payload from a handoff entry.
 * Returns null if the entry is not awaiting_clarification or has no suggestions.
 *
 * @param {{ paneId: string, status: string, summary?: string, artifacts?: { question?: string, suggestions?: string[] } }} entry
 * @returns {{ paneId: string, question: string, suggestions: string[] } | null}
 */
function clarifyBroadcastPayload(entry) {
  if (!entry || entry.status !== "awaiting_clarification") return null;

  const raw = entry.artifacts?.suggestions;
  if (!Array.isArray(raw)) return null;

  const suggestions = raw
    .map((s) => String(s))
    .filter((s) => s.trim().length > 0);

  if (suggestions.length === 0) return null;

  const question = String(entry.artifacts?.question || entry.summary || "");
  return { paneId: entry.paneId, question, suggestions };
}

module.exports = { clarifyBroadcastPayload };
