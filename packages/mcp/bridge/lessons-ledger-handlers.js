"use strict";

/**
 * Handlers de correções aprendidas e de ledger de trabalho.
 *
 * Delegam ao MemoryStore (ver packages/memory/lessons-ledger.js). O que vive
 * aqui é o que depende do bridge e não do banco: resolução do workspace
 * corrente e a composição do bloco de boot que um pane recebe ao nascer.
 */
function createLessonsLedgerHandlers(opts = {}) {
  function getStore() {
    if (!opts.memoryStore) throw new Error("MemoryStore não inicializado");
    return opts.memoryStore;
  }

  const ws = () => opts.getCurrentWorkspacePath?.() || undefined;

  return {
    /**
     * Salva uma correção do usuário.
     *
     * O `status` devolvido é deliberadamente explícito: 'created',
     * 'enriched', 'deduped' ou 'refused'. Um agente que trate qualquer
     * resposta como sucesso vai dizer "lição salva" quando nada foi gravado.
     */
    async lessonAdd({ rule, negative, category, repo_scope, pane_id }) {
      return getStore().lessonAdd({
        rule,
        negative,
        category,
        repo_scope,
        source_pane: pane_id,
      });
    },

    async lessonList({ category, all_workspaces, limit }) {
      return getStore().lessonList({
        workspace: all_workspaces ? undefined : ws(),
        category,
        limit,
      });
    },

    async lessonRemove({ query, id }) {
      return getStore().lessonRemove({ query, id });
    },

    /**
     * Bloco de correções aplicáveis, pronto para injetar no prompt.
     * Escopado pelo workspace corrente — uma regra de outro projeto não deve
     * atravessar.
     */
    async lessonContext({ workspace, limit }) {
      return getStore().lessonContext({ workspace: workspace || ws(), limit });
    },

    // ── Ledger de trabalho ──────────────────────────────────────────────

    async ledgerRecord(args) {
      return getStore().ledgerRecord({ ...args, workspace: args.workspace || ws() });
    },

    async ledgerRead({ session_id, event_limit }) {
      return getStore().ledgerRead({ session_id, event_limit });
    },

    async ledgerSnapshot({ session_id }) {
      return getStore().ledgerSnapshot({ session_id });
    },

    async ledgerList({ include_terminal, limit }) {
      return getStore().ledgerList({ workspace: ws(), include_terminal, limit });
    },

    /**
     * Contexto de boot de um pane: correções aplicáveis + ledger do
     * workstream, num único bloco.
     *
     * É o ponto onde as duas tabelas passam a mudar comportamento em vez de
     * só existirem. Um worker que nasce por `pane_spawn` recebe as regras que
     * o usuário já ditou e, se estiver retomando um workstream, o que já foi
     * tentado e descartado — em vez de redescobrir os dois errando.
     */
    async agentBootContext({ session_id, workspace, limit }) {
      const store = getStore();
      const parts = [];

      const lessons = store.lessonContext({ workspace: workspace || ws(), limit });
      if (lessons.ok && lessons.text) parts.push(lessons.text);

      let ledgerPresent = false;
      if (session_id) {
        const snap = store.ledgerSnapshot({ session_id });
        if (snap.ok && snap.text) {
          parts.push(snap.text);
          ledgerPresent = true;
        }
      }

      return {
        ok: true,
        text: parts.join("\n\n"),
        lessons: lessons.count || 0,
        ledger: ledgerPresent,
        empty: parts.length === 0,
      };
    },

    /**
     * Reentrada informada do juiz de objetivo.
     *
     * `goalJudge` decide se o agente continua, mas a instrução de
     * continuação hoje não carrega nada do que já falhou — por isso um loop
     * consegue gastar as 12 reentradas repetindo a mesma abordagem. Aqui o
     * veredito é combinado com o ledger para que a reentrada diga também o
     * que NÃO tentar de novo.
     *
     * Não substitui `goalJudge`: consome o resultado dele.
     */
    async goalJudgeWithLedger({ paneId, session_id, satisfied, impossible, reason }) {
      const store = getStore();
      const sid = session_id || paneId;

      const verdict = await opts.goalHandlers?.goalJudge?.({ paneId, satisfied, impossible, reason });
      if (!verdict) return { ok: false, error: "goalHandlers.goalJudge indisponível no bridge" };
      if (!verdict.ok) return verdict;

      // Um veredito negativo é informação sobre uma abordagem que não deu
      // certo: registrar aqui é o que impede a próxima reentrada de repeti-la.
      if (!satisfied && !impossible && reason) {
        store.ledgerRecord({
          session_id: sid,
          workspace: ws(),
          event: `juiz: não satisfeito (reentrada ${verdict.reEntryCount}) — ${reason}`,
          event_kind: "tried",
          tried_approach: reason,
          tried_rejected_because: "juiz avaliou como objetivo não satisfeito",
        });
      }

      const snap = store.ledgerSnapshot({ session_id: sid });
      return { ...verdict, ledgerContext: snap.text || "", hasLedger: !!snap.text };
    },
  };
}

module.exports = { createLessonsLedgerHandlers };
