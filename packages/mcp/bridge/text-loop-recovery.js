"use strict";

/**
 * Text Loop Recovery (MiMo-inspired)
 * Detects repeated identical TEXT output (not just tool calls).
 * Mild nudge on first offense, strong warning on second, max 2 recoveries.
 */

function createTextLoopRecovery(opts) {
  return {
    /** Record text output and check if the agent is looping. */
    async textLoopCheck({ paneId, output }) {
      try {
        const store = opts.memoryStore;
        if (!store?.recordTextOutput) return { ok: false, error: "recordTextOutput not available" };
        const result = store.recordTextOutput(paneId, output || "");
        if (result.isLooping) {
          const warning = result.recoveryCount === 1
            ? "\n⚠️ TEXT LOOP (mild): Your last 3 outputs were identical. Try a COMPLETELY different approach — different tool, different file, different strategy.\n"
            : "\n🚨 TEXT LOOP (strong): STOP immediately. Abandon your current plan entirely and ask the user for help.\n";
          try { opts.ptyManager?.write(paneId, warning, false); } catch {}
          return { ok: true, isLooping: true, recoveryCount: result.recoveryCount, suggestion: result.suggestion, maxRecoveriesReached: result.recoveryCount >= 2 };
        }
        return { ok: true, isLooping: false };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Reset the text loop buffer for a pane. */
    async textLoopReset({ paneId }) {
      try { opts.memoryStore?.clearTextLoopBuffer?.(paneId); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    },
  };
}

module.exports = { createTextLoopRecovery };
