"use strict";

/**
 * Plan Agent Mode (MiMo-inspired)
 * Read-only agent for code exploration and solution design.
 * Cannot edit files — only reads, analyzes, and produces a plan document.
 */

const path = require("path");
const fs = require("fs");
const os = require("os");

const PLANS_DIR = path.join(os.homedir(), ".codebrain", "plans");

function createPlanAgentHandlers(opts) {
  function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

  return {
    /** Start a planning session (marks pane as read-only). */
    async planStart({ paneId, goal, workspace }) {
      try {
        return {
          ok: true, data: {
            paneId, goal: goal || "(general exploration)",
            mode: "plan", permissions: { read: true, write: false, edit: false },
            instructions: "You are in PLAN MODE. You may only read files and produce a plan document. You CANNOT edit or write code files. Use plan_save to save your plan, then plan_exit to switch to build mode.",
          },
        };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Save a plan document to disk. */
    async planSave({ planId, content, workspace }) {
      try {
        const wsDir = workspace || opts.getCurrentWorkspacePath?.() || "default";
        const wsHash = Buffer.from(wsDir).toString("base64url").slice(0, 16);
        const planDir = path.join(PLANS_DIR, wsHash);
        ensureDir(planDir);
        const id = planId || `plan_${Date.now()}`;
        const filePath = path.join(planDir, `${id}.md`);
        fs.writeFileSync(filePath, content || "# Plan\n\n(Empty plan)", "utf-8");
        return { ok: true, path: filePath, planId: id, size: Buffer.byteLength(content || "", "utf-8") };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Read a plan document. */
    async planRead({ planId, workspace }) {
      try {
        const wsDir = workspace || opts.getCurrentWorkspacePath?.() || "default";
        const wsHash = Buffer.from(wsDir).toString("base64url").slice(0, 16);
        const filePath = path.join(PLANS_DIR, wsHash, `${planId}.md`);
        if (!fs.existsSync(filePath)) return { ok: true, data: null, message: "Plan not found" };
        const content = fs.readFileSync(filePath, "utf-8");
        return { ok: true, data: { planId, content, path: filePath } };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** List saved plans for the workspace. */
    async planList({ workspace }) {
      try {
        const wsDir = workspace || opts.getCurrentWorkspacePath?.() || "default";
        const wsHash = Buffer.from(wsDir).toString("base64url").slice(0, 16);
        const planDir = path.join(PLANS_DIR, wsHash);
        if (!fs.existsSync(planDir)) return { ok: true, data: [] };
        const files = fs.readdirSync(planDir).filter(f => f.endsWith(".md"));
        const plans = files.map(f => {
          const content = fs.readFileSync(path.join(planDir, f), "utf-8");
          const title = content.split("\n")[0].replace(/^#+\s*/, "").trim();
          return { planId: f.replace(".md", ""), title, path: path.join(planDir, f), size: content.length };
        });
        return { ok: true, data: plans };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Exit plan mode and optionally switch to build mode. */
    async planExit({ paneId, switchToBuild = true }) {
      try {
        return {
          ok: true, data: {
            paneId, planMode: false, buildMode: switchToBuild,
            message: switchToBuild ? "Plan complete. Switching to BUILD MODE — you may now edit and write files." : "Plan mode exited.",
          },
        };
      } catch (e) { return { ok: false, error: e.message }; }
    },
  };
}

module.exports = { createPlanAgentHandlers };
