"use strict";

/**
 * Step Classification System (MiMo-inspired)
 * Classifies assistant steps: final | continue | filtered | think-only | invalid | failed
 * Pure functions — used for loop control decisions.
 */

function createStepClassifier(opts) {
  return {
    /** Classify a single step. */
    async stepClassify({ output, hasPendingTools, hasError }) {
      try {
        const store = opts.memoryStore;
        if (!store?.classifyStep) return { ok: false, error: "classifyStep not available" };
        const result = store.classifyStep({ output: output || "", hasPendingTools: !!hasPendingTools, hasError: !!hasError });
        return { ok: true, ...result };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Classify a batch of steps at once. */
    async stepClassifyBatch({ steps }) {
      try {
        const store = opts.memoryStore;
        if (!store?.classifyStep) return { ok: false, error: "classifyStep not available" };
        const results = (steps || []).map((step, i) => ({
          index: i, ...store.classifyStep({ output: step.output || "", hasPendingTools: !!step.hasPendingTools, hasError: !!step.hasError }),
        }));
        return { ok: true, data: results };
      } catch (e) { return { ok: false, error: e.message }; }
    },
  };
}

module.exports = { createStepClassifier };
