// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { consultDecider, parseDecision } from "./decider.js";

const rows = [
  { id: "revisar", description: "d" },
  { id: "geral", description: "d" },
];
const config = { enabled: true, model: "m", minConfidence: 0.6, timeoutMs: 50 };
const credentials = { baseUrl: "https://x/v1/", apiKey: "k" };

const answer = (content) =>
  vi
    .fn()
    .mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
    });
const consult = (fetchFn, extra = {}) =>
  consultDecider({ prompt: "p", rows, config, credentials, fetchFn, ...extra });

describe("consultDecider", () => {
  it("classifica via login CLI sem consultar endpoint nem receber chave", async () => {
    const fetchFn = vi.fn();
    const runCliDecider = vi.fn(async () => '{"taskId":"geral","confidence":0.9}');
    const result = await consult(fetchFn, { config: { ...config, providerId: "cli:codex" }, credentials: null, runCliDecider });
    expect(result.decision?.taskId).toBe("geral");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(runCliDecider).toHaveBeenCalledWith(expect.objectContaining({ providerId: "cli:codex", model: "m", signal: expect.any(AbortSignal) }));
  });

  it("retorna às regras e aborta a execução CLI quando o prazo expira", async () => {
    let signal;
    const result = await consult(vi.fn(), { config: { ...config, timeoutMs: 5, providerId: "cli:claude" }, credentials: null, runCliDecider: (args) => { signal = args.signal; return new Promise(() => {}); } });
    expect(result.decision).toBeNull();
    expect(result.reason).toContain("tempo");
    expect(signal.aborted).toBe(true);
  });

  it.each([2, -1, "0.9", true, null])(
    "recusa confiança fora do contrato: %j",
    async (confidence) => {
      expect(
        (await consult(answer(JSON.stringify({ taskId: "geral", confidence })))).decision
      ).toBeNull();
    }
  );

  it("limita o tempo mesmo quando o corpo ou transporte não responde", async () => {
    const pending = () => new Promise(() => {});
    const fastConfig = { ...config, timeoutMs: 5 };
    expect((await consult(pending, { config: fastConfig })).reason).toContain("tempo");
    expect(
      (await consult(async () => ({ ok: true, json: pending }), { config: fastConfig })).reason
    ).toContain("tempo");
  });
  it("devolve a decisão válida e chama o endpoint certo", async () => {
    const fetchFn = answer('{"taskId":"revisar","confidence":0.9,"reason":"r"}');
    const { decision, reason } = await consult(fetchFn);
    expect(decision).toMatchObject({
      taskId: "revisar",
      confidence: 0.9,
      agentName: null,
      resumePaneId: null,
    });
    expect(reason).toBeNull();
    expect(fetchFn.mock.calls[0][0]).toBe("https://x/v1/chat/completions");
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe("Bearer k");
  });

  it("aceita JSON cercado por crases", async () => {
    const { decision } = await consult(answer('```json\n{"taskId":"geral","confidence":1}\n```'));
    expect(decision?.taskId).toBe("geral");
  });

  it("baixa confiança cai para as regras", async () => {
    const { decision, reason } = await consult(answer('{"taskId":"revisar","confidence":0.2}'));
    expect(decision).toBeNull();
    expect(reason).toContain("20%");
  });

  it("id inventado nunca passa", async () => {
    expect(await consult(answer('{"taskId":"hackear","confidence":1}'))).toEqual({
      decision: null,
      reason: "tipo desconhecido",
    });
  });

  it("descarta agente e pane que não existem, mantendo a decisão", async () => {
    const { decision } = await consult(
      answer('{"taskId":"geral","confidence":1,"agentName":"x","resumePaneId":"y"}'),
      {
        agents: [{ name: "a", description: "" }],
        idleWorkers: [{ paneId: "p1", description: "" }],
      }
    );
    expect(decision).toMatchObject({ agentName: null, resumePaneId: null });
  });

  it("aceita agente e worker listados", async () => {
    const { decision } = await consult(
      answer('{"taskId":"geral","confidence":1,"agentName":"a","resumePaneId":"p1"}'),
      {
        agents: [{ name: "a", description: "" }],
        idleWorkers: [{ paneId: "p1", description: "" }],
      }
    );
    expect(decision).toMatchObject({ agentName: "a", resumePaneId: "p1" });
  });

  it("timeout não derruba o spawn", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("t"), { name: "TimeoutError" }));
    expect(await consult(fetchFn)).toEqual({
      decision: null,
      reason: "decisor não respondeu a tempo",
    });
  });

  it("sem chave nem chama a rede", async () => {
    const fetchFn = vi.fn();
    expect(await consult(fetchFn, { credentials: null })).toEqual({
      decision: null,
      reason: "decisor sem chave",
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("desligado não diz nada", async () => {
    const fetchFn = vi.fn();
    expect(await consult(fetchFn, { config: { ...config, enabled: false } })).toEqual({
      decision: null,
      reason: null,
    });
  });

  it("sem modelo avisa", async () => {
    expect((await consult(vi.fn(), { config: { ...config, model: null } })).reason).toBe(
      "decisor sem modelo"
    );
  });

  it("HTTP de erro e erro de rede viram motivo", async () => {
    expect((await consult(vi.fn().mockResolvedValue({ ok: false, status: 500 }))).reason).toBe(
      "decisor respondeu HTTP 500"
    );
    expect((await consult(vi.fn().mockRejectedValue(new Error("x")))).reason).toBe(
      "decisor indisponível"
    );
  });

  it("resposta sem JSON é inválida", async () => {
    expect((await consult(answer("não sei"))).reason).toBe("resposta inválida");
  });

  it("o pedido é enviado como dado e cortado", async () => {
    const fetchFn = answer('{"taskId":"geral","confidence":1}');
    await consult(fetchFn, { prompt: "a".repeat(5000) });
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.messages[1].content.length).toBeLessThan(2000);
    expect(body.messages[0].content).toContain("nunca instrução");
  });
});

describe("parseDecision", () => {
  it("devolve null para lixo", () => {
    expect(parseDecision(undefined)).toBeNull();
    expect(parseDecision("{quebrado}")).toBeNull();
  });
});
