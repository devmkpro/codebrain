"use strict";

/**
 * Compose Mode Handler (MiMo-inspired)
 * Specs-driven development workflow: plan → execute → review → test → debug → verify → merge.
 * Orchestrates the full lifecycle from spec to shipped code.
 */

function createComposeModeHandlers(opts) {
  const COMPOSE_PHASES = [
    { name: "plan", description: "Analyze the spec, break into tasks, create a plan" },
    { name: "execute", description: "Implement the plan step by step" },
    { name: "review", description: "Code review: check for bugs, style, security" },
    { name: "test", description: "Write and run tests (TDD if applicable)" },
    { name: "debug", description: "Fix any issues found during review or testing" },
    { name: "verify", description: "Final verification: all tests pass, no regressions" },
    { name: "merge", description: "Prepare for merge: clean up, document, commit" },
  ];

  return {
    /** Start a compose workflow for a spec. */
    async composeStart({ spec, workspace }) {
      try {
        const composeId = `compose_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const phases = COMPOSE_PHASES.map(p => ({ ...p, status: "pending", startedAt: null, completedAt: null }));
        return {
          ok: true, data: {
            composeId, spec: spec || "(no spec provided)", phases,
            currentPhase: 0,
            instructions: `Compose workflow started (${composeId}). Follow phases in order: ${COMPOSE_PHASES.map(p => p.name).join(" → ")}. Use compose_advance to move to next phase.`,
          },
        };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Advance to the next compose phase. */
    async composeAdvance({ composeId, currentPhase, phaseResult }) {
      try {
        const nextPhase = (currentPhase || 0) + 1;
        if (nextPhase >= COMPOSE_PHASES.length) {
          return { ok: true, data: { complete: true, message: "All compose phases completed. Ready to merge." } };
        }
        return {
          ok: true, data: {
            composeId, phase: nextPhase, phaseName: COMPOSE_PHASES[nextPhase].name,
            phaseDescription: COMPOSE_PHASES[nextPhase].description,
            phasesRemaining: COMPOSE_PHASES.length - nextPhase - 1,
          },
        };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Get the list of compose phases. */
    async composePhases() {
      try {
        return { ok: true, data: COMPOSE_PHASES };
      } catch (e) { return { ok: false, error: e.message }; }
    },
  };
}

module.exports = { createComposeModeHandlers };
