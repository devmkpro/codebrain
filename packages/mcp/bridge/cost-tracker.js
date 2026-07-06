"use strict";

const fs = require("node:fs");
const path = require("node:path");
const DEFAULT_MODEL_COSTS = {
  // Per 1M tokens (input/output in USD)

  // ==========================================
  // ANTHROPIC - CLAUDE 4.x & 4.5/4.6/4.7 (Geração Atual)
  // ==========================================
  "claude-4.8-opus": { input: 5.0, output: 25.0, cache_read: 0.5 },
  "claude-4.7-opus": { input: 5.0, output: 25.0, cache_read: 0.5 },
  "claude-4.6-opus": { input: 5.0, output: 25.0, cache_read: 0.5 },
  "claude-4.6-sonnet": { input: 3.0, output: 15.0, cache_read: 0.3 },
  "claude-4.5-sonnet": { input: 3.0, output: 15.0, cache_read: 0.3 },
  "claude-4.5-haiku": { input: 1.0, output: 5.0, cache_read: 0.1 },

  // ==========================================
  // MODELOS ESPECIALIZADOS EM AGENTES / REASONING (Raciocínio Complexo)
  // ==========================================
  "claude-4.7-opus-thinking": { input: 5.0, output: 25.0 },
  "gemini-3.1-pro-preview-thinking": { input: 2.0, output: 12.0 }, // Conforme tabela para comandos <= 200k

  // Gemini 3.1 Flash-Lite
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.50 },
  "gemini-3.1-flash-lite-preview": { input: 0.25, output: 1.50 },

  // Gemini 3.5 Flash (estável)
  "gemini-3.5-flash": { input: 1.50, output: 9.00 },

  // Pré-lançamento do Gemini 3.1 Pro (Preços variam por tamanho do comando)
  "gemini-3.1-pro-preview": { input: 2.00, output: 12.00 }, // Comandos <= 200 mil tokens
  "gemini-3.1-pro-preview-high-context": { input: 4.00, output: 18.00 }, // Comandos > 200 mil tokens
  "gemini-3.1-pro-preview-customtools": { input: 2.00, output: 12.00 },

  // Prévia do Gemini 3.1 Flash Live
  "gemini-3.1-flash-live-preview": { input: 0.75, output: 4.50 },

  // Pré-lançamento da imagem do Gemini 3.1 Flash
  "gemini-3.1-flash-image-preview": { input: 0.50, output: 3.00 },

  // Pré-lançamento do Gemini 3.1 Flash TTS
  "gemini-3.1-flash-tts-preview": { input: 1.00, output: 20.00 },

  // Pré-lançamento do Gemini 3 Flash
  "gemini-3-flash-preview": { input: 0.50, output: 3.00 },

  // Pré-lançamento do Gemini 3 Pro
  "gemini-3-pro-preview": { input: 2.00, output: 12.00 },

  // Gemini 2.0 Flash 001 (snapshot)
  "gemini-2.0-flash-001": { input: 0.10, output: 0.40 },
  // Gemini 2.0 Flash-Lite 001 (snapshot)
  "gemini-2.0-flash-lite-001": { input: 0.075, output: 0.30 },

  // Gemini 2.5 Pro (Preços variam por tamanho do comando)
  "gemini-2.5-pro": { input: 1.25, output: 10.00 }, // Comandos <= 200 mil tokens
  "gemini-2.5-pro-high-context": { input: 2.50, output: 15.00 }, // Comandos > 200 mil tokens

  // Gemini 2.5 Flash
  "gemini-2.5-flash": { input: 0.30, output: 2.50 },

  // Gemini 2.5 Flash-Lite
  "gemini-2.5-flash-lite": { input: 0.10, output: 0.40 },
  "gemini-2.5-flash-lite-preview-09-2025": { input: 0.10, output: 0.40 },

  // Áudio nativo do Gemini 2.5 Flash (API Live)
  "gemini-2.5-flash-native-audio-preview-12-2025": { input: 0.50, output: 2.00 },

  // Imagem do Gemini 2.5 Flash
  "gemini-2.5-flash-image": { input: 0.30, output: 0.039 },

  // Pré-lançamento do Gemini 2.5 Flash TTS
  "gemini-2.5-flash-preview-tts": { input: 0.50, output: 10.00 },

  // Pré-lançamento do Gemini 2.5 Pro TTS
  "gemini-2.5-pro-preview-tts": { input: 1.00, output: 20.00 },

  // Gemini 2.0 Flash (Obsoleto - Desativação em 1º de junho de 2026)
  "gemini-2.0-flash": { input: 0.10, output: 0.40 },

  // Gemini 2.0 Flash-Lite
  "gemini-2.0-flash-lite": { input: 0.075, output: 0.30 },

  // Embedding do Gemini 2 (Apenas entrada de texto)
  "gemini-embedding-2": { input: 0.20, output: 0.00 },

  // Embedding do Gemini (Apenas entrada de texto)
  "gemini-embedding-001": { input: 0.15, output: 0.00 },

  // Pré-lançamento do Gemini Robotics-ER 1.6
  "gemini-robotics-er-1.6-preview": { input: 1.00, output: 5.00 },

  // Pré-lançamento do Gemini 2.5 Computer Use
  "gemini-2.5-computer-use-preview-10-2025": { input: 1.25, output: 10.00 }, // Comandos <= 200 mil tokens
  "gemini-2.5-computer-use-preview-10-2025-high-context": { input: 2.50, output: 15.00 }, // Comandos > 200 mil tokens
  // MIMO (Xiaomi) — Overseas pricing per https://platform.mimo.ai (per 1M tokens)
  // Updated 2026-05-27: V2.5 series price reduction (up to 99% off)
  "mimo-v2.5-pro": { input: 0.435, output: 0.87, cache_read: 0.0036 },
  "mimo-v2.5": { input: 0.14, output: 0.28, cache_read: 0.0028 },
  "mimo-v2-pro": { input: 1.00, output: 3.00 },
  "mimo-v2-omni": { input: 0.40, output: 2.00 },
  "mimo-v2-flash": { input: 0.10, output: 0.30 },

  // ==========================================
  // OPENROUTER (via provider/model format)
  // Pricing from openrouter.ai/models — per 1M tokens
  // ==========================================
  "anthropic/claude-3.5-sonnet": { input: 3.0, output: 15.0 },
  "anthropic/claude-3-opus": { input: 15.0, output: 75.0 },
  "anthropic/claude-3-haiku": { input: 0.25, output: 1.25 },
  "anthropic/claude-3.5-haiku": { input: 0.80, output: 4.0 },
  "anthropic/claude-sonnet-4": { input: 3.0, output: 15.0 },
  "anthropic/claude-opus-4": { input: 15.0, output: 75.0 },
  "anthropic/claude-opus-4.7": { input: 5.0, output: 25.0, cache_read: 0.50 },
  "anthropic/claude-opus-4.8": { input: 5.0, output: 25.0, cache_read: 0.50 },
  "anthropic/claude-opus-4-8": { input: 5.0, output: 25.0, cache_read: 0.50 },
  "anthropic/claude-opus-4.7-fast": { input: 30.0, output: 150.0 },
  "google/gemini-2.5-pro": { input: 1.25, output: 10.0 },
  "google/gemini-2.5-flash": { input: 0.30, output: 2.50 },
  "google/gemini-2.0-flash": { input: 0.10, output: 0.40 },
  "google/gemini-3.1-flash-lite": { input: 0.25, output: 1.50 },
  "openai/gpt-4o": { input: 2.50, output: 10.0 },
  "openai/gpt-4o-mini": { input: 0.15, output: 0.60 },
  "openai/gpt-4.1": { input: 2.0, output: 8.0 },
  "openai/gpt-4.1-mini": { input: 0.40, output: 1.60 },
  "openai/gpt-4.1-nano": { input: 0.10, output: 0.40 },
  "openai/o3": { input: 2.00, output: 8.00 },
  "openai/o4-mini": { input: 1.10, output: 4.40 },
  "openai/o3-mini": { input: 1.10, output: 4.40 },
  "deepseek/deepseek-chat": { input: 0.14, output: 0.28 },
  "deepseek/deepseek-chat-v3-0324": { input: 0.27, output: 1.10 },
  "deepseek/deepseek-reasoner": { input: 0.55, output: 2.19 },
  "meta-llama/llama-3.1-405b-instruct": { input: 1.00, output: 1.00 },
  "meta-llama/llama-3.1-70b-instruct": { input: 0.52, output: 0.75 },
  "meta-llama/llama-4-maverick": { input: 0.20, output: 0.60 },
  "mistralai/mistral-large-latest": { input: 2.0, output: 6.0 },
  "mistralai/mistral-medium-3-5": { input: 1.50, output: 7.50 },
  "mistralai/mistral-small-latest": { input: 0.10, output: 0.30 },
  "x-ai/grok-3": { input: 3.0, output: 15.0 },
  "x-ai/grok-3-mini": { input: 0.30, output: 0.50 },
  "x-ai/grok-4.3": { input: 1.25, output: 2.50 },
  // OpenRouter extras
  "meta-llama/llama-3.1-405b": { input: 1.00, output: 1.00 },
  "anthropic/claude-opus-4-8": { input: 5.0, output: 25.0, cache_read: 0.50 },
  "nousresearch/hermes-3-llama-3.1-405b:free": { input: 0.0, output: 0.0 },

  // ==========================================
  // FIREWORKS.AI — per 1M tokens (2026-07)
  // https://fireworks.ai/pricing
  // ==========================================
  "accounts/fireworks/models/kimi-k2-instruct": { input: 0.50, output: 2.50 },
  "accounts/fireworks/models/deepseek-v3": { input: 0.22, output: 0.88 },
  "accounts/fireworks/models/glm-4-9b-chat": { input: 0.10, output: 0.10 },
  "accounts/fireworks/models/qwen3-235b-a22b": { input: 0.22, output: 0.88 },
  "accounts/fireworks/models/llama-v3p1-405b-instruct": { input: 3.00, output: 3.00 },
  "accounts/fireworks/models/llama-v3p1-70b-instruct": { input: 0.90, output: 0.90 },

  // ==========================================
  // CODEX (OpenAI Codex CLI — via ChatGPT OAuth or API key)
  // Pricing from openai.com/api/pricing — per 1M tokens (2026-05-30)
  // ==========================================
  "gpt-5.5": { input: 5.00, output: 30.00, cache_read: 0.50 },
  "gpt-5.4": { input: 2.50, output: 15.00, cache_read: 0.25 },
  "gpt-5.4-mini": { input: 0.75, output: 4.50, cache_read: 0.075 },
  "codex-auto-review": { input: 2.50, output: 15.00, cache_read: 0.25 },
  // Aliases used by Codex CLI internally
  "gpt-4o-codex": { input: 2.50, output: 10.0 },
  "gpt-4.1-codex": { input: 2.00, output: 8.00 },

  // ==========================================
  // API MODEL NAME ALIASES
  // Anthropic API returns different names than our internal cost table.
  // Map API names → same pricing as internal names.
  // ==========================================
  "claude-opus-4-8": { input: 5.0, output: 25.0, cache_read: 0.5 },
  "claude-opus-4-7": { input: 5.0, output: 25.0, cache_read: 0.5 },
  "claude-opus-4-6": { input: 5.0, output: 25.0, cache_read: 0.5 },
  "claude-opus-4-5-20251101": { input: 5.0, output: 25.0, cache_read: 0.5 },
  "claude-opus-4-1-20250805": { input: 5.0, output: 25.0, cache_read: 0.5 },
  "claude-opus-4-20250514": { input: 5.0, output: 25.0, cache_read: 0.5 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, cache_read: 0.3 },
  "claude-sonnet-4-5-20250929": { input: 3.0, output: 15.0, cache_read: 0.3 },
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0, cache_read: 0.3 },
  "claude-3-7-sonnet-20250219": { input: 3.0, output: 15.0, cache_read: 0.3 },
  "claude-3-5-sonnet-20241022": { input: 3.0, output: 15.0, cache_read: 0.3 },
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0, cache_read: 0.1 },
  "claude-3-5-haiku-20241022": { input: 1.0, output: 5.0, cache_read: 0.1 },
};

/**
 * @class CostTracker
 * @description Tracks token usage, costs, budgets, and alerts for AI model usage.
 */
class CostTracker {
  /**
   * @param {object} opts
   * @param {string} [opts.dataDir] - Directory to store state.
   * @param {number} [opts.defaultBudget] - Default monthly budget.
   * @param {number} [opts.alertThreshold] - Alert threshold percentage.
   */
  constructor(opts = {}) {
    this.dataDir = opts.dataDir || ".";
    this.stateFile = path.join(this.dataDir, "cost-tracker-state.json");

    this.sessions = new Map();
    this.budgets = new Map();
    this.alerts = [];
    this.modelCosts = { ...DEFAULT_MODEL_COSTS };
    this.onUsageRecorded = opts.onUsageRecorded || null; // callback({sessionId, taskId, model, cost, ...})

    this._loadState();
  }

  /**
   * Records model usage and updates session and budget information.
   * @param {object} params
   * @param {string} params.sessionId
   * @param {string} params.model
   * @param {number} params.inputTokens
   * @param {number} params.outputTokens
   * @param {string} [params.agentId]
   * @param {string} [params.workspace]
   * @returns {{ok: boolean, error?: string}}
   */
  recordUsage({
    sessionId,
    model,
    inputTokens,
    outputTokens,
    agentId,
    workspace,
    taskId,
  }) {
    if (!model || (inputTokens === 0 && outputTokens === 0)) {
      return { ok: false, error: "Missing required parameters." };
    }
    // Auto-generate sessionId from taskId or agentId if not provided
    if (!sessionId) {
      sessionId = taskId ? `task_${taskId}` : agentId ? `agent_${agentId}` : `session_${Date.now()}`;
    }

    let modelCost = this.modelCosts[model];
    if (!modelCost) {
      // Try case-insensitive lookup (API might return "MiMo-V2.5-Pro" vs "mimo-v2.5-pro")
      const modelLower = model.toLowerCase();
      for (const [key, cost] of Object.entries(this.modelCosts)) {
        if (key.toLowerCase() === modelLower) {
          modelCost = cost;
          this.modelCosts[model] = modelCost; // Cache for future lookups
          break;
        }
      }
    }
    if (!modelCost) {
      // Fallback: use generic pricing for unknown models so usage is still tracked.
      // This ensures token data is never silently lost.
      console.warn(`[CostTracker] Unknown model "${model}" — using generic pricing`);
      modelCost = { input: 3.0, output: 15.0 }; // ~Claude Sonnet tier
      this.modelCosts[model] = modelCost;
    }

    const cost =
      (inputTokens * modelCost.input + outputTokens * modelCost.output) /
      1_000_000;

    const session = this.sessions.get(sessionId) || {
      startedAt: Date.now(),
      model,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      agentId,
      workspace,
      taskId,
    };
    // Update taskId if provided (may be set after session creation)
    if (taskId && !session.taskId) session.taskId = taskId;

    session.inputTokens += inputTokens;
    session.outputTokens += outputTokens;
    session.costUsd += cost;

    this.sessions.set(sessionId, session);

    if (this.sessions.size > 10000) {
      const oldestSessionId = this.sessions.keys().next().value;
      this.sessions.delete(oldestSessionId);
    }

    if (workspace) {
      this._checkBudget(workspace, cost);
    }

    if (session.costUsd > 1) {
      this._fireAlert({
        type: "high_session_cost",
        message: `Session ${sessionId} cost has exceeded $1.00`,
        sessionId,
        cost: session.costUsd,
      });
    }

    this._saveState();

    // Notify listeners (for emitting tokens:updated events)
    if (this.onUsageRecorded) {
      try { this.onUsageRecorded({ sessionId, taskId, model, inputTokens, outputTokens, cost, agentId, workspace }); } catch {}
    }

    return { ok: true };
  }

  /**
   * Provides a summary of costs and token usage.
   * @param {object} params
   * @param {string} [params.workspace]
   * @param {string} [params.sessionId]
   * @param {'today' | 'week' | 'month' | 'all'} [params.period='all']
   * @returns {{ok: boolean, data?: object, error?: string}}
   */
  summary({ workspace, sessionId, period = "all" } = {}) {
    let filteredSessions = Array.from(this.sessions.values());

    if (workspace) {
      filteredSessions = filteredSessions.filter(
        (s) => s.workspace === workspace
      );
    }

    if (sessionId) {
      filteredSessions = filteredSessions.filter((s) =>
        s.sessionId.startsWith(sessionId)
      );
    }

    if (period !== "all") {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      let startDate;

      switch (period) {
        case "today":
          startDate = today;
          break;
        case "week":
          startDate = new Date(today);
          startDate.setDate(today.getDate() - today.getDay());
          break;
        case "month":
          startDate = new Date(today.getFullYear(), today.getMonth(), 1);
          break;
      }

      if (startDate) {
        filteredSessions = filteredSessions.filter(
          (s) => s.startedAt >= startDate.getTime()
        );
      }
    }

    const totalCost = filteredSessions.reduce((acc, s) => acc + s.costUsd, 0);
    const totalInputTokens = filteredSessions.reduce(
      (acc, s) => acc + s.inputTokens,
      0
    );
    const totalOutputTokens = filteredSessions.reduce(
      (acc, s) => acc + s.outputTokens,
      0
    );

    const byModel = filteredSessions.reduce((acc, s) => {
      if (!acc[s.model]) {
        acc[s.model] = {
          cost: 0,
          inputTokens: 0,
          outputTokens: 0,
          sessions: 0,
        };
      }
      acc[s.model].cost += s.costUsd;
      acc[s.model].inputTokens += s.inputTokens;
      acc[s.model].outputTokens += s.outputTokens;
      acc[s.model].sessions++;
      return acc;
    }, {});

    const byAgent = filteredSessions.reduce((acc, s) => {
      if (!s.agentId) return acc;
      if (!acc[s.agentId]) {
        acc[s.agentId] = {
          cost: 0,
          inputTokens: 0,
          outputTokens: 0,
          sessions: 0,
        };
      }
      acc[s.agentId].cost += s.costUsd;
      acc[s.agentId].inputTokens += s.inputTokens;
      acc[s.agentId].outputTokens += s.outputTokens;
      acc[s.agentId].sessions++;
      return acc;
    }, {});

    return {
      ok: true,
      data: {
        totalCost,
        totalInputTokens,
        totalOutputTokens,
        byModel,
        byAgent,
      },
    };
  }

  /**
   * Returns cost breakdown by taskId.
   * @param {object} [params]
   * @param {string} [params.workspace]
   * @param {'today' | 'week' | 'month' | 'all'} [params.period='all']
   * @returns {{ok: boolean, data?: object}}
   */
  taskSummary({ workspace, period = "all" } = {}) {
    let filteredSessions = Array.from(this.sessions.values());

    if (workspace) {
      filteredSessions = filteredSessions.filter((s) => s.workspace === workspace);
    }

    if (period !== "all") {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      let startDate;
      switch (period) {
        case "today": startDate = today; break;
        case "week": startDate = new Date(today); startDate.setDate(today.getDate() - today.getDay()); break;
        case "month": startDate = new Date(today.getFullYear(), today.getMonth(), 1); break;
      }
      if (startDate) {
        filteredSessions = filteredSessions.filter((s) => s.startedAt >= startDate.getTime());
      }
    }

    const byTask = {};
    for (const s of filteredSessions) {
      const key = s.taskId || s.sessionId;
      if (!byTask[key]) {
        byTask[key] = { taskId: s.taskId || null, cost: 0, inputTokens: 0, outputTokens: 0, sessions: 0, model: s.model, agentId: s.agentId, startedAt: s.startedAt };
      }
      byTask[key].cost += s.costUsd;
      byTask[key].inputTokens += s.inputTokens;
      byTask[key].outputTokens += s.outputTokens;
      byTask[key].sessions++;
    }

    // Sort by cost descending
    const tasks = Object.values(byTask).sort((a, b) => b.cost - a.cost);
    return { ok: true, data: { tasks, totalTasks: tasks.length } };
  }

  /**
   * Sets a budget for a workspace.
   * @param {object} params
   * @param {string} params.workspace
   * @param {number} [params.dailyLimit]
   * @param {number} [params.monthlyLimit]
   * @returns {{ok: boolean, error?: string}}
   */
  setBudget({ workspace, dailyLimit, monthlyLimit }) {
    if (!workspace) {
      return { ok: false, error: "Workspace is required." };
    }

    const budget = this.budgets.get(workspace) || {
      dailyLimit: 0,
      monthlyLimit: 0,
      spentToday: 0,
      spentMonth: 0,
      lastReset: Date.now(),
    };

    if (dailyLimit !== undefined) budget.dailyLimit = dailyLimit;
    if (monthlyLimit !== undefined) budget.monthlyLimit = monthlyLimit;

    this.budgets.set(workspace, budget);
    this._saveState();
    return { ok: true };
  }

  /**
   * Retrieves the budget status for a workspace.
   * @param {object} params
   * @param {string} params.workspace
   * @returns {{ok: boolean, data?: object, error?: string}}
   */
  getBudget({ workspace }) {
    if (!workspace) {
      return { ok: false, error: "Workspace is required." };
    }
    const budget = this.budgets.get(workspace);
    if (!budget) {
      return { ok: false, error: "Budget not found for this workspace." };
    }
    return { ok: true, data: budget };
  }

  /**
   * Retrieves recent alerts.
   * @param {object} params
   * @param {number} [params.limit=50]
   * @param {string} [params.type]
   * @returns {{ok: boolean, data?: object[]}}
   */
  getAlerts({ limit = 50, type } = {}) {
    let alerts = this.alerts;
    if (type) {
      alerts = alerts.filter((a) => a.type === type);
    }
    return { ok: true, data: alerts.slice(-limit) };
  }

  /**
   * Estimates the cost of a model usage without recording it.
   * @param {object} params
   * @param {string} params.model
   * @param {number} params.inputTokens
   * @param {number} params.outputTokens
   * @returns {{ok: boolean, data?: {cost: number}, error?: string}}
   */
  estimateCost({ model, inputTokens, outputTokens }) {
    let modelCost = this.modelCosts[model];
    if (!modelCost) {
      // Fallback for unknown models
      modelCost = { input: 3.0, output: 15.0 };
    }
    const cost =
      (inputTokens * modelCost.input + outputTokens * modelCost.output) /
      1_000_000;
    return { ok: true, data: { cost } };
  }

  /**
   * Lists all available models and their costs.
   * @returns {{ok: boolean, data?: object}}
   */
  listModels() {
    return { ok: true, data: this.modelCosts };
  }

  /**
   * Sets the cost for a specific model.
   * @param {object} params
   * @param {string} params.model
   * @param {number} params.inputCost
   * @param {number} params.outputCost
   * @returns {{ok: boolean, error?: string}}
   */
  setModelCost({ model, inputCost, outputCost }) {
    if (!model || inputCost === undefined || outputCost === undefined) {
      return { ok: false, error: "Missing required parameters." };
    }
    this.modelCosts[model] = { input: inputCost, output: outputCost };
    this._saveState();
    return { ok: true };
  }

  /**
   * Deletes a custom model cost, reverting to default pricing if available.
   * @param {object} params
   * @param {string} params.model
   * @returns {{ok: boolean, error?: string}}
   */
  deleteModelCost({ model }) {
    if (!model) return { ok: false, error: "Model is required." };
    if (DEFAULT_MODEL_COSTS[model]) {
      // Revert to default pricing
      this.modelCosts[model] = { ...DEFAULT_MODEL_COSTS[model] };
    } else {
      delete this.modelCosts[model];
    }
    this._saveState();
    return { ok: true };
  }

  /**
   * Saves the current state to a JSON file.
   * @private
   */
  _saveState() {
    try {
      const state = {
        sessions: Array.from(this.sessions.entries()),
        budgets: Array.from(this.budgets.entries()),
        alerts: this.alerts,
        modelCosts: this.modelCosts,
      };
      fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
    } catch (error) {
      console.error("Failed to save cost tracker state:", error);
    }
  }

  /**
   * Loads the state from a JSON file.
   * @private
   */
  _loadState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const state = JSON.parse(fs.readFileSync(this.stateFile, "utf-8"));
        this.sessions = new Map(state.sessions);
        this.budgets = new Map(state.budgets);
        this.alerts = state.alerts || [];
        // Merge: DEFAULT_MODEL_COSTS provides new models added in code updates,
        // state.modelCosts preserves user-customized prices (user overrides win).
        this.modelCosts = { ...DEFAULT_MODEL_COSTS, ...(state.modelCosts || {}) };
      }
    } catch (error) {
      console.error("Failed to load cost tracker state:", error);
    }
  }

  /**
   * Checks the budget for a workspace and fires alerts if necessary.
   * @param {string} workspace
   * @param {number} cost
   * @private
   */
  _checkBudget(workspace, cost) {
    const budget = this.budgets.get(workspace);
    if (!budget) return;

    const now = new Date();
    const lastReset = new Date(budget.lastReset);

    if (now.getDate() !== lastReset.getDate()) {
      budget.spentToday = 0;
    }
    if (now.getMonth() !== lastReset.getMonth()) {
      budget.spentMonth = 0;
    }

    budget.spentToday += cost;
    budget.spentMonth += cost;
    budget.lastReset = now.getTime();

    const checkLimit = (limit, spent, period) => {
      if (limit > 0) {
        const usage = (spent / limit) * 100;
        if (usage >= 100) {
          this._fireAlert({
            type: "budget_exceeded",
            message: `${period} budget exceeded for workspace ${workspace}.`,
            cost,
          });
        } else if (usage >= 95) {
          this._fireAlert({
            type: "budget_critical",
            message: `${period} budget at 95% for workspace ${workspace}.`,
            cost,
          });
        } else if (usage >= 80) {
          this._fireAlert({
            type: "budget_warning",
            message: `${period} budget at 80% for workspace ${workspace}.`,
            cost,
          });
        }
      }
    };

    checkLimit(budget.dailyLimit, budget.spentToday, "Daily");
    checkLimit(budget.monthlyLimit, budget.spentMonth, "Monthly");
  }

  /**
   * Reset cost tracking data. Clears sessions, alerts, and optionally budgets.
   * @param {{ confirm: boolean, workspace?: string }}
   * @returns {{ ok: boolean, cleared: object }}
   */
  reset({ confirm, workspace } = {}) {
    if (!confirm) return { ok: false, error: "confirm must be true to reset" };

    const cleared = { sessions: 0, alerts: 0, budgets: 0 };

    if (workspace) {
      // Reset only specific workspace budget
      if (this.budgets.has(workspace)) {
        const b = this.budgets.get(workspace);
        b.spentToday = 0;
        b.spentMonth = 0;
        b.lastReset = Date.now();
        cleared.budgets = 1;
      }
      // Clear sessions for this workspace
      for (const [id, s] of this.sessions) {
        if (s.workspace === workspace) { this.sessions.delete(id); cleared.sessions++; }
      }
    } else {
      // Reset everything
      cleared.sessions = this.sessions.size;
      this.sessions.clear();
      cleared.alerts = this.alerts.length;
      this.alerts = [];
      for (const [, b] of this.budgets) {
        b.spentToday = 0;
        b.spentMonth = 0;
        b.lastReset = Date.now();
        cleared.budgets++;
      }
    }

    this._saveState();
    return { ok: true, cleared };
  }

  /**
   * Fires an alert and adds it to the alerts ring buffer.
   * @param {object} alert
   * @private
   */
  _fireAlert(alert) {
    const fullAlert = {
      timestamp: Date.now(),
      ...alert,
    };
    this.alerts.push(fullAlert);
    if (this.alerts.length > 500) {
      this.alerts.shift();
    }
  }
}

module.exports = { CostTracker, DEFAULT_MODEL_COSTS };
