// @vitest-environment node

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyPrompt,
  createDefaultTable,
  decideHarness,
  deriveName,
  loadHarnessTable,
  normalizeTable,
  saveHarnessTable,
} from "./harness.js";

const table = () => createDefaultTable();

describe("classifyPrompt", () => {
  it("casa palavra inteira e ignora acento", () => {
    expect(classifyPrompt("Corrija o erro de migração", table().rows)?.row.id).toBeDefined();
    expect(classifyPrompt("revise este PR", table().rows)?.row.id).toBe("revisar");
  });

  it("não casa pedaço de palavra", () => {
    expect(classifyPrompt("fixture sem nada", table().rows)).toBeNull();
  });

  it("empate significa não sei", () => {
    expect(classifyPrompt("revise e pesquise", table().rows)).toBeNull();
  });
});

describe("decideHarness", () => {
  it("o tipo explícito vence as palavras-chave", () => {
    const decision = decideHarness({ task: "pesquisar", prompt: "revise isto", table: table() });
    expect(decision).toMatchObject({ taskId: "pesquisar", source: "pedido" });
  });

  it("campos explícitos vencem a linha da tabela", () => {
    const decision = decideHarness({
      task: "pesquisar",
      prompt: "x",
      explicit: { effort: "high", skills: ["s"] },
      table: table(),
    });
    expect(decision).toMatchObject({ effort: "high", skills: ["s"] });
  });

  it("cai na linha padrão quando nada casa", () => {
    expect(decideHarness({ prompt: "olá", table: table() })).toMatchObject({
      taskId: "geral",
      source: "padrao",
    });
  });

  it("avisa sobre tipo inexistente", () => {
    expect(decideHarness({ task: "nada", prompt: "x", table: table() }).notes.join()).toContain(
      "não existe"
    );
  });

  it("usa o decisor antes das palavras-chave", () => {
    const decision = decideHarness({
      prompt: "revise isto",
      table: table(),
      decided: { taskId: "pesquisar", confidence: 0.9, reason: "r", agentName: "ag" },
    });
    expect(decision).toMatchObject({ taskId: "pesquisar", source: "decisor", agentName: "ag" });
  });

  it("revisão é marcada e o recibo diz isso", () => {
    const decision = decideHarness({ prompt: "revise isto", table: table() });
    expect(decision.review).toBe(true);
    expect(decision.receipt).toContain("revisão");
  });

  it("modelo da faixa só vale para a CLI da tabela", () => {
    const decision = decideHarness({
      task: "revisar",
      prompt: "x",
      table: table(),
      callerAgent: "claude",
    });
    expect(decision.model).toBe(table().tierModels.claude.deep);
    expect(
      decideHarness({ task: "revisar", prompt: "x", table: table(), callerAgent: "codex" }).model
    ).toBeNull();
  });

  it("CLI ausente cai na reserva e registra o aviso", () => {
    const custom = table();
    custom.rows[0].cli = "kimi";
    custom.rows[0].fallbacks = [{ cli: "codex", model: "m" }];
    const decision = decideHarness({
      task: custom.rows[0].id,
      prompt: "x",
      table: custom,
      availableClis: new Set(["codex"]),
    });
    expect(decision).toMatchObject({ agent: "codex", model: "m" });
    expect(decision.notes.join()).toContain("reserva");
  });

  it("reserva sem modelo não herda modelo ou conta da CLI principal", () => {
    const custom = table();
    Object.assign(custom.rows[0], {
      cli: "kimi",
      model: "kimi-only",
      accountId: "kimi-only",
      fallbacks: [{ cli: "codex" }],
    });
    const decision = decideHarness({
      task: custom.rows[0].id,
      table: custom,
      availableClis: new Set(["codex"]),
    });
    expect(decision).toMatchObject({ agent: "codex", model: null, accountId: null });
    expect(
      decideHarness({ task: custom.rows[0].id, table: custom, availableClis: new Set() }).agent
    ).toBeNull();
  });

  it("conta escolhida entra no recibo e a nota vira aviso", () => {
    const decision = decideHarness({
      prompt: "x",
      table: table(),
      callerAgent: "claude",
      pickAccount: () => ({ id: "a1", label: "Trabalho", note: "todas as contas perto do limite" }),
    });
    expect(decision).toMatchObject({ accountId: "a1", accountLabel: "Trabalho" });
    expect(decision.receipt).toContain("conta Trabalho");
    expect(decision.receipt).toContain("perto do limite");
  });

  it("provider explícito não passa pela escolha de conta", () => {
    let called = false;
    decideHarness({
      prompt: "x",
      table: table(),
      explicit: { agent: "claude", providerId: "p" },
      pickAccount: () => {
        called = true;
      },
    });
    expect(called).toBe(false);
  });

  it("resolveSkills recebe o agente e o recibo mostra o resultado", () => {
    const custom = table();
    custom.rows.find((row) => row.id === "geral").agentName = "ag";
    const seen = [];
    const decision = decideHarness({
      prompt: "olá",
      table: custom,
      resolveSkills: (skills, agent) => {
        seen.push(agent);
        return ["so-esta"];
      },
    });
    expect(seen).toEqual(["ag"]);
    expect(decision.skills).toEqual(["so-esta"]);
    expect(decision.receipt).toContain("so-esta");
  });

  it("skills pedidas no spawn não são trocadas pelas do agente", () => {
    const custom = table();
    custom.rows.find((row) => row.id === "geral").agentName = "ag";
    const seen = [];
    decideHarness({
      prompt: "olá",
      table: custom,
      explicit: { skills: ["x"] },
      resolveSkills: (skills, agent) => {
        seen.push(agent);
        return skills;
      },
    });
    expect(seen).toEqual([null]);
  });
});

describe("deriveName", () => {
  it("usa até cinco palavras sem marcação", () => {
    expect(deriveName("**Corrigir** o `login` que expira cedo demais")).toBe(
      "Corrigir o login que expira"
    );
  });
  it("tem nome mesmo sem prompt", () => {
    expect(deriveName("")).toBe("Ajudante");
  });
});

describe("normalizeTable e persistência", () => {
  it("normaliza configuração inválida sem descartar o decisor quando rows falta", () => {
    const normalized = normalizeTable({
      decider: { enabled: true, model: "m", timeoutMs: -2, minConfidence: 3 },
      tierModels: { codex: { fast: {}, deep: "m" } },
    });
    expect(normalized.decider).toMatchObject({
      enabled: true,
      model: "m",
      timeoutMs: 1,
      minConfidence: 0.6,
    });
    expect(normalized.tierModels).toEqual({ codex: { deep: "m" } });
    expect(normalized.rows).toHaveLength(table().rows.length);
  });
  it("devolve o padrão para lixo", () => {
    expect(normalizeTable("x").rows.length).toBe(table().rows.length);
  });

  it("corrige valores inválidos, remove duplicata e garante a linha padrão", () => {
    const normalized = normalizeTable({
      rows: [{ id: "A B", tier: "x", effort: "x" }, { id: "a-b" }],
    });
    expect(normalized.rows.map((row) => row.id)).toEqual(["a-b", "geral"]);
    expect(normalized.rows[0]).toMatchObject({ tier: "balanced", effort: "medium" });
  });

  it("grava e relê sem deixar temporário", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-harness-"));
    const file = path.join(dir, "sub", "harness.json");
    const custom = table();
    custom.decider.enabled = true;
    saveHarnessTable(file, custom);
    expect(loadHarnessTable(file).decider.enabled).toBe(true);
    expect(fs.readdirSync(path.dirname(file))).toEqual(["harness.json"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("arquivo ausente vira tabela padrão", () => {
    expect(loadHarnessTable(path.join(os.tmpdir(), "nao-existe-cb.json")).rows.length).toBe(
      table().rows.length
    );
  });
});
