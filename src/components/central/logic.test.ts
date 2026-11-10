import { describe, expect, it } from "vitest";
import {
  allowedTransitions,
  blankRow,
  copyTargets,
  decisionView,
  deliveryState,
  evidenceSummary,
  filterCatalog,
  findingsForHelper,
  formatReset,
  isBuiltin,
  ladderSteps,
  newRowId,
  parseList,
  parseReceipt,
  receiptsForMission,
  sortFindings,
  sourceInfo,
  toEpochMs,
  transitionField,
  usageBar,
  validateMediaDraft,
  validateTable,
  validateTransition,
} from "./logic";
import type { CatalogItem, Finding, HarnessTable, SpawnReceipt } from "./types";

const table = (patch: Partial<HarnessTable> = {}): HarnessTable => ({
  version: 1,
  tierModels: {},
  decider: { enabled: false, providerId: null, model: null, minConfidence: 0.6, timeoutMs: 4000 },
  rows: [{ ...blankRow([]), id: "geral", name: "Geral" }],
  ...patch,
});

describe("transições de finding", () => {
  it("segue o ciclo de vida do store", () => {
    expect(allowedTransitions("open")).toEqual(["fixed", "needs_decision"]);
    expect(allowedTransitions("fixed")).toEqual(["verified", "reopened"]);
    expect(allowedTransitions("reopened")).toEqual(["fixed", "needs_decision"]);
    expect(allowedTransitions("needs_decision")).toEqual(["open"]);
    expect(allowedTransitions("verified")).toEqual(["reopened"]);
  });

  it("não oferece nada para status desconhecido", () => {
    expect(allowedTransitions("inventado")).toEqual([]);
  });

  it("recusa transição fora do ciclo", () => {
    expect(validateTransition({ status: "open" }, "verified", { evidence: "x" })).toMatch(/não dá para ir/);
  });

  it("exige nota para corrigir e evidência para verificar ou reabrir", () => {
    expect(transitionField("fixed")).toBe("note");
    expect(transitionField("verified")).toBe("evidence");
    expect(transitionField("needs_decision")).toBeNull();
    expect(validateTransition({ status: "open" }, "fixed", { note: "  " })).toMatch(/causa/);
    expect(validateTransition({ status: "open" }, "fixed", { note: "ok" })).toBeNull();
    expect(validateTransition({ status: "fixed" }, "reopened", {})).toMatch(/refez/);
    expect(validateTransition({ status: "fixed" }, "verified", { evidence: "refiz" })).toBeNull();
  });

  it("impede quem corrigiu de confirmar a própria correção", () => {
    expect(validateTransition({ status: "fixed", fixed_by: "ana" }, "verified", { evidence: "x", actor: "ana" })).toMatch(/própria/);
  });

  it("ordena por severidade e depois por número", () => {
    const list = [
      { id: "F-010", severity: "low" },
      { id: "F-010", severity: "high" },
      { id: "F-002", severity: "high" },
      { id: "F-001", severity: "medium" },
    ] as Finding[];
    expect(sortFindings(list).map((f) => `${f.severity}:${f.id}`)).toEqual([
      "high:F-002",
      "high:F-010",
      "medium:F-001",
      "low:F-010",
    ]);
  });
});

describe("escada de decisão", () => {
  it("mantém a ordem real e marca o decisor desligado", () => {
    const steps = ladderSteps({ enabled: false });
    expect(steps.map((s) => s.id)).toEqual(["pedido", "tipo", "decisor", "palavras", "padrao"]);
    expect(steps[2].off).toBe(true);
    expect(ladderSteps({ enabled: true })[2].off).toBe(false);
  });

  it("traduz a origem do recibo", () => {
    expect(sourceInfo("padrao").label).toBe("padrão");
    expect(sourceInfo("palavra-chave").key).toBe("palavra-chave");
    expect(sourceInfo(undefined).key).toBe("desconhecido");
  });
});

describe("recibo", () => {
  it("separa motivo e avisos", () => {
    const parsed = parseReceipt(
      "▸ tipo Corrigir bug (decisor, 82%: erro no login)\n▸ claude · sonnet · esforço high\n▸ revisão: pane novo, nunca o autor\n▸ avisos: codex não encontrada; usando a reserva claude",
    );
    expect(parsed.why).toBe("tipo Corrigir bug (decisor, 82%: erro no login)");
    expect(parsed.warnings).toEqual(["codex não encontrada", "usando a reserva claude"]);
    expect(parsed.review).toBe(true);
  });

  it("aguenta recibo vazio", () => {
    expect(parseReceipt(null)).toEqual({ why: null, warnings: [], review: false });
  });

  it("converte segundos do SQLite e deixa milissegundos em paz", () => {
    expect(toEpochMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(toEpochMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toEpochMs(null)).toBeNull();
  });
});

describe("recibos por missão", () => {
  const base = 1_700_000_000_000;
  const at = (offset: number) => Math.floor((base + offset) / 1000);
  const receipts = [
    { pane_id: "a", created_at: at(5_000) },
    { pane_id: "b", created_at: at(-60_000) },
    { pane_id: "c", created_at: at(120_000) },
    { pane_id: "piloto", created_at: at(1_000) },
    { pane_id: "d", mission_id: "mission_1", created_at: at(-999_000) },
    { pane_id: "e", mission_id: "mission_2", created_at: at(5_000) },
  ] as SpawnReceipt[];

  it("prefere o id operacional e usa a janela de tempo só sem ele", () => {
    const result = receiptsForMission(receipts, { createdAt: base, operationalMissionId: "mission_1", pilotPaneId: "piloto" }, base + 100_000);
    expect(result.map((r) => r.pane_id)).toEqual(["a", "d"]);
  });

  it("sem id operacional, a janela decide e recibos com id não somem", () => {
    const result = receiptsForMission(receipts, { createdAt: base }, null);
    expect(result.map((r) => r.pane_id)).toEqual(["a", "c", "piloto", "e"]);
  });
});

describe("estado da entrega", () => {
  it("diferencia entrega com prova, sem prova e contrato reprovado", () => {
    const evidence = { files: ["a.ts"] };
    expect(deliveryState({ handoff_status: "done", handoff_evidence: evidence, handoff_contract: "passed" }, "idle").label).toBe("entregue");
    expect(deliveryState({ handoff_status: "done" }, "idle").label).toBe("entregue sem prova");
    expect(deliveryState({ handoff_status: "done", handoff_evidence: evidence, handoff_contract: "failed" }, undefined).label).toMatch(/reprovado/);
  });

  it("sem entrega, olha o pane", () => {
    expect(deliveryState({}, "running").live).toBe(true);
    expect(deliveryState({}, undefined).label).toBe("fechado sem entrega");
    expect(deliveryState({}, "idle").label).toBe("parado, sem entrega");
    expect(deliveryState({ handoff_status: "blocked" }, "running").label).toBe("travado");
  });

  it("resume a evidência sem inventar", () => {
    expect(evidenceSummary(null)).toBeNull();
    expect(evidenceSummary({ commands: [{ cmd: "x", exitCode: 1 }, { cmd: "y", exitCode: 0 }], tested: "sim" })).toBe("2 comandos (1 com erro) · testado");
  });

  it("liga findings ao ajudante pelo pane ou pelo nome", () => {
    const findings = [
      { id: "F-1", severity: "high", status: "open", title: "a", reporter: "p1" },
      { id: "F-2", severity: "low", status: "fixed", title: "b", fixed_by: "Login" },
      { id: "F-3", severity: "low", status: "open", title: "c", reporter: "outro" },
    ] as Finding[];
    expect(findingsForHelper(findings, { pane_id: "p1", name: "Login" }).map((f) => f.id)).toEqual(["F-1", "F-2"]);
  });
});

describe("validação da tabela", () => {
  it("aceita a tabela mínima", () => {
    expect(validateTable(table())).toEqual([]);
  });

  it("exige a linha Geral, nome e CLI nas reservas", () => {
    const issues = validateTable(
      table({ rows: [{ ...blankRow([]), id: "x", name: " ", fallbacks: [{ cli: "", model: null }] }] }),
    );
    expect(issues.map((i) => i.field).sort()).toEqual(["fallbacks", "name", "rows"]);
  });

  it("exige provedor e modelo só com o Decisor ligado", () => {
    const decider = { enabled: true, providerId: null, model: null, minConfidence: 0.6, timeoutMs: 4000 };
    expect(validateTable(table({ decider })).map((i) => i.field)).toEqual(["providerId", "model"]);
    expect(validateTable(table({ decider: { ...decider, minConfidence: 1.4, enabled: false } })).map((i) => i.field)).toEqual(["minConfidence"]);
  });

  it("gera código único sem acento", () => {
    expect(newRowId("Migração Rápida", [])).toBe("migracao-rapida");
    expect(newRowId("Geral", ["geral", "geral-2"])).toBe("geral-3");
  });

  it("transforma texto em lista limpa", () => {
    expect(parseList("a, b,,\n a ,c")).toEqual(["a", "b", "c"]);
  });

  it("lê a resposta do Decisor em qualquer formato", () => {
    expect(decisionView({ decision: { taskId: "corrigir", confidence: 0.8, reason: "erro" }, taskName: "Corrigir bug" })).toEqual({
      decided: true,
      taskLabel: "Corrigir bug",
      confidence: 0.8,
      reason: "erro",
    });
    expect(decisionView({ decision: "corrigir" }).taskLabel).toBe("corrigir");
    expect(decisionView({ decision: null, reason: "decisor sem chave" })).toEqual({
      decided: false,
      taskLabel: null,
      confidence: null,
      reason: "decisor sem chave",
    });
  });
});

describe("barras de uso", () => {
  it("nunca inventa porcentagem a partir de tokens", () => {
    expect(usageBar({ tokens: 900_000 })).toEqual({ kind: "estimated", tokens: 900_000 });
    expect(usageBar({ usedPct: 40, tokens: 900_000 })).toEqual({ kind: "measured", pct: 40 });
    expect(usageBar({})).toEqual({ kind: "none" });
    expect(usageBar({ tokens: 0 })).toEqual({ kind: "none" });
  });

  it("limita a porcentagem medida", () => {
    expect(usageBar({ usedPct: 140 })).toEqual({ kind: "measured", pct: 100 });
  });

  it("descreve a renovação", () => {
    const now = 1_700_000_000_000;
    expect(formatReset(now + 25 * 60_000, now)).toBe("renova em 25 min");
    expect(formatReset(now + 90 * 60_000, now)).toBe("renova em 1h 30min");
    expect(formatReset(now - 1, now)).toBe("renovando");
    expect(formatReset(null, now)).toBeNull();
  });
});

describe("catálogo", () => {
  const items = [
    { kind: "skill", name: "cb-worker", category: "base", installedIn: [{ cli: "claude", path: "/a" }] },
    { kind: "agent", name: "revisor", description: "Acha defeitos", category: "qualidade", installedIn: [{ cli: "codex", path: "/b" }] },
  ] as CatalogItem[];
  const none = { query: "", kind: "all" as const, category: "", cli: "" };

  it("filtra por texto, tipo, categoria e CLI", () => {
    expect(filterCatalog(items, { ...none, query: "defeitos" }).map((i) => i.name)).toEqual(["revisor"]);
    expect(filterCatalog(items, { ...none, kind: "skill" }).map((i) => i.name)).toEqual(["cb-worker"]);
    expect(filterCatalog(items, { ...none, category: "qualidade" }).map((i) => i.name)).toEqual(["revisor"]);
    expect(filterCatalog(items, { ...none, cli: "claude" }).map((i) => i.name)).toEqual(["cb-worker"]);
  });

  it("trata cb-* como nativo mesmo sem a flag", () => {
    expect(isBuiltin({ name: "cb-pilot" })).toBe(true);
    expect(isBuiltin({ name: "meu", builtin: true })).toBe(true);
    expect(isBuiltin({ name: "meu" })).toBe(false);
  });

  it("só oferece cópia para CLI onde ainda não está", () => {
    expect(copyTargets(items[0], ["claude", "codex", "gemini"])).toEqual(["codex", "gemini"]);
  });
});

describe("formulário de mídia", () => {
  const providers = [{ id: "a", label: "A", kinds: ["image"] }];

  it("exige descrição e provedor compatível", () => {
    expect(validateMediaDraft({ kind: "image", prompt: " ", provider: "" }, providers)).toMatch(/Descreva/);
    expect(validateMediaDraft({ kind: "video", prompt: "x", provider: "" }, providers)).toMatch(/vídeo/);
    expect(validateMediaDraft({ kind: "image", prompt: "x", provider: "a" }, providers)).toBeNull();
  });
});
