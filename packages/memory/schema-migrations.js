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

const { hasTable, hasIndex } = require("./migrations.js");

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

  /* ─────────────────────────────────────────────────────────────────────────
     v2 — CORREÇÕES APRENDIDAS + LEDGER DE TRABALHO

     Duas lacunas distintas, mas que se reforçam.

     1. `lessons` — o que o USUÁRIO corrigiu. O Codebrain já aprende sozinho
        (`patterns`, `trajectories`): padrão extraído de execução bem-sucedida,
        pontuado por qualidade. O que nunca foi guardado é a correção humana
        — "nunca use react-native-svg neste app", "sempre rode o typecheck
        antes de dizer que terminou". Hoje isso vive no scrollback de um pane
        e morre com ele: o próximo agente repete o erro que o usuário já
        corrigiu três vezes. `patterns` não serve para isso, porque nasce de
        sucesso automático e é pontuado, enquanto uma correção é uma regra
        categórica, sem score, e vale até ser removida.

        `repo_scope` existe porque uma regra verdadeira de UM projeto é falsa
        nos outros. Guardada como fragmento de caminho: a lição só é injetada
        quando o workspace contém aquele fragmento.

        `fingerprint` é dedup real. Sem ele, um agente que salva a mesma
        correção em ciclos consecutivos de um loop autônomo enche a tabela de
        cópias e o bloco injetado degenera.

     2. `work_ledger` — estado retomável de um workstream.

        O par goal/judge (`goal-handlers.js`) reentra até 12 vezes quando o
        juiz diz "não satisfeito". Nenhuma dessas reentradas sabe o que as
        anteriores já tentaram: o veredito guarda apenas satisfied/impossible
        e uma razão em texto. Um agente que tentou três abordagens erradas
        reentra e tenta a primeira de novo — é assim que um loop queima 12
        reentradas andando em círculo.

        `ledger_rejected` é o que fecha esse buraco: abordagem tentada + por
        que foi descartada. `next_step` guarda INTENÇÃO concreta, não status
        ("adicionar o branch de Windows em _safe_chmod, o teste já falha"),
        que é o que um retomador frio precisa. O checkpoint existente
        (markdown livre em disco) não cobre isso: é blob, não estrutura, e
        nada garante que a abordagem descartada esteja lá.
     ───────────────────────────────────────────────────────────────────── */
  {
    version: 2,
    name: "lessons_and_work_ledger",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS lessons (
          id          TEXT PRIMARY KEY,
          rule        TEXT NOT NULL,
          negative    TEXT,
          category    TEXT NOT NULL DEFAULT 'preference',
          repo_scope  TEXT,
          source_pane TEXT,
          fingerprint TEXT NOT NULL UNIQUE,
          hits        INTEGER NOT NULL DEFAULT 0,
          created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS work_ledger (
          session_id TEXT PRIMARY KEY,
          workspace  TEXT,
          goal       TEXT,
          phase      TEXT NOT NULL DEFAULT 'starting',
          next_step  TEXT,
          artifacts  TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `);

      // Log append-only. ON DELETE CASCADE porque foreign_keys = ON está
      // ligado nos PRAGMAs de conexão: apagar o ledger leva o rastro com ele.
      db.exec(`
        CREATE TABLE IF NOT EXISTS ledger_events (
          id         TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES work_ledger(session_id) ON DELETE CASCADE,
          kind       TEXT NOT NULL,
          note       TEXT NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS ledger_rejected (
          id         TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES work_ledger(session_id) ON DELETE CASCADE,
          approach   TEXT NOT NULL,
          reason     TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `);

      if (!hasIndex(db, "idx_lessons_scope")) {
        db.exec(`CREATE INDEX idx_lessons_scope ON lessons(repo_scope)`);
      }
      if (!hasIndex(db, "idx_ledger_events_session")) {
        db.exec(`CREATE INDEX idx_ledger_events_session ON ledger_events(session_id, created_at DESC)`);
      }
      if (!hasIndex(db, "idx_ledger_rejected_session")) {
        db.exec(`CREATE INDEX idx_ledger_rejected_session ON ledger_rejected(session_id)`);
      }
    },
  },

  /* ─────────────────────────────────────────────────────────────────────────
     v3 — VERIFICAÇÃO VISUAL: CONCESSÕES DE ACESSO E EXECUÇÕES

     `verify_grants` é um registro de CONSENTIMENTO, não um cofre. Nenhuma
     coluna guarda senha, hash ou cookie — de propósito, e essa ausência é a
     decisão de projeto mais importante da tabela. Um login acontece de duas
     formas: com credencial declarada no seeder do próprio repositório, lida
     do arquivo versionado no instante de digitar, ou com o usuário digitando
     à mão no painel Browser. Nos dois casos não há segredo para persistir, e
     por isso não existe coluna para ele — o schema impede o atalho.

     O que a tabela guarda é quem foi autorizado, com que papel, contra qual
     URL de loopback, por quanto tempo e por qual modo. `status` começa em
     `pending`: uma concessão só vale depois de aprovada, e expira.

     `verify_runs` guarda o veredito de cada execução para que "a alteração
     foi de fato feita?" tenha resposta auditável depois — com o diretório de
     evidências, onde ficam os prints.
     ───────────────────────────────────────────────────────────────────── */
  {
    version: 3,
    name: "verify_grants_and_runs",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS verify_grants (
          id           TEXT PRIMARY KEY,
          workspace    TEXT NOT NULL,
          base_url     TEXT NOT NULL,
          identity     TEXT NOT NULL,
          role         TEXT,
          mode         TEXT NOT NULL DEFAULT 'manual',
          status       TEXT NOT NULL DEFAULT 'pending',
          reason       TEXT,
          credential_file TEXT,
          credential_line INTEGER,
          approved_by  TEXT,
          expires_at   INTEGER,
          created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS verify_runs (
          id          TEXT PRIMARY KEY,
          workspace   TEXT NOT NULL,
          session_id  TEXT,
          base_url    TEXT,
          verdict     TEXT NOT NULL DEFAULT 'planned',
          summary     TEXT,
          plan        TEXT NOT NULL DEFAULT '{}',
          results     TEXT NOT NULL DEFAULT '[]',
          evidence_dir TEXT,
          created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `);

      if (!hasIndex(db, "idx_verify_grants_lookup")) {
        db.exec(`CREATE INDEX idx_verify_grants_lookup ON verify_grants(workspace, status, expires_at)`);
      }
      if (!hasIndex(db, "idx_verify_runs_workspace")) {
        db.exec(`CREATE INDEX idx_verify_runs_workspace ON verify_runs(workspace, created_at DESC)`);
      }
    },
  },
];

module.exports = { migrations, BASELINE_TABLES };
