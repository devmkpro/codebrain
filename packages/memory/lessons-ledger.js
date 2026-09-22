"use strict";

/* ═══════════════════════════════════════════════════════════════════════════
   CORREÇÕES APRENDIDAS + LEDGER DE TRABALHO
   ═══════════════════════════════════════════════════════════════════════════

   Duas capacidades que o Codebrain não tinha e que mudam o comportamento de
   agente autônomo de forma desproporcional ao tamanho do código:

   ── lessons ──────────────────────────────────────────────────────────────
   A correção do usuário sobrevive ao pane. Hoje o aprendizado do Codebrain é
   todo endógeno — `patterns` nasce de trajetória bem-sucedida e é pontuado
   por qualidade; `trajectories` guarda sequências de ação. Nada guarda a
   regra que o humano ditou. O resultado prático é o agente repetindo, no
   pane seguinte, o erro que o usuário acabou de corrigir.

   Uma lição NÃO é um pattern: não tem score, não decai, não é extraída de
   execução. É categórica e vale até alguém removê-la. Por isso tabela
   própria em vez de um `pattern_type: 'lesson'`.

   ── work_ledger ──────────────────────────────────────────────────────────
   Estado retomável de um workstream, com o registro explícito do que já foi
   tentado e descartado.

   O motivo concreto: `goal-handlers.js` reentra até 12 vezes quando o juiz
   devolve "não satisfeito", e nenhuma reentrada sabe o que as anteriores
   tentaram — `recordJudgeVerdict` guarda satisfied/impossible e uma razão.
   Um agente que já falhou com três abordagens reentra e tenta a primeira
   outra vez. `ledger_rejected` é o antídoto, e `ledgerSnapshot()` é o que
   torna isso utilizável: um bloco de texto compacto para reinjetar no
   prompt da reentrada.

   Regra de projeto deliberada: **fase não muda sem evento**. Um `phase` novo
   exige `event` + `event_kind` na mesma chamada. Sem isso o ledger viraria
   uma máquina de estados sem histórico — exatamente o defeito do checkpoint
   em markdown livre, onde nada obriga a registrar o porquê.

   ═══════════════════════════════════════════════════════════════════════════ */

/** Categorias aceitas para uma lição. */
const LESSON_CATEGORIES = new Set(["tool", "preference", "knowledge"]);

/** Fases terminais: encerram o workstream e param a injeção do snapshot. */
const TERMINAL_PHASES = new Set(["done", "abandoned"]);

/** Tipos de evento aceitos — classificar força o autor a dizer o que é. */
const EVENT_KINDS = new Set([
  "blocked",
  "decision",
  "note",
  "phase",
  "progress",
  "tried",
  "unblocked",
]);

/** Limite por campo. Uma regra longa não é regra, é documento. */
const MAX_RULE = 500;
const MAX_NEGATIVE = 500;

function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Normaliza a regra para dedup: minúsculas, pontuação e espaço colapsados.
 * Duas correções com a mesma intenção e vírgula diferente têm de colidir,
 * senão um loop autônomo salva a mesma lição a cada ciclo.
 */
function fingerprint(rule) {
  return String(rule)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * API de lições e ledger sobre uma conexão better-sqlite3 já migrada.
 * @param {any} db
 */
function createLessonsLedgerApi(db) {
  /* ── lessons ─────────────────────────────────────────────────────────── */

  const lessonStmts = {
    byFingerprint: db.prepare(`SELECT * FROM lessons WHERE fingerprint = ?`),
    insert: db.prepare(`
      INSERT INTO lessons (id, rule, negative, category, repo_scope, source_pane, fingerprint)
      VALUES (@id, @rule, @negative, @category, @repo_scope, @source_pane, @fingerprint)
    `),
    enrich: db.prepare(`
      UPDATE lessons SET negative = @negative, updated_at = unixepoch() WHERE id = @id
    `),
    all: db.prepare(`SELECT * FROM lessons ORDER BY created_at DESC LIMIT ?`),
    byCategory: db.prepare(`SELECT * FROM lessons WHERE category = ? ORDER BY created_at DESC LIMIT ?`),
    bumpHits: db.prepare(`UPDATE lessons SET hits = hits + 1 WHERE id = ?`),
    deleteById: db.prepare(`DELETE FROM lessons WHERE id = ?`),
    searchRule: db.prepare(`
      SELECT * FROM lessons
      WHERE lower(rule) LIKE ? OR lower(coalesce(negative,'')) LIKE ?
      ORDER BY created_at DESC
    `),
  };

  /** Uma lição se aplica ao workspace? Global (sem escopo) sempre se aplica. */
  function appliesTo(lesson, workspace) {
    if (!lesson.repo_scope) return true;
    if (!workspace) return false;
    const ws = String(workspace).replace(/\\/g, "/").toLowerCase();
    const scope = String(lesson.repo_scope).replace(/\\/g, "/").toLowerCase();
    return ws.includes(scope);
  }

  /* Implementações nomeadas em closure. Os métodos públicos apenas apontam
     para cá, em vez de se chamarem por `this`: a API é espalhada dentro do
     objeto do store e frequentemente desestruturada pelos handlers do bridge
     (`const { lessonContext } = store`), onde `this` chegaria undefined. */

  function lessonList({ workspace, category, limit = 200 } = {}) {
    const rows = category
      ? lessonStmts.byCategory.all(String(category).toLowerCase(), limit)
      : lessonStmts.all.all(limit);
    const lessons = workspace ? rows.filter((l) => appliesTo(l, workspace)) : rows;
    return { ok: true, count: lessons.length, lessons };
  }

  function ledgerRead({ session_id, event_limit = 20 }) {
    const sid = String(session_id || "").trim();
    if (!sid) return { ok: false, error: "session_id é obrigatório" };
    const row = db.prepare(`SELECT * FROM work_ledger WHERE session_id = ?`).get(sid);
    if (!row) return { ok: true, data: null, message: "sem ledger para esta sessão" };

    const events = db
      .prepare(`SELECT kind, note, created_at FROM ledger_events WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(sid, event_limit);
    const rejected = db
      .prepare(`SELECT approach, reason, created_at FROM ledger_rejected WHERE session_id = ? ORDER BY created_at ASC`)
      .all(sid);

    let artifacts = {};
    try { artifacts = JSON.parse(row.artifacts || "{}"); } catch { artifacts = {}; }

    return {
      ok: true,
      data: {
        session_id: row.session_id,
        workspace: row.workspace,
        goal: row.goal,
        phase: row.phase,
        next: row.next_step,
        terminal: TERMINAL_PHASES.has(String(row.phase)),
        artifacts,
        events,
        rejected,
        updated_at: row.updated_at,
      },
    };
  }

  return {
    /**
     * Salva uma correção do usuário.
     *
     * Devolve `status` honesto — 'created' | 'enriched' | 'deduped' |
     * 'refused' — porque quem chama precisa saber se REALMENTE gravou. Um
     * agente que reporta "lição salva" depois de um dedup mente para o
     * usuário.
     *
     * @param {{ rule: string, negative?: string, category?: string, repo_scope?: string, source_pane?: string }} args
     */
    lessonAdd({ rule, negative, category = "preference", repo_scope, source_pane }) {
      const text = String(rule || "").trim();
      if (!text) return { ok: false, status: "refused", error: "rule é obrigatória" };
      if (text.length > MAX_RULE) {
        return {
          ok: false,
          status: "refused",
          error: `rule tem ${text.length} caracteres; o limite é ${MAX_RULE}. Divida em lições separadas em vez de encurtar o sentido.`,
        };
      }
      const neg = negative ? String(negative).trim() : null;
      if (neg && neg.length > MAX_NEGATIVE) {
        return { ok: false, status: "refused", error: `negative excede ${MAX_NEGATIVE} caracteres` };
      }
      const cat = String(category || "preference").toLowerCase();
      if (!LESSON_CATEGORIES.has(cat)) {
        return {
          ok: false,
          status: "refused",
          error: `category inválida: ${category}. Use uma de ${[...LESSON_CATEGORIES].join(" | ")}`,
        };
      }

      const fp = fingerprint(text);
      const existing = lessonStmts.byFingerprint.get(fp);
      if (existing) {
        // Mesma regra chegando com o lado negativo que faltava: enriquece em
        // vez de duplicar ou descartar silenciosamente.
        if (neg && !existing.negative) {
          lessonStmts.enrich.run({ id: existing.id, negative: neg });
          return { ok: true, status: "enriched", id: existing.id };
        }
        return { ok: true, status: "deduped", id: existing.id, message: "lição equivalente já registrada" };
      }

      const id = genId("lsn");
      lessonStmts.insert.run({
        id,
        rule: text,
        negative: neg,
        category: cat,
        repo_scope: repo_scope ? String(repo_scope).trim() : null,
        source_pane: source_pane || null,
        fingerprint: fp,
      });
      return { ok: true, status: "created", id };
    },

    /**
     * Lista lições. Com `workspace`, devolve apenas as aplicáveis — global
     * mais as cujo `repo_scope` é fragmento daquele caminho.
     */
    lessonList,

    /** Remove lições cuja regra ou negativa contenha o trecho. */
    lessonRemove({ query, id }) {
      if (id) {
        const res = lessonStmts.deleteById.run(id);
        return { ok: true, removed: res.changes, ids: res.changes ? [id] : [] };
      }
      const q = String(query || "").trim().toLowerCase();
      if (!q) return { ok: false, error: "informe query ou id" };
      const like = `%${q}%`;
      const matches = lessonStmts.searchRule.all(like, like);
      const remove = db.transaction((rows) => {
        for (const row of rows) lessonStmts.deleteById.run(row.id);
      });
      remove(matches);
      return { ok: true, removed: matches.length, ids: matches.map((m) => m.id) };
    },

    /**
     * Bloco de texto pronto para injetar no prompt de um agente.
     *
     * É aqui que a tabela deixa de ser um CRUD e passa a mudar
     * comportamento: o pane que nasce recebe as correções já aplicáveis ao
     * workspace, em vez de descobri-las errando.
     *
     * `hits` é incrementado para que se possa ver qual lição está de fato
     * sendo carregada — lição que nunca é injetada é lição com escopo errado.
     */
    lessonContext({ workspace, limit = 40 } = {}) {
      const { lessons } = lessonList({ workspace, limit });
      if (lessons.length === 0) return { ok: true, text: "", count: 0 };

      const bump = db.transaction((rows) => {
        for (const row of rows) lessonStmts.bumpHits.run(row.id);
      });
      bump(lessons);

      const lines = lessons.map((l) => {
        const scope = l.repo_scope ? ` (só em ${l.repo_scope})` : "";
        const neg = l.negative ? `\n  NÃO: ${l.negative}` : "";
        return `- [${l.category}]${scope} ${l.rule}${neg}`;
      });

      return {
        ok: true,
        count: lessons.length,
        text: [
          "[CORREÇÕES APRENDIDAS — regras ditadas pelo usuário em sessões anteriores.",
          "Elas têm precedência sobre o comportamento padrão. Não repita um erro já corrigido aqui.]",
          ...lines,
          "[FIM DAS CORREÇÕES]",
        ].join("\n"),
      };
    },

    /* ── work ledger ───────────────────────────────────────────────────── */

    /**
     * Registra um passo de trabalho. Campos omitidos preservam o valor
     * anterior — atualização parcial é o caso normal, e nunca é jeito de
     * apagar estado.
     *
     * Mudança de `phase` exige `event` + `event_kind`: fase não se move sem
     * motivo registrado.
     *
     * @param {{ session_id: string, workspace?: string, goal?: string, phase?: string,
     *           next?: string, event?: string, event_kind?: string,
     *           tried_approach?: string, tried_rejected_because?: string,
     *           artifacts?: Record<string,string> }} args
     */
    ledgerRecord({
      session_id,
      workspace,
      goal,
      phase,
      next,
      event,
      event_kind,
      tried_approach,
      tried_rejected_because,
      artifacts,
    }) {
      const sid = String(session_id || "").trim();
      if (!sid) return { ok: false, error: "session_id é obrigatório" };

      if (phase !== undefined) {
        if (!event || !String(event).trim()) {
          return { ok: false, error: "mudar phase exige um event descrevendo o motivo" };
        }
        if (!event_kind || !EVENT_KINDS.has(String(event_kind).toLowerCase())) {
          return {
            ok: false,
            error: `mudar phase exige event_kind válido: ${[...EVENT_KINDS].join(" | ")}`,
          };
        }
      }
      if (event_kind && !EVENT_KINDS.has(String(event_kind).toLowerCase())) {
        return { ok: false, error: `event_kind inválido: ${event_kind}` };
      }

      const current = db.prepare(`SELECT * FROM work_ledger WHERE session_id = ?`).get(sid);

      const apply = db.transaction(() => {
        if (!current) {
          db.prepare(`
            INSERT INTO work_ledger (session_id, workspace, goal, phase, next_step, artifacts)
            VALUES (@session_id, @workspace, @goal, @phase, @next_step, @artifacts)
          `).run({
            session_id: sid,
            workspace: workspace || null,
            goal: goal || null,
            phase: phase || "starting",
            next_step: next || null,
            artifacts: JSON.stringify(artifacts || {}),
          });
        } else {
          // Merge de artifacts em vez de substituição: o ponteiro de branch
          // gravado três passos atrás não pode desaparecer porque este passo
          // só tinha o número do PR.
          let mergedArtifacts = current.artifacts;
          if (artifacts && typeof artifacts === "object") {
            let prev = {};
            try { prev = JSON.parse(current.artifacts || "{}"); } catch { prev = {}; }
            mergedArtifacts = JSON.stringify({ ...prev, ...artifacts });
          }
          db.prepare(`
            UPDATE work_ledger SET
              workspace  = coalesce(@workspace, workspace),
              goal       = coalesce(@goal, goal),
              phase      = coalesce(@phase, phase),
              next_step  = coalesce(@next_step, next_step),
              artifacts  = @artifacts,
              updated_at = unixepoch()
            WHERE session_id = @session_id
          `).run({
            session_id: sid,
            workspace: workspace || null,
            goal: goal || null,
            phase: phase || null,
            next_step: next || null,
            artifacts: mergedArtifacts,
          });
        }

        if (event && String(event).trim()) {
          db.prepare(`
            INSERT INTO ledger_events (id, session_id, kind, note)
            VALUES (?, ?, ?, ?)
          `).run(genId("lev"), sid, String(event_kind || "note").toLowerCase(), String(event).trim());
        }

        if (tried_approach && String(tried_approach).trim()) {
          db.prepare(`
            INSERT INTO ledger_rejected (id, session_id, approach, reason)
            VALUES (?, ?, ?, ?)
          `).run(
            genId("lrj"),
            sid,
            String(tried_approach).trim(),
            tried_rejected_because ? String(tried_rejected_because).trim() : null,
          );
        }
      });

      apply();

      const row = db.prepare(`SELECT * FROM work_ledger WHERE session_id = ?`).get(sid);
      return {
        ok: true,
        session_id: sid,
        phase: row.phase,
        terminal: TERMINAL_PHASES.has(String(row.phase)),
        created: !current,
      };
    },

    /** Lê o ledger completo: estado, últimos eventos e abordagens descartadas. */
    ledgerRead,

    /**
     * Snapshot compacto para reinjeção — o formato que importa na reentrada
     * do juiz e depois de compactação de contexto.
     *
     * Devolve vazio numa fase terminal: reinjetar o estado de um trabalho
     * encerrado só faz o agente reabrir o que já acabou.
     */
    ledgerSnapshot({ session_id }) {
      const res = ledgerRead({ session_id, event_limit: 5 });
      if (!res.ok || !res.data) return { ok: true, text: "", present: false };
      const d = res.data;
      if (d.terminal) return { ok: true, text: "", present: false, terminal: true };

      const out = [`[LEDGER DE TRABALHO — estado durável desta sessão; vale mais que sua lembrança dos ciclos anteriores]`];
      if (d.goal) out.push(`Objetivo: ${d.goal}`);
      out.push(`Fase: ${d.phase}`);
      if (d.next) out.push(`Próximo passo: ${d.next}`);
      if (Object.keys(d.artifacts).length > 0) {
        out.push(`Onde o trabalho vive: ${Object.entries(d.artifacts).map(([k, v]) => `${k}=${v}`).join(", ")}`);
      }
      if (d.rejected.length > 0) {
        out.push("Já tentado e DESCARTADO — não repita:");
        for (const r of d.rejected) {
          out.push(`  - ${r.approach}${r.reason ? ` — ${r.reason}` : ""}`);
        }
      }
      if (d.events.length > 0) {
        out.push("Últimos passos:");
        for (const e of d.events) out.push(`  - [${e.kind}] ${e.note}`);
      }
      out.push("[FIM DO LEDGER]");

      return { ok: true, text: out.join("\n"), present: true, phase: d.phase };
    },

    /** Lista workstreams, por padrão só os não terminais. */
    ledgerList({ workspace, include_terminal = false, limit = 50 } = {}) {
      const rows = db
        .prepare(`SELECT session_id, workspace, goal, phase, next_step, updated_at FROM work_ledger ORDER BY updated_at DESC LIMIT ?`)
        .all(limit);
      const filtered = rows.filter((r) => {
        if (workspace && r.workspace && r.workspace !== workspace) return false;
        if (!include_terminal && TERMINAL_PHASES.has(String(r.phase))) return false;
        return true;
      });
      return { ok: true, count: filtered.length, ledgers: filtered };
    },
  };
}

module.exports = {
  createLessonsLedgerApi,
  LESSON_CATEGORIES,
  TERMINAL_PHASES,
  EVENT_KINDS,
  fingerprint,
};
