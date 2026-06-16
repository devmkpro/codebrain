"use strict";

/**
 * Provider-Specific System Prompts (MiMo-inspired)
 * Returns model-specific prompt additions optimized for each model family.
 * Claude → reasoning-focused, Gemini → tool-efficient, GPT → structured, MIMO → creative.
 */

const MODEL_FAMILY_MAP = {
  "claude": "anthropic", "anthropic": "anthropic", "haiku": "anthropic", "sonnet": "anthropic", "opus": "anthropic",
  "gemini": "google", "google": "google",
  "gpt": "openai", "openai": "openai", "codex": "openai",
  "mimo": "mimo", "mimo-v2": "mimo", "mimo-v2.5": "mimo",
  "deepseek": "deepseek", "qwen": "qwen",
};

const PROVIDER_PROMPTS = {
  anthropic: `
## Model-Specific Instructions (Claude/Anthropic)
- Use extended thinking for complex reasoning — think step by step before acting.
- Prefer thorough analysis over speed. Read files completely before editing.
- When uncertain, use memory_search to check for prior context before asking the user.
- Leverage tool use efficiently — batch independent calls when possible.
- For code changes, always read the file first, then make targeted edits.`,

  google: `
## Model-Specific Instructions (Gemini/Google)
- Be direct and tool-efficient. Minimize unnecessary back-and-forth.
- Use structured outputs when possible (JSON, tables).
- For large files, use file_budgeted_read to stay within context limits.
- Prefer concrete code examples over lengthy explanations.
- When parallelizing work, use pane_spawn for independent tasks.`,

  openai: `
## Model-Specific Instructions (GPT/OpenAI)
- Follow a structured step-by-step approach for complex tasks.
- Use the task tree (task_tree) to plan before executing.
- Always validate assumptions by reading relevant files first.
- Prefer explicit error handling in generated code.
- Use memory_write to persist important decisions immediately.`,

  mimo: `
## Model-Specific Instructions (MIMO)
- Be creative and thorough in problem-solving.
- Use parallel tool calls when tasks are independent.
- Always check patterns (pattern_list) before implementing common solutions.
- For complex refactors, use the orchestrator/worker squad pattern.
- Document findings in memory for future reference.`,

  deepseek: `
## Model-Specific Instructions (DeepSeek)
- Focus on code quality and correctness.
- Use systematic debugging: reproduce → isolate → fix → verify.
- Always run tests after code changes when possible.`,
};

function createProviderPromptHandlers(opts) {
  return {
    /** Get the provider-specific prompt additions for a model. */
    async providerPrompt({ model, providerId }) {
      try {
        const modelLower = (model || "").toLowerCase();
        let family = null;
        for (const [key, value] of Object.entries(MODEL_FAMILY_MAP)) {
          if (modelLower.includes(key)) { family = value; break; }
        }
        if (!family) family = "anthropic"; // default
        const prompt = PROVIDER_PROMPTS[family] || PROVIDER_PROMPTS.anthropic;
        return { ok: true, data: { family, model, prompt: prompt.trim() } };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** List all available provider prompt families. */
    async providerPromptList() {
      try {
        const families = Object.entries(PROVIDER_PROMPTS).map(([key, prompt]) => ({
          family: key, preview: prompt.trim().slice(0, 100) + "...",
        }));
        return { ok: true, data: families };
      } catch (e) { return { ok: false, error: e.message }; }
    },
  };
}

module.exports = { createProviderPromptHandlers, MODEL_FAMILY_MAP, PROVIDER_PROMPTS };
