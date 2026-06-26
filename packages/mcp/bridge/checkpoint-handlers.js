"use strict";

/**
 * Checkpoint Writer + Validation Handlers (MiMo-inspired)
 * Writes structured checkpoints for long-running sessions,
 * validates quality with 13 rules and per-section token budgets.
 */

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const CHECKPOINTS_DIR = path.join(os.homedir(), ".codebrain", "checkpoints");

function createCheckpointHandlers(opts) {
  function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

  function getCheckpointDir(workspace, sessionId) {
    const wsHash = Buffer.from(workspace || "default").toString("base64url").slice(0, 16);
    return path.join(CHECKPOINTS_DIR, wsHash, sessionId || "default");
  }

  return {
    /** Save a checkpoint to disk. */
    async checkpointWrite({ sessionId, content, topic }) {
      try {
        const workspace = opts.getCurrentWorkspacePath?.() || "default";
        const cpDir = getCheckpointDir(workspace, sessionId);
        ensureDir(cpDir);
        const filePath = path.join(cpDir, "checkpoint.md");
        fs.writeFileSync(filePath, content || "# Checkpoint\n\n(Empty checkpoint)", "utf-8");
        const store = opts.memoryStore;
        if (store) {
          store.updateCheckpointState(sessionId, { lastCheckpointAt: Date.now(), path: filePath, topic: topic || "" });
        }
        return { ok: true, path: filePath, size: Buffer.byteLength(content || "", "utf-8") };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Read a checkpoint from disk. */
    async checkpointRead({ sessionId }) {
      try {
        const workspace = opts.getCurrentWorkspacePath?.() || "default";
        const cpDir = getCheckpointDir(workspace, sessionId);
        const filePath = path.join(cpDir, "checkpoint.md");
        if (!fs.existsSync(filePath)) return { ok: true, data: null, message: "No checkpoint found" };
        const content = fs.readFileSync(filePath, "utf-8");
        return { ok: true, data: { content, path: filePath, size: content.length } };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Validate checkpoint quality and budget compliance. */
    async checkpointValidate({ content }) {
      try {
        const store = opts.memoryStore;
        if (!store?.validateCheckpoint) return { ok: false, error: "validateCheckpoint not available" };
        const result = store.validateCheckpoint(content);
        return { ok: true, ...result };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Get checkpoint state for a session. */
    async checkpointState({ sessionId }) {
      try {
        const store = opts.memoryStore;
        if (!store) return { ok: false, error: "Memory store not available" };
        const state = store.getCheckpointState(sessionId);
        return { ok: true, data: state };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Write a spillover file for over-budget sections. */
    async checkpointSpillover({ sessionId, topic, content }) {
      try {
        const workspace = opts.getCurrentWorkspacePath?.() || "default";
        const cpDir = getCheckpointDir(workspace, sessionId);
        ensureDir(cpDir);
        const safeName = (topic || "overflow").replace(/[^a-zA-Z0-9_-]/g, "_");
        const filePath = path.join(cpDir, `checkpoint-${safeName}.md`);
        fs.writeFileSync(filePath, content || "", "utf-8");
        return { ok: true, path: filePath };
      } catch (e) { return { ok: false, error: e.message }; }
    },
  };
}

module.exports = { createCheckpointHandlers };
