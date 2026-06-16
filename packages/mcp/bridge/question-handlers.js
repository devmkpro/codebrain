"use strict";

/**
 * Question Tool Handlers (MiMo-inspired)
 * Agent asks user structured questions with predefined options.
 * Supports "never-ask" mode for headless autonomous execution.
 */

function createQuestionHandlers(opts) {
  const pendingQuestions = new Map(); // questionId → { question, options, resolve }

  return {
    /** Ask a structured question to the user. */
    async questionAsk({ paneId, question, options, allowCustom = true }) {
      try {
        const questionId = `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        // In headless/never-ask mode, auto-resolve
        if (opts.headlessMode) {
          return {
            ok: true, questionId, autoResolved: true,
            answer: options?.[0] || "(auto-resolved in headless mode)",
            message: "Auto-resolved: headless mode active. Agent should pick the best option.",
          };
        }
        // Store pending question
        pendingQuestions.set(questionId, { question, options, allowCustom, paneId, createdAt: Date.now() });
        // Inject question into pane terminal for visibility
        try {
          const optsList = (options || []).map((o, i) => `  ${i + 1}. ${o}`).join("\n");
          const prompt = `\n❓ QUESTION for user:\n${question}\n${optsList}\n${allowCustom ? "  (or type a custom answer)\n" : ""}\nUse question_answer tool with questionId="${questionId}" and your chosen answer.\n`;
          opts.ptyManager?.write(paneId, prompt, false);
        } catch {}
        return { ok: true, questionId, question, options, allowCustom };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Submit an answer to a pending question. */
    async questionAnswer({ questionId, answer }) {
      try {
        const pending = pendingQuestions.get(questionId);
        if (!pending) return { ok: false, error: "Question not found or already answered" };
        pendingQuestions.delete(questionId);
        return { ok: true, questionId, answer, question: pending.question };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** List pending questions. */
    async questionList() {
      try {
        const questions = [];
        for (const [id, q] of pendingQuestions) {
          questions.push({ questionId: id, question: q.question, options: q.options, paneId: q.paneId, age: Date.now() - q.createdAt });
        }
        return { ok: true, data: questions };
      } catch (e) { return { ok: false, error: e.message }; }
    },
  };
}

module.exports = { createQuestionHandlers };
