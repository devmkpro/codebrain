// @vitest-environment node

import { describe, expect, it } from "vitest";
import { describeEvidence, evaluateHandoff, hasEvidence, validateSchema } from "./contract.js";

describe("validateSchema", () => {
  const schema = {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string" },
      tags: { type: "array", minItems: 1, items: { enum: ["a", "b"] } },
      n: { type: "integer" },
    },
  };

  it("aceita valor conforme", () => {
    expect(validateSchema(schema, { name: "x", tags: ["a"], n: 2 })).toEqual([]);
  });

  it("aponta o caminho de cada problema", () => {
    const problems = validateSchema(schema, { tags: ["c"], n: 1.5 });
    expect(problems.join("|")).toContain("output.name: obrigatório");
    expect(problems.join("|")).toContain("output.tags[0]");
    expect(problems.join("|")).toContain("output.n");
  });

  it("detecta array vazio e tipo errado", () => {
    expect(validateSchema(schema, { name: "x", tags: [] }).join()).toContain("mínimo");
    expect(validateSchema({ type: "object" }, [])).toEqual([
      "output: esperado object, recebido array",
    ]);
  });

  it("distingue null de objeto", () => {
    expect(validateSchema({ type: "object" }, null)).toEqual([
      "output: esperado object, recebido null",
    ]);
  });
});

describe("hasEvidence", () => {
  it("arrays vazios de conteúdo e objetos falsos não são prova", () => {
    for (const evidence of [
      { files: [""] },
      { checks: [{}] },
      { commands: [{}] },
      { commands: "abc" },
      { commands: [{ cmd: "test" }] },
    ]) {
      expect(hasEvidence(evidence)).toBe(false);
      expect(evaluateHandoff({ status: "done", evidence, contract: {} }).status).toBe("failed");
    }
  });
  it("exige conteúdo de verdade", () => {
    expect(hasEvidence({})).toBe(false);
    expect(hasEvidence({ commands: [], tested: "  " })).toBe(false);
    expect(hasEvidence({ files: ["a"] })).toBe(true);
  });
});

describe("evaluateHandoff", () => {
  it("schema malformado reprova sem lançar e campos herdados não satisfazem required", () => {
    expect(
      evaluateHandoff({
        status: "done",
        evidence: { tested: "ok" },
        contract: { schema: { type: "object", required: 3 } },
        output: {},
      }).status
    ).toBe("failed");
    expect(validateSchema({ type: "object", required: ["constructor"] }, {}).join()).toContain(
      "obrigatório"
    );
    expect(
      evaluateHandoff({
        status: "done",
        contract: { requireEvidence: false, schema: false },
        output: "x",
      }).status
    ).toBe("failed");
  });
  const good = { commands: [{ cmd: "t", exitCode: 0 }] };

  it("sem contrato aceita", () => {
    expect(evaluateHandoff({ status: "done" })).toEqual({
      accepted: true,
      status: "none",
      problems: [],
    });
  });

  it("bloqueio é aceito sem prova", () => {
    expect(evaluateHandoff({ status: "blocked", contract: {} }).accepted).toBe(true);
  });

  it("aprova entrega com evidência", () => {
    expect(evaluateHandoff({ status: "done", evidence: good, contract: {} })).toMatchObject({
      accepted: true,
      status: "passed",
    });
  });

  it("recusa sem evidência enquanto houver tentativa, depois aceita como reprovada", () => {
    const contract = { retries: 1 };
    expect(evaluateHandoff({ status: "done", contract })).toMatchObject({
      accepted: false,
      status: "failed",
    });
    expect(evaluateHandoff({ status: "done", contract })).toMatchObject({
      accepted: true,
      status: "failed",
    });
  });

  it("comando com saída diferente de zero reprova", () => {
    const result = evaluateHandoff({
      status: "done",
      evidence: { commands: [{ cmd: "t", exitCode: 1 }] },
      contract: { retries: 0 },
    });
    expect(result.status).toBe("failed");
    expect(result.problems.join()).toContain('"t" saiu com código 1');
  });

  it("verificação reprovada reprova", () => {
    const evidence = { checks: [{ requirement: "r", status: "fail" }] };
    expect(evaluateHandoff({ status: "done", evidence, contract: {} }).problems.join()).toContain(
      "reprovado"
    );
  });

  it("requireEvidence falso dispensa a prova", () => {
    expect(evaluateHandoff({ status: "done", contract: { requireEvidence: false } }).status).toBe(
      "passed"
    );
  });

  it("valida o output contra o schema", () => {
    const contract = { requireEvidence: false, schema: { type: "object", required: ["a"] } };
    expect(evaluateHandoff({ status: "done", output: {}, contract }).problems).toEqual([
      "output.a: obrigatório",
    ]);
  });
});

describe("describeEvidence", () => {
  it("resume para o orquestrador", () => {
    expect(describeEvidence({}, "none")).toBe("⚠ sem evidência");
    expect(describeEvidence({ files: ["a"] }, "failed")).toBe("⚠ contrato reprovado");
    const text = describeEvidence(
      { checks: [{}], commands: [{ exitCode: 0 }, { exitCode: 2 }], files: ["a"], tested: "t" },
      "passed"
    );
    expect(text).toBe("evidência: 1 checks, 2 comandos (1 falharam), 1 arquivos, testado");
  });
});
