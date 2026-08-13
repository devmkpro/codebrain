"use strict";

/* ═══════════════════════════════════════════════════════════════════════════
   MIGRAÇÕES DE SCHEMA — LISTA
   ═══════════════════════════════════════════════════════════════════════════

   Toda alteração de schema a partir daqui entra nesta lista. O runner
   (`migrations.js`) aplica em ordem, uma transação por migração, e falha
   ruidosamente.

   NÃO edite uma migração já publicada. Corrigir = adicionar outra.

   ── Contexto da baseline ─────────────────────────────────────────────────

   O schema anterior a este arquivo foi construído imperativamente dentro de
   `createMemoryStore()` — ~450 linhas de `CREATE TABLE IF NOT EXISTS` mais
   `ALTER TABLE` em try/catch. Esse bloco continua rodando, *antes* das
   migrações, e é idempotente.

   Portanto a versão 1 não cria nada: ela declara que o bloco legado é o
   ponto de partida e verifica se ele de fato produziu o que promete. Bancos
   já existentes em campo (`user_version = 0`, schema completo) recebem o
   carimbo da versão 1 sem alteração nenhuma; bancos novos chegam aqui já com
   o mesmo schema.

   A partir da versão 2, o bloco legado migra para cá aos poucos: cada tabela
   movida vira uma migração que a cria, e o `CREATE ... IF NOT EXISTS`
   correspondente sai do `createMemoryStore()`. É o caminho para eliminar o
   bloco imperativo sem um big bang no banco de todo mundo.

   ═══════════════════════════════════════════════════════════════════════════ */

const { hasTable } = require("./migrations.js");

/**
 * Tabelas que o bloco legado deve ter criado. Se alguma faltar quando a
 * baseline roda, algo saiu muito errado na inicialização — e é melhor
 * descobrir aqui, com nome da tabela, do que num `no such table` solto
 * três telas adiante.
 */
const BASELINE_TABLES = [
  "memories",
  "patterns",
  "trajectories",
  "events",
  "session_history",
  "agents",
  "agent_messages",
  "task_tree",
  "kanban_tasks",
  "missions",
  "notifications",
  "actor_registry",
  "token_usage",
  "cron_jobs",
];

/** @type {import("./migrations.js").Migration[]} */
const migrations = [
  {
    version: 1,
    name: "baseline",
    up(db) {
      const missing = BASELINE_TABLES.filter((table) => !hasTable(db, table));
      if (missing.length > 0) {
        throw new Error(
          `baseline: tabelas ausentes após a inicialização legada: ${missing.join(", ")}. ` +
            `O bloco de schema em createMemoryStore() deve rodar antes das migrações.`,
        );
      }
    },
  },
];

module.exports = { migrations, BASELINE_TABLES };
