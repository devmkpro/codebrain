// @vitest-environment node

/* Testes do runner de migração. Usam better-sqlite3 real em :memory: —
   mock de banco não pegaria o que importa aqui: rollback de transação,
   PRAGMA user_version e comportamento de ALTER TABLE. */

// O arquivo sob teste é CommonJS; o Vitest exige que o *teste* seja ESM.
// A interop do Vite resolve o require/export do módulo importado.
import { beforeEach, describe, expect, it } from "vitest";
import { loadDatabase } from "./sqlite.js";
import {
  addColumnIfMissing,
  applyConnectionPragmas,
  getMigrationHistory,
  getVersion,
  hasColumn,
  hasIndex,
  hasTable,
  runMigrations,
  validate,
  AUDIT_TABLE,
} from "./migrations.js";

// Mesmo carregador da produção: sob `vitest` estamos no Node do sistema, onde
// o binário compilado para Electron não abre.
const Database = loadDatabase();

/** @type {import("better-sqlite3").Database} */
let db;

beforeEach(() => {
  db = new Database(":memory:");
});

describe("runMigrations", () => {
  it("aplica migrações pendentes em ordem e avança a versão", () => {
    const applied = [];
    const result = runMigrations(db, [
      { version: 2, name: "segunda", up: () => applied.push(2) },
      { version: 1, name: "primeira", up: () => applied.push(1) },
    ]);

    // Aplicadas por versão, não pela ordem do array.
    expect(applied).toEqual([1, 2]);
    expect(result.from).toBe(0);
    expect(result.to).toBe(2);
    expect(getVersion(db)).toBe(2);
  });

  it("é idempotente — rodar de novo não reaplica", () => {
    const migrations = [
      {
        version: 1,
        name: "cria_t",
        up: (d) => d.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)"),
      },
    ];

    runMigrations(db, migrations);
    const second = runMigrations(db, migrations);

    expect(second.applied).toHaveLength(0);
    expect(second.from).toBe(1);
    // Reaplicar teria estourado com "table t already exists".
    expect(hasTable(db, "t")).toBe(true);
  });

  it("aplica só o que falta quando a lista cresce", () => {
    runMigrations(db, [{ version: 1, name: "um", up: () => {} }]);

    const ran = [];
    const result = runMigrations(db, [
      { version: 1, name: "um", up: () => ran.push(1) },
      { version: 2, name: "dois", up: () => ran.push(2) },
    ]);

    expect(ran).toEqual([2]);
    expect(result.applied.map((m) => m.version)).toEqual([2]);
  });

  it("reverte a migração inteira quando up() estoura", () => {
    expect(() =>
      runMigrations(db, [
        {
          version: 1,
          name: "meio_caminho",
          up: (d) => {
            d.exec("CREATE TABLE parcial (id INTEGER)");
            throw new Error("boom");
          },
        },
      ]),
    ).toThrow(/Migração 1 \(meio_caminho\) falhou: boom/);

    // A tabela criada antes do erro foi revertida junto.
    expect(hasTable(db, "parcial")).toBe(false);
    // E a versão não avançou — na próxima subida ela tenta de novo.
    expect(getVersion(db)).toBe(0);
  });

  it("para na primeira falha e preserva as anteriores", () => {
    expect(() =>
      runMigrations(db, [
        { version: 1, name: "ok", up: (d) => d.exec("CREATE TABLE a (id INTEGER)") },
        { version: 2, name: "quebra", up: () => { throw new Error("nope"); } },
        { version: 3, name: "nunca", up: (d) => d.exec("CREATE TABLE c (id INTEGER)") },
      ]),
    ).toThrow(/Migração 2/);

    expect(getVersion(db)).toBe(1);
    expect(hasTable(db, "a")).toBe(true);
    expect(hasTable(db, "c")).toBe(false);
  });

  it("recusa banco mais novo que o código (downgrade do app)", () => {
    runMigrations(db, [
      { version: 1, name: "um", up: () => {} },
      { version: 2, name: "dois", up: () => {} },
    ]);

    expect(() => runMigrations(db, [{ version: 1, name: "um", up: () => {} }])).toThrow(
      /Provável downgrade do app/,
    );
  });

  it("registra histórico de auditoria", () => {
    runMigrations(db, [
      { version: 1, name: "primeira", up: () => {} },
      { version: 2, name: "segunda", up: () => {} },
    ]);

    const history = getMigrationHistory(db);
    expect(history.map((h) => h.name)).toEqual(["segunda", "primeira"]);
    expect(history[0].version).toBe(2);
    expect(history[0].applied_at).toBeGreaterThan(0);
    expect(history[0].duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("histórico vem vazio em banco nunca migrado", () => {
    expect(getMigrationHistory(db)).toEqual([]);
    expect(hasTable(db, AUDIT_TABLE)).toBe(false);
  });
});

describe("validate", () => {
  it("rejeita versão duplicada", () => {
    expect(() =>
      validate([
        { version: 1, name: "a", up: () => {} },
        { version: 1, name: "b", up: () => {} },
      ]),
    ).toThrow(/duplicada: 1/);
  });

  it("rejeita versão inválida", () => {
    expect(() => validate([{ version: 0, name: "a", up: () => {} }])).toThrow(/versão inválida/);
    expect(() => validate([{ version: 1.5, name: "a", up: () => {} }])).toThrow(/versão inválida/);
  });

  it("rejeita migração sem nome ou sem up()", () => {
    expect(() => validate([{ version: 1, up: () => {} }])).toThrow(/sem nome/);
    expect(() => validate([{ version: 1, name: "a" }])).toThrow(/sem função up/);
  });

  it("ordena por versão", () => {
    const ordered = validate([
      { version: 3, name: "c", up: () => {} },
      { version: 1, name: "a", up: () => {} },
      { version: 2, name: "b", up: () => {} },
    ]);
    expect(ordered.map((m) => m.version)).toEqual([1, 2, 3]);
  });
});

describe("addColumnIfMissing", () => {
  beforeEach(() => {
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
  });

  it("adiciona a coluna quando falta e é no-op quando já existe", () => {
    expect(addColumnIfMissing(db, "t", "nome", "TEXT DEFAULT ''")).toBe(true);
    expect(hasColumn(db, "t", "nome")).toBe(true);
    expect(addColumnIfMissing(db, "t", "nome", "TEXT DEFAULT ''")).toBe(false);
  });

  it("propaga erro de SQL em vez de engolir", () => {
    // Este é o ponto do exercício: o antigo `addColumn` com catch vazio
    // aceitaria isto calado e a coluna nunca apareceria.
    expect(() => addColumnIfMissing(db, "t", "ruim", "ESTE_TIPO_NAO_EXISTE(")).toThrow();
  });

  it("estoura quando a tabela não existe, em vez de virar no-op", () => {
    expect(() => addColumnIfMissing(db, "inexistente", "x", "TEXT")).toThrow(
      /tabela "inexistente" não existe/,
    );
  });

  it("rejeita identificador malformado", () => {
    expect(() => addColumnIfMissing(db, "t", "x; DROP TABLE t", "TEXT")).toThrow(
      /Identificador SQL inválido/,
    );
  });
});

describe("introspecção", () => {
  it("hasTable / hasColumn / hasIndex", () => {
    expect(hasTable(db, "t")).toBe(false);
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, nome TEXT)");
    db.exec("CREATE INDEX idx_t_nome ON t(nome)");

    expect(hasTable(db, "t")).toBe(true);
    expect(hasColumn(db, "t", "nome")).toBe(true);
    expect(hasColumn(db, "t", "ausente")).toBe(false);
    expect(hasColumn(db, "inexistente", "x")).toBe(false);
    expect(hasIndex(db, "idx_t_nome")).toBe(true);
    expect(hasIndex(db, "idx_ausente")).toBe(false);
  });
});

describe("applyConnectionPragmas", () => {
  it("aplica busy_timeout e foreign_keys", () => {
    applyConnectionPragmas(db);
    expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  });
});
