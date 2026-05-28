"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".codebrain", "review-config.json");

const DEFAULT_CONFIG = {
  repos: [],
  polling: {
    enabled: true,
    intervalMs: 120_000,
  },
  webhook: {
    enabled: true,
    secret: "",
  },
  maxComments: 20,
  maxCostPerReview: 0.5,
};

/**
 * Load/save review configuration for multi-repo MR review.
 * Persists to ~/.codebrain/review-config.json.
 */
function createReviewConfigHandlers(opts = {}) {
  const configPath = opts.configPath || DEFAULT_CONFIG_PATH;

  function ensureDir() {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  function loadConfig() {
    try {
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, "utf-8");
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_CONFIG, ...parsed };
      }
    } catch {}
    return { ...DEFAULT_CONFIG };
  }

  function saveConfig(config) {
    ensureDir();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  }

  // ── review_config_get ──────────────────────────────────────────────────
  async function reviewConfigGet() {
    try {
      const config = loadConfig();
      return { ok: true, data: config };
    } catch (err) {
      return { ok: false, error: `review_config_get failed: ${err.message}` };
    }
  }

  // ── review_config_set ──────────────────────────────────────────────────
  async function reviewConfigSet({ repos, polling, webhook, maxComments, maxCostPerReview, addRepo, removeRepo }) {
    try {
      const config = loadConfig();

      // Add a repo
      if (addRepo) {
        const existing = config.repos.find((r) => r.projectId === addRepo.projectId);
        if (existing) {
          Object.assign(existing, addRepo);
        } else {
          config.repos.push({
            projectId: addRepo.projectId,
            name: addRepo.name || `repo-${addRepo.projectId}`,
            branches: addRepo.branches || ["main", "master"],
            skipDraft: addRepo.skipDraft !== undefined ? addRepo.skipDraft : true,
            autoFix: addRepo.autoFix || false,
            autoFixSeverity: addRepo.autoFixSeverity || "critical",
          });
        }
      }

      // Remove a repo
      if (removeRepo) {
        config.repos = config.repos.filter((r) => r.projectId !== removeRepo);
      }

      // Full replace (if provided)
      if (repos) config.repos = repos;
      if (polling) config.polling = { ...config.polling, ...polling };
      if (webhook) config.webhook = { ...config.webhook, ...webhook };
      if (maxComments !== undefined) config.maxComments = maxComments;
      if (maxCostPerReview !== undefined) config.maxCostPerReview = maxCostPerReview;

      saveConfig(config);
      return { ok: true, data: config };
    } catch (err) {
      return { ok: false, error: `review_config_set failed: ${err.message}` };
    }
  }

  // ── review_status ──────────────────────────────────────────────────────
  // Returns recent review history from memory store + current config summary
  async function reviewStatus() {
    try {
      const config = loadConfig();
      let recentReviews = [];

      // Try to load from memory store
      const store = opts.memoryStore;
      if (store) {
        try {
          const memories = store.search("mr-review", { type: "episodic", limit: 10 });
          recentReviews = (memories || []).map((m) => {
            try {
              return JSON.parse(m.content);
            } catch {
              return { raw: m.content?.slice(0, 200) };
            }
          });
        } catch {}
      }

      return {
        ok: true,
        data: {
          reposConfigured: config.repos.length,
          pollingEnabled: config.polling.enabled,
          pollingIntervalMs: config.polling.intervalMs,
          webhookEnabled: config.webhook.enabled,
          webhookHasSecret: !!config.webhook.secret,
          maxComments: config.maxComments,
          maxCostPerReview: config.maxCostPerReview,
          recentReviews,
        },
      };
    } catch (err) {
      return { ok: false, error: `review_status failed: ${err.message}` };
    }
  }

  return {
    reviewConfigGet,
    reviewConfigSet,
    reviewStatus,
    // Expose for polling worker / webhook handler
    loadConfig,
    saveConfig,
    configPath,
  };
}

module.exports = { createReviewConfigHandlers };
