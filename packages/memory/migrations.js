"use strict";

/* ═══════════════════════════════════════════════════════════════════════════
   MIGRAÇÕES DE SCHEMA
   ═══════════════════════════════════════════════════════════════════════════

   Antes disto, a evolução do schema era feita assim:

       const addColumn = (table, colDef) => {
         try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef}`); } catch {}
       };

   Três problemas, todos já materializados no banco de produção:

   1. O catch vazio engole *qualquer* erro. Um typo no SQL, uma tabela que
      não existe, um banco corrompido — tudo vira no-op silencioso. A coluna
      simplesmente não aparece e a falha só surge muito depois, como um
      `no such column` em runtime.
   2. Não há registro de versão. Não dá para saber em que estado um banco
      está, se uma alteração foi aplicada, nem escrever uma migração que
      dependa de outra ter rodado antes.
   3. Não há transação. Uma alteração de múltiplos passos que falha no meio
      deixa o banco num estado inconsistente e sem volta.

   Este runner corrige os três: versão em `PRAGMA user_version`, uma
   transação por migração, e falha ruidosa. Uma migração que quebra impede a
   subida em vez de deixar o app rodar com schema meio aplicado.

   ── COMO ADICIONAR UMA MIGRAÇÃO ─────────────────────────────────────────

       {
         version: 4,
         name: "add_spec_status_index",
         up(db) {
           db.exec(`CREATE INDEX idx_specs_status ON specs(status)`);
         },
       }

   Regras:
   • `version` é sequencial e nunca muda depois de publicada.
   • Migração publicada é imutável. Corrigir = nova migração.
   • `up` roda dentro de transação; não abra outra.
   • Prefira os helpers `addColumnIfMissing` / `hasTable` a try/catch.

   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @typedef {object} Migration
 * @property {number}   version  Sequencial, começando em 1. Imutável depois de publicada.
 * @property {string}   name     Slug descritivo, usado em log e auditoria.
 * @property {(db: any) => void} up  Aplica a alteração. Roda em transação.
 */

/** Nome da tabela de auditoria. `user_version` é a fonte da verdade; esta
 *  tabela existe para diagnóstico — o que rodou, quando, e em quanto tempo. */
const AUDIT_TABLE = "schema_migrations";

/* ── Introspecção ──────────────────────────────────────────────────────────
   Helpers que perguntam ao schema em vez de tentar-e-ignorar-o-erro. É a
   diferença entre "a coluna já existe" e "o SQL estava errado".              */

/** A tabela existe? */
function hasTable(db, table) {
  const row = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?`)
    .get(table);
  return row !== undefined;
}

/** A coluna existe nesta tabela? */
function hasColumn(db, table, column) {
  if (!hasTable(db, table)) return false;
  // PRAGMA não aceita parâmetro vinculado; o nome vem de código nosso, nunca
  // de entrada do usuário, mas ainda assim validamos o formato.
  assertIdentifier(table);
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  return columns.some((c) => c.name === column);
}

/** O índice existe? */
function hasIndex(db, name) {
  const row = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?`)
    .get(name);
  return row !== undefined;
}

/**
 * Adiciona uma coluna só se ela ainda não existir.
 *
 * Substitui o antigo `addColumn` com catch vazio: aqui, um erro de SQL
 * propaga — só a condição "já existe" é tratada, e por verificação, não por
 * exceção.
 *
 * @param {any}    db
 * @param {string} table
 * @param {string} column     Nome da coluna, isolado (ex.: "mission_id").
 * @param {string} definition Resto da definição (ex.: "TEXT DEFAULT 'worker'").
 * @returns {boolean} true se adicionou, false se já existia.
 */
function addColumnIfMissing(db, table, column, definition) {
  if (!hasTable(db, table)) {
    throw new Error(
      `addColumnIfMissing: tabela "${table}" não existe (coluna "${column}")`,
    );
  }
  if (hasColumn(db, table, column)) return false;
  assertIdentifier(table);
  assertIdentifier(column);
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

/** Barreira contra injeção via nome de tabela/coluna montado por engano. */
function assertIdentifier(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Identificador SQL inválido: ${JSON.stringify(name)}`);
  }
}

/* ── Versionamento ────────────────────────────────────────────────────── */

/** Versão de schema atual do banco. 0 = nunca migrado. */
function getVersion(db) {
  const row = db.prepare("PRAGMA user_version").get();
  return row?.user_version ?? 0;
}

function setVersion(db, version) {
  if (!Number.isInteger(version) || version < 0) {
    throw new Error(`Versão de schema inválida: ${version}`);
  }
  // PRAGMA não aceita bind; o valor já foi validado como inteiro acima.
  db.pragma(`user_version = ${version}`);
}

function ensureAuditTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${AUDIT_TABLE} (
      version     INTEGER PRIMARY KEY,
      name        TEXT    NOT NULL,
      applied_at  INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL
    )
  `);
}

/* ── Validação ────────────────────────────────────────────────────────── */

/**
 * Valida a lista antes de tocar no banco: versões duplicadas ou fora de
 * ordem são erro de programação e devem estourar no desenvolvimento, não
 * corromper o banco de alguém em produção.
 *
 * @param {Migration[]} migrations
 * @returns {Migration[]} ordenadas por versão
 */
function validate(migrations) {
  if (!Array.isArray(migrations)) {
    throw new Error("migrations deve ser um array");
  }

  const seen = new Set();
  for (const migration of migrations) {
    const { version, name, up } = migration ?? {};
    if (!Number.isInteger(version) || version < 1) {
      throw new Error(
        `Migração com versão inválida: ${JSON.stringify(version)} (deve ser inteiro >= 1)`,
      );
    }
    if (seen.has(version)) {
      throw new Error(`Versão de migração duplicada: ${version}`);
    }
    if (typeof name !== "string" || !name) {
      throw new Error(`Migração ${version} sem nome`);
    }
    if (typeof up !== "function") {
      throw new Error(`Migração ${version} (${name}) sem função up()`);
    }
    seen.add(version);
  }

  return [...migrations].sort((a, b) => a.version - b.version);
}

/* ── Runner ───────────────────────────────────────────────────────────── */

/**
 * Aplica todas as migrações pendentes, em ordem.
 *
 * Cada migração roda na sua própria transação: se `up()` estourar, aquela
 * migração inteira é revertida, a versão não avança, e o erro sobe. Um banco
 * meio migrado é pior que um app que não sobe.
 *
 * Idempotente — rodar duas vezes na mesma versão não faz nada.
 *
 * @param {any} db  Instância better-sqlite3.
 * @param {Migration[]} migrations
 * @param {object} [options]
 * @param {(msg: string) => void} [options.log]  Log de progresso.
 * @returns {{ from: number, to: number, applied: Migration[] }}
 */
function runMigrations(db, migrations, options = {}) {
  const log = options.log ?? (() => {});
  const ordered = validate(migrations);

  ensureAuditTable(db);

  const from = getVersion(db);
  const highest = ordered[ordered.length - 1].version;

  // Um banco à frente do código significa downgrade do app. Continuar seria
  // rodar código antigo contra schema novo — melhor avisar alto.
  //
  // Esta checagem tem que vir ANTES do early-return de "nada pendente": um
  // banco à frente nunca tem migração pendente, então sair cedo faria a
  // guarda nunca disparar exatamente no caso que ela existe para pegar.
  if (from > highest) {
    throw new Error(
      `Banco na versão ${from}, mas esta build conhece só até ${highest}. ` +
        `Provável downgrade do app — atualize o Codebrain em vez de rodar esta versão.`,
    );
  }

  const pending = ordered.filter((m) => m.version > from);
  if (pending.length === 0) {
    return { from, to: from, applied: [] };
  }

  log(`[migrations] ${from} → ${highest} (${pending.length} pendente(s))`);

  const applied = [];
  for (const migration of pending) {
    const startedAt = Date.now();

    // better-sqlite3 faz rollback automático se o callback estourar.
    const apply = db.transaction(() => {
      migration.up(db);
      setVersion(db, migration.version);
      db.prepare(
        `INSERT OR REPLACE INTO ${AUDIT_TABLE} (version, name, applied_at, duration_ms)
         VALUES (?, ?, ?, ?)`,
      ).run(migration.version, migration.name, startedAt, Date.now() - startedAt);
    });

    try {
      apply();
    } catch (err) {
      // Contexto explícito: sem isto o erro chega como um "SQLITE_ERROR" cru
      // sem dizer qual migração falhou.
      throw new Error(
        `Migração ${migration.version} (${migration.name}) falhou: ${err.message}`,
        { cause: err },
      );
    }

    applied.push(migration);
    log(`[migrations] ✓ ${migration.version} ${migration.name} (${Date.now() - startedAt}ms)`);
  }

  return { from, to: getVersion(db), applied };
}

/**
 * Histórico de migrações aplicadas, mais recente primeiro.
 * Para diagnóstico — expor na tela de sistema.
 */
function getMigrationHistory(db) {
  if (!hasTable(db, AUDIT_TABLE)) return [];
  return db
    .prepare(`SELECT version, name, applied_at, duration_ms FROM ${AUDIT_TABLE} ORDER BY version DESC`)
    .all();
}

/**
 * Aplica os PRAGMAs de conexão que todo banco do Codebrain deve ter.
 *
 * `busy_timeout` é o que faltava e importa mais: o app abre a mesma base a
 * partir do processo main, do servidor MCP e do daemon stdio. Sem timeout,
 * um escritor concorrente devolve SQLITE_BUSY na hora e a operação falha —
 * que é exatamente o tipo de erro intermitente que os `catch {}` espalhados
 * pelo store estavam escondendo.
 */
function applyConnectionPragmas(db) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Espera até 5s por um lock antes de desistir, em vez de falhar de imediato.
  db.pragma("busy_timeout = 5000");
  // Com WAL, NORMAL é seguro contra crash do processo e bem mais rápido que
  // FULL, que faz fsync a cada commit.
  db.pragma("synchronous = NORMAL");
}

module.exports = {
  runMigrations,
  getVersion,
  setVersion,
  getMigrationHistory,
  applyConnectionPragmas,
  // Helpers para uso dentro de up()
  hasTable,
  hasColumn,
  hasIndex,
  addColumnIfMissing,
  // Exportado para teste
  validate,
  AUDIT_TABLE,
};
