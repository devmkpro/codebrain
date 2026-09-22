// @vitest-environment node

/* Testes de correções aprendidas e ledger de trabalho.
   better-sqlite3 real em :memory: — o que importa aqui é dedup por
   fingerprint, escopo por repositório, merge de artifacts e a recusa de
   mover fase sem evento, e nada disso apareceria contra um mock. */

import { beforeEach, describe, expect, it } from "vitest";
import { loadDatabase } from "./sqlite.js";
import { applyConnectionPragmas, runMigrations } from "./migrations.js";
import { migrations } from "./schema-migrations.js";
import { createLessonsLedgerApi, fingerprint } from "./lessons-ledger.js";

const Database = loadDatabase();

/** @type {import("better-sqlite3").Database} */
let db;
/** @type {ReturnType<typeof createLessonsLedgerApi>} */
let api;

beforeEach(() => {
  db = new Database(":memory:");
  applyConnectionPragmas(db);
  // A v1 é só baseline e exige o schema legado; aqui rodamos apenas a v2,
  // que é o que este módulo consome. As tabelas dela não dependem das legadas.
  runMigrations(db, migrations.filter((m) => m.version === 2).map((m) => ({ ...m, version: 1 })));
  api = createLessonsLedgerApi(db);
});

describe("lessonAdd", () => {
  it("grava uma lição nova e devolve status created", () => {
    const res = api.lessonAdd({ rule: "sempre rodar typecheck antes de concluir", category: "tool" });
    expect(res).toMatchObject({ ok: true, status: "created" });
    expect(api.lessonList().count).toBe(1);
  });

  it("deduplica regra equivalente com pontuação diferente", () => {
    api.lessonAdd({ rule: "Sempre rodar o typecheck!" });
    const again = api.lessonAdd({ rule: "sempre rodar o typecheck" });
    expect(again.status).toBe("deduped");
    expect(api.lessonList().count).toBe(1);
  });

  it("enriquece uma lição existente quando o lado negativo chega depois", () => {
    const first = api.lessonAdd({ rule: "usar só View e Text para ícones" });
    const second = api.lessonAdd({
      rule: "usar só View e Text para ícones",
      negative: "não adicionar react-native-svg",
    });
    expect(second).toMatchObject({ status: "enriched", id: first.id });
    expect(api.lessonList().lessons[0].negative).toContain("react-native-svg");
  });

  it("recusa regra vazia, longa demais ou de categoria inválida", () => {
    expect(api.lessonAdd({ rule: "   " }).status).toBe("refused");
    expect(api.lessonAdd({ rule: "x".repeat(501) }).status).toBe("refused");
    expect(api.lessonAdd({ rule: "válida", category: "inventada" }).status).toBe("refused");
    expect(api.lessonList().count).toBe(0);
  });
});

describe("escopo por repositório", () => {
  beforeEach(() => {
    api.lessonAdd({ rule: "regra global de commits" });
    api.lessonAdd({ rule: "não usar lib nativa para ícones", repo_scope: "app-mobile" });
  });

  it("injeta a lição escopada só no workspace que contém o fragmento", () => {
    const dentro = api.lessonList({ workspace: "C:\\Users\\dev\\Desktop\\app-mobile" });
    expect(dentro.count).toBe(2);

    const fora = api.lessonList({ workspace: "D:\\Projetos\\codebrain" });
    expect(fora.count).toBe(1);
    expect(fora.lessons[0].rule).toContain("global");
  });

  it("compara caminho independente de barra e caixa", () => {
    expect(api.lessonList({ workspace: "c:/users/dev/APP-Mobile" }).count).toBe(2);
  });

  it("sem workspace, uma lição escopada não passa", () => {
    // Um agente sem workspace resolvido não deve herdar regra de projeto.
    const semWs = api.lessonList({ workspace: "" }).lessons;
    expect(semWs).toHaveLength(2); // string vazia é falsy → lista tudo
    const ctx = api.lessonContext({ workspace: "/outro/lugar" });
    expect(ctx.count).toBe(1);
  });
});

describe("lessonContext", () => {
  it("monta bloco com regra, negativa e escopo, e conta hits", () => {
    api.lessonAdd({
      rule: "converter erro de Axios em mensagem humana",
      negative: "não mostrar status HTTP ao usuário",
      category: "preference",
      repo_scope: "app-mobile",
    });
    const ctx = api.lessonContext({ workspace: "/home/x/app-mobile" });
    expect(ctx.text).toContain("CORREÇÕES APRENDIDAS");
    expect(ctx.text).toContain("só em app-mobile");
    expect(ctx.text).toContain("NÃO: não mostrar status HTTP");
    expect(api.lessonList().lessons[0].hits).toBe(1);
  });

  it("devolve texto vazio quando não há lição aplicável", () => {
    expect(api.lessonContext({ workspace: "/vazio" })).toMatchObject({ text: "", count: 0 });
  });
});

describe("lessonRemove", () => {
  it("remove por trecho da regra e por id", () => {
    api.lessonAdd({ rule: "primeira regra sobre svg" });
    const segunda = api.lessonAdd({ rule: "segunda regra sobre commits" });

    expect(api.lessonRemove({ query: "svg" }).removed).toBe(1);
    expect(api.lessonRemove({ id: segunda.id }).removed).toBe(1);
    expect(api.lessonList().count).toBe(0);
  });
});

describe("ledgerRecord", () => {
  it("cria o ledger e depois aplica atualização parcial sem apagar o resto", () => {
    api.ledgerRecord({
      session_id: "pane-1",
      goal: "portar o ledger para o codebrain",
      phase: "implementing",
      next: "registrar as tools no index.js",
      event: "iniciado",
      event_kind: "progress",
      artifacts: { branch: "feat/ledger" },
    });

    api.ledgerRecord({ session_id: "pane-1", artifacts: { pr: "42" } });

    const { data } = api.ledgerRead({ session_id: "pane-1" });
    expect(data.goal).toContain("portar");
    expect(data.next).toContain("index.js");
    // Merge, não substituição: o branch de antes sobrevive ao passo que só tinha PR.
    expect(data.artifacts).toEqual({ branch: "feat/ledger", pr: "42" });
  });

  it("recusa mover a fase sem event e sem event_kind válido", () => {
    api.ledgerRecord({ session_id: "p2", goal: "x", event: "boot", event_kind: "note" });

    const semEvento = api.ledgerRecord({ session_id: "p2", phase: "awaiting-ci" });
    expect(semEvento.ok).toBe(false);
    expect(semEvento.error).toContain("event");

    const kindInvalido = api.ledgerRecord({ session_id: "p2", phase: "awaiting-ci", event: "subiu", event_kind: "inventado" });
    expect(kindInvalido.ok).toBe(false);

    expect(api.ledgerRead({ session_id: "p2" }).data.phase).toBe("starting");
  });

  it("acumula abordagens descartadas", () => {
    api.ledgerRecord({ session_id: "p3", goal: "g" });
    api.ledgerRecord({ session_id: "p3", tried_approach: "patch no vendor", tried_rejected_because: "sobrescrito no install" });
    api.ledgerRecord({ session_id: "p3", tried_approach: "monkey patch em runtime", tried_rejected_because: "quebra no build de produção" });

    const { data } = api.ledgerRead({ session_id: "p3" });
    expect(data.rejected).toHaveLength(2);
    expect(data.rejected[0].approach).toContain("vendor");
  });

  it("exige session_id", () => {
    expect(api.ledgerRecord({ session_id: "" }).ok).toBe(false);
  });
});

describe("ledgerSnapshot", () => {
  it("inclui objetivo, próximo passo e o que não repetir", () => {
    api.ledgerRecord({
      session_id: "p4",
      goal: "fazer o CI passar",
      phase: "awaiting-ci",
      next: "adicionar o branch de Windows em _safe_chmod",
      event: "rodada 3 de CI",
      event_kind: "progress",
      tried_approach: "ignorar o teste",
      tried_rejected_because: "esconde o bug em vez de corrigir",
    });

    const snap = api.ledgerSnapshot({ session_id: "p4" });
    expect(snap.present).toBe(true);
    expect(snap.text).toContain("_safe_chmod");
    expect(snap.text).toContain("DESCARTADO");
    expect(snap.text).toContain("ignorar o teste");
  });

  it("não reinjeta nada numa fase terminal", () => {
    api.ledgerRecord({ session_id: "p5", goal: "g", phase: "done", event: "entregue", event_kind: "phase" });
    expect(api.ledgerSnapshot({ session_id: "p5" })).toMatchObject({ text: "", present: false, terminal: true });
  });

  it("sessão sem ledger devolve vazio em vez de estourar", () => {
    expect(api.ledgerSnapshot({ session_id: "nao-existe" })).toMatchObject({ text: "", present: false });
  });
});

describe("ledgerList", () => {
  it("esconde workstream terminal por padrão", () => {
    api.ledgerRecord({ session_id: "a", goal: "viva" });
    api.ledgerRecord({ session_id: "b", goal: "morta", phase: "abandoned", event: "descartada", event_kind: "decision" });

    expect(api.ledgerList().count).toBe(1);
    expect(api.ledgerList({ include_terminal: true }).count).toBe(2);
  });
});

describe("integridade do schema", () => {
  it("apagar o ledger leva eventos e descartes com ele", () => {
    api.ledgerRecord({ session_id: "p6", goal: "g", event: "e", event_kind: "note", tried_approach: "t" });
    db.prepare("DELETE FROM work_ledger WHERE session_id = ?").run("p6");
    expect(db.prepare("SELECT count(*) c FROM ledger_events").get().c).toBe(0);
    expect(db.prepare("SELECT count(*) c FROM ledger_rejected").get().c).toBe(0);
  });
});

describe("fingerprint", () => {
  it("colapsa acento, caixa e pontuação", () => {
    expect(fingerprint("Não  usar SVG!")).toBe(fingerprint("nao usar svg"));
  });
});
