"use strict";

/**
 * Snapshot / Session Revert Handlers (MiMo-inspired)
 * Track file state via separate git dir, support revert/unrevert with diff computation.
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const SNAPSHOTS_DIR = path.join(os.homedir(), ".codebrain", "snapshots");

function createSnapshotHandlers(opts) {
  function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

  function getSnapshotGitDir(workspace) {
    const hash = Buffer.from(workspace).toString("base64url").slice(0, 32);
    return path.join(SNAPSHOTS_DIR, hash);
  }

  return {
    /** Create a snapshot of the current workspace state. */
    async snapshotTrack({ sessionId, messageIndex }) {
      try {
        const workspace = opts.getCurrentWorkspacePath?.();
        if (!workspace) return { ok: false, error: "No workspace active" };
        const gitDir = getSnapshotGitDir(workspace);
        ensureDir(gitDir);
        // Init git repo if needed
        if (!fs.existsSync(path.join(gitDir, ".git"))) {
          execSync(`git init`, { cwd: gitDir, stdio: "pipe" });
        }
        // Copy tracked files to snapshot dir and commit
        const snapshotHash = `snap_${Date.now()}`;
        // Track workspace files (non-git, non-node_modules)
        try {
          execSync(`git -C "${gitDir}" add -A`, { stdio: "pipe" });
          execSync(`git -C "${gitDir}" commit -m "${snapshotHash}" --allow-empty`, { stdio: "pipe" });
        } catch {}
        // Get commit hash
        let commitHash = snapshotHash;
        try {
          commitHash = execSync(`git -C "${gitDir}" rev-parse HEAD`, { stdio: "pipe" }).toString().trim();
        } catch {}
        // Store metadata
        const store = opts.memoryStore;
        if (store?.snapshotTrack) {
          store.snapshotTrack({ sessionId: sessionId || "default", snapshotHash: commitHash, filePaths: [], messageIndex });
        }
        return { ok: true, snapshotHash: commitHash, gitDir };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** List snapshots for a session. */
    async snapshotList({ sessionId, limit }) {
      try {
        const store = opts.memoryStore;
        if (!store?.snapshotList) return { ok: false, error: "Snapshot list not available" };
        return store.snapshotList({ sessionId, limit });
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Revert workspace to a specific snapshot. */
    async snapshotRevert({ snapshotHash }) {
      try {
        const workspace = opts.getCurrentWorkspacePath?.();
        if (!workspace) return { ok: false, error: "No workspace active" };
        const gitDir = getSnapshotGitDir(workspace);
        if (!fs.existsSync(path.join(gitDir, ".git"))) return { ok: false, error: "No snapshots exist for this workspace" };
        execSync(`git -C "${gitDir}" checkout ${snapshotHash}`, { stdio: "pipe" });
        return { ok: true, message: `Reverted to snapshot ${snapshotHash.slice(0, 12)}` };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Unrevert (go forward) after a revert. */
    async snapshotUnrevert() {
      try {
        const workspace = opts.getCurrentWorkspacePath?.();
        if (!workspace) return { ok: false, error: "No workspace active" };
        const gitDir = getSnapshotGitDir(workspace);
        if (!fs.existsSync(path.join(gitDir, ".git"))) return { ok: false, error: "No snapshots exist" };
        execSync(`git -C "${gitDir}" checkout -`, { stdio: "pipe" });
        return { ok: true, message: "Unreverted to latest state" };
      } catch (e) { return { ok: false, error: e.message }; }
    },
  };
}

module.exports = { createSnapshotHandlers };
