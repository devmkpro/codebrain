"use strict";

/**
 * Max Mode Handler (MiMo-inspired)
 * Runs N parallel propose-only candidates, judge selects best, then execute.
 */

function createMaxModeHandlers(opts) {
  return {
    async maxModeRun({ prompt, candidates = 5, judgeModel, judgeCriteria }) {
      try {
        if (!prompt) return { ok: false, error: "Prompt required" };
        const candidateCount = Math.min(Math.max(candidates, 2), 10);
        const criteria = judgeCriteria || "Select the candidate with the most accurate, complete, and well-structured response.";
        return {
          ok: true, data: {
            mode: "max", prompt, candidateCount, judgeModel: judgeModel || "same",
            judgeCriteria: criteria,
            instructions: `MAX MODE: Spawn ${candidateCount} workers in parallel, each with the same prompt but different approaches. Judge selects best. Use pane_spawn with label "max-candidate-N".`,
          },
        };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    async maxModeCandidate({ runId, candidateIndex, output, approach }) {
      try {
        return { ok: true, data: { runId, candidateIndex, outputLength: (output || "").length, approach: approach || "unspecified", timestamp: Date.now() } };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    async maxModeJudge({ runId, candidates }) {
      try {
        if (!Array.isArray(candidates) || candidates.length === 0) return { ok: false, error: "Candidates array required" };
        return { ok: true, data: { runId, totalCandidates: candidates.length, instructions: "Evaluate each candidate. Select the one with best quality, completeness, and accuracy." } };
      } catch (e) { return { ok: false, error: e.message }; }
    },
  };
}

module.exports = { createMaxModeHandlers };
