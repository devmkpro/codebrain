"use strict";

/**
 * Goal / Stop Condition System (MiMo-inspired)
 * Independent judge model evaluates if the goal is truly satisfied,
 * preventing premature "optimistic stops" during autonomous work.
 */

function createGoalHandlers(opts) {
  return {
    /** Set a goal for a pane. */
    async goalSet({ paneId, goal }) {
      try {
        const store = opts.memoryStore;
        if (!store) return { ok: false, error: "Memory store not available" };
        if (!goal || goal.trim().length === 0) return { ok: false, error: "Goal text required" };
        store.setGoal(paneId, goal.trim());
        return { ok: true, message: `Goal set for pane ${paneId.slice(0,8)}: "${goal.trim().slice(0,200)}"`, maxReEntries: 12 };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Get current goal and verdicts for a pane. */
    async goalGet({ paneId }) {
      try {
        const store = opts.memoryStore;
        if (!store) return { ok: false, error: "Memory store not available" };
        const goal = store.getGoal(paneId);
        if (!goal) return { ok: true, data: null, message: "No goal set" };
        return { ok: true, data: goal };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Clear a pane's goal (manual override). */
    async goalClear({ paneId }) {
      try {
        const store = opts.memoryStore;
        if (!store) return { ok: false, error: "Memory store not available" };
        store.clearGoal(paneId);
        return { ok: true, message: "Goal cleared" };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Record a judge's verdict on goal satisfaction. */
    async goalJudge({ paneId, satisfied, impossible, reason }) {
      try {
        const store = opts.memoryStore;
        if (!store) return { ok: false, error: "Memory store not available" };
        const result = store.recordJudgeVerdict(paneId, { satisfied: !!satisfied, impossible: !!impossible, reason: reason || "" });
        if (!result.ok) return result;
        const maxReEntries = 12;
        return {
          ok: true, satisfied: !!satisfied, impossible: !!impossible, reEntryCount: result.reEntryCount, maxReEntries,
          shouldContinue: !satisfied && !impossible && result.reEntryCount < maxReEntries,
          shouldStop: satisfied || impossible || result.reEntryCount >= maxReEntries,
          message: satisfied ? "Goal satisfied. Agent may stop." : impossible ? "Goal deemed impossible." : result.reEntryCount >= maxReEntries ? "Max re-entries exceeded." : `Not yet satisfied (${result.reEntryCount}/${maxReEntries}). Continue.`,
        };
      } catch (e) { return { ok: false, error: e.message }; }
    },
  };
}

module.exports = { createGoalHandlers };
