// @vitest-environment node

/* better-sqlite3 real em :memory:: as regras de ciclo de vida e de dedup são o
   que importa aqui, e nada disso apareceria contra um mock. */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadDatabase } from "./sqlite.js";
import { applyConnectionPragmas, runMigrations } from "./migrations.js";
import { migrations } from "./schema-migrations.js";
import { createFindingsStore } from "./findings-store.js";

const Database = loadDatabase();
const WS = "/ws";

let api;
let db;
const add = (over = {}) =>
  api.findingAdd({
    workspace: WS,
    title: "Botão some",
    category: "functional",
    severity: "high",
    location: "a.tsx",
    evidence: "a.tsx:1",
    ...over,
  });
const move = (id, status, over = {}) => api.findingUpdate({ workspace: WS, id, status, ...over });

beforeEach(() => {
  db = new Database(":memory:");
  applyConnectionPragmas(db);
  // A v4 acrescenta colunas em `handoffs`, tabela criada pelo schema legado.
  db.exec("CREATE TABLE handoffs (id TEXT PRIMARY KEY)");
  runMigrations(
    db,
    migrations.filter((m) => m.version === 4).map((m) => ({ ...m, version: 1 }))
  );
  api = createFindingsStore(db);
});
afterEach(() => db.close());

it("persiste identidade, evidência e dedup ao reabrir o SQLite", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-findings-"));
  const file = path.join(dir, "findings.db");
  let disk = new Database(file);
  try {
    disk.exec("CREATE TABLE handoffs (id TEXT PRIMARY KEY)");
    runMigrations(
      disk,
      migrations.filter((m) => m.version === 4).map((m) => ({ ...m, version: 1 }))
    );
    const first = createFindingsStore(disk);
    const finding = {
      workspace: WS,
      title: "Persistido",
      category: "functional",
      severity: "high",
      evidence: "a.ts:1",
    };
    expect(first.findingAdd(finding).ok).toBe(true);
    expect(
      first.findingUpdate({
        workspace: WS,
        id: "F-001",
        status: "fixed",
        actor: "worker-1",
        note: "causa validada",
      }).ok
    ).toBe(true);
    disk.close();
    disk = new Database(file);
    const second = createFindingsStore(disk);
    expect(
      second.findingUpdate({
        workspace: WS,
        id: "F-001",
        status: "verified",
        actor: "worker-1",
        evidence: "teste",
      }).ok
    ).toBe(false);
    expect(
      second.findingUpdate({
        workspace: WS,
        id: "F-001",
        status: "verified",
        actor: "worker-2",
        evidence: "teste",
      }).ok
    ).toBe(true);
    expect(second.findingAdd({ ...finding, evidence: "regressão" })).toMatchObject({
      id: "F-001",
      reopened: true,
    });
    expect(second.findingGet({ workspace: WS, id: "F-001" }).finding.evidence).toHaveLength(3);
  } finally {
    disk.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("findingAdd", () => {
  it("não mistura título e localização no fingerprint", () => {
    expect(add({ title: "a b", location: "c" }).id).toBe("F-001");
    expect(add({ title: "a", location: "b c" }).id).toBe("F-002");
  });

  it("recusa tipos inválidos sem exceção SQLite", () => {
    expect(add({ evidence: [] }).ok).toBe(false);
    expect(add({ location: {} }).ok).toBe(false);
    expect(api.findingList({ workspace: WS, limit: -1 }).ok).toBe(false);
    expect(api.findingList({ workspace: WS, limit: 2.5 }).ok).toBe(false);
    expect(api.findingList({}).ok).toBe(false);
  });
  it("numera por workspace", () => {
    expect(add()).toMatchObject({ ok: true, id: "F-001", status: "open", duplicate: false });
    expect(add({ title: "Outro" }).id).toBe("F-002");
    expect(add({ workspace: "/outro" }).id).toBe("F-001");
  });

  it("exige evidência, severidade e categoria válidas", () => {
    expect(add({ evidence: " " }).error).toContain("sem evidência");
    expect(add({ severity: "x" }).ok).toBe(false);
    expect(add({ category: "x" }).ok).toBe(false);
    expect(add({ title: "" }).ok).toBe(false);
    expect(api.findingAdd({ title: "x" }).ok).toBe(false);
  });

  it("mesmo defeito soma prova no mesmo ID", () => {
    add();
    expect(add({ title: "BOTÃO   some", evidence: "print.png" })).toMatchObject({
      id: "F-001",
      duplicate: true,
      reopened: false,
    });
    expect(
      api.findingGet({ workspace: WS, id: "F-001" }).finding.evidence.map((item) => item.text)
    ).toEqual(["a.tsx:1", "print.png"]);
  });

  it("defeito resolvido que volta reabre o mesmo ID", () => {
    add();
    move("F-001", "fixed", { note: "causa", actor: "p1" });
    expect(add({ evidence: "de novo" })).toMatchObject({
      id: "F-001",
      reopened: true,
      status: "reopened",
    });
  });
});

describe("findingUpdate", () => {
  beforeEach(() => add());

  it("recusa transição fora do ciclo", () => {
    expect(move("F-001", "verified", { evidence: "e" }).error).toContain("transição inválida");
  });

  it("fixed exige nota", () => {
    expect(move("F-001", "fixed").ok).toBe(false);
    expect(move("F-001", "fixed", { note: "causa", commit: "abc", actor: "p1" })).toMatchObject({
      ok: true,
      status: "fixed",
    });
    expect(api.findingGet({ workspace: WS, id: "F-001" }).finding).toMatchObject({
      fixed_by: "p1",
      fix_note: "causa",
      fix_commit: "abc",
    });
  });

  it("verified exige evidência e outra pessoa", () => {
    expect(move("F-001", "fixed", { note: "causa" }).ok).toBe(false);
    move("F-001", "fixed", { note: "causa", actor: "p1" });
    expect(move("F-001", "verified", { evidence: "e" }).ok).toBe(false);
    expect(move("F-001", "verified", { evidence: "e", actor: " p1 " }).ok).toBe(false);
    expect(move("F-001", "verified", { actor: "p2" }).ok).toBe(false);
    expect(move("F-001", "verified", { actor: "p1", evidence: "e" }).error).toContain(
      "própria correção"
    );
    expect(move("F-001", "verified", { actor: "p2", evidence: "e" })).toMatchObject({ ok: true });
  });

  it("reopened exige evidência", () => {
    move("F-001", "fixed", { note: "causa", actor: "p1" });
    expect(move("F-001", "reopened").ok).toBe(false);
    expect(move("F-001", "reopened", { evidence: "e" }).ok).toBe(true);
  });

  it("finding inexistente", () => {
    expect(move("F-999", "fixed", { note: "x" }).ok).toBe(false);
  });
});

describe("listagem e contagem", () => {
  it("ordena por severidade e filtra", () => {
    add({ title: "baixo", severity: "low" });
    add({ title: "alto", severity: "high" });
    expect(api.findingList({ workspace: WS }).findings.map((item) => item.title)).toEqual([
      "alto",
      "baixo",
    ]);
    expect(api.findingList({ workspace: WS, severity: "low" }).findings).toHaveLength(1);
    expect(api.findingList({ workspace: WS, status: "fixed" }).findings).toHaveLength(0);
  });

  it("conta todos os status, inclusive zerados", () => {
    add();
    expect(api.findingStats({ workspace: WS }).counts).toEqual({
      open: 1,
      fixed: 0,
      reopened: 0,
      needs_decision: 0,
      verified: 0,
    });
  });
});
