// @vitest-environment node

import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { createDefaultTable, saveHarnessTable } from "./harness.js";
import { createHarnessHandlers } from "./harness-handlers.js";

afterEach(() => vi.unstubAllGlobals());

function tableFile(table) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cb-handlers-")), "harness.json");
  saveHarnessTable(file, table);
  return file;
}

function setup(overrides = {}, paneOverrides = {}) {
  const paneHandlers = {
    spawnPane: vi.fn(async () => ({ ok: true, paneId: "p1", agent: "claude" })),
    writePane: vi.fn(async () => ({ ok: true })),
    actorList: vi.fn(() => ({ actors: [] })),
    emitPaneMeta: vi.fn(),
    ...paneOverrides,
  };
  const ptyManager = {
    list: () => [
      { paneId: "pai", agent: "codex" },
      { paneId: "vivo", agent: "codex", status: "idle" },
    ],
    hasPane: (id) => id === "vivo",
  };
  const opts = {
    paneContracts: new Map(),
    paneLabels: new Map(),
    harnessTablePath: path.join(os.tmpdir(), "cb-tabela-inexistente.json"),
    getCurrentWorkspacePath: () => "/ws",
    memoryStore: { recordSpawnReceipt: vi.fn() },
    ...overrides,
  };
  return {
    api: createHarnessHandlers(paneHandlers, ptyManager, opts),
    paneHandlers,
    opts,
    ptyManager,
  };
}

describe("spawnTask", () => {
  it("herda missão operacional do parent e usa missão efetiva no recibo", async () => {
    const { api, paneHandlers, opts } = setup(
      { paneConfigs: new Map([["pai", { cwd: "/parent-ws", missionId: "mission_parent" }]]) },
      {
        spawnPane: vi.fn(async () => ({
          ok: true,
          paneId: "p1",
          missionId: "mission_actual",
          cwd: "/parent-ws",
        })),
      }
    );
    const result = await api.spawnTask({
      prompt: "x",
      parentPaneId: "pai",
      missionId: "local-ui-123",
    });
    expect(paneHandlers.spawnPane.mock.calls[0][0]).toMatchObject({
      cwd: "/parent-ws",
      missionId: "mission_parent",
    });
    expect(result.missionId).toBe("mission_actual");
    expect(opts.memoryStore.recordSpawnReceipt.mock.calls[0][0]).toMatchObject({
      workspace: "/parent-ws",
      missionId: "mission_actual",
    });
  });

  it("não persiste ID local da UI como missão operacional", async () => {
    const { api, opts } = setup(
      {},
      { spawnPane: vi.fn(async () => ({ ok: true, paneId: "p1", missionId: "ui-local" })) }
    );
    await api.spawnTask({ prompt: "x", missionId: "ui-local" });
    expect(opts.memoryStore.recordSpawnReceipt.mock.calls[0][0].missionId).toBeNull();
  });
  function resumable(overrides = {}, configOverride = {}, request = {}) {
    const table = createDefaultTable();
    table.decider = { ...table.decider, enabled: true, model: "m" };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: true,
          json: async () => ({
            choices: [
              { message: { content: '{"taskId":"geral","confidence":1,"resumePaneId":"vivo"}' } },
            ],
          }),
        })
    );
    const setupResult = setup(
      {
        harnessTablePath: tableFile(table),
        getDeciderCredentials: () => ({ baseUrl: "https://x", apiKey: "fake-test-key" }),
        paneConfigs: new Map([
          [
            "vivo",
            {
              agent: "codex",
              model: "m",
              cwd: "/ws",
              effort: "medium",
              allowedSkills: ["cb-worker", "cb-evidence"],
              ...configOverride,
            },
          ],
        ]),
        ...overrides,
      },
      {
        actorList: vi.fn(() => ({
          actors: [{ pane_id: "vivo", available: true, description: "fazia" }],
        })),
      }
    );
    return {
      ...setupResult,
      request: { prompt: "continue", agent: "codex", model: "m", ...request },
    };
  }

  it.each([
    { agent: "claude" },
    { model: "other" },
    { cwd: "/elsewhere" },
    { effort: "high" },
    { accountId: "other" },
    { allowedSkills: ["extra"] },
    { allowedSkills: undefined },
    { parentPaneId: "other" },
    { missionId: "other" },
  ])("decisor não retoma runtime incompatível %j", async (configOverride) => {
    const { api, paneHandlers, request } = resumable({}, configOverride);
    expect((await api.spawnTask(request)).paneId).toBe("p1");
    expect(paneHandlers.spawnPane).toHaveBeenCalledOnce();
    expect(paneHandlers.writePane.mock.calls[0][0]).toBe("p1");
  });

  it("não retoma pane que deixou de estar disponível durante consulta", async () => {
    const { api, paneHandlers, request } = resumable();
    paneHandlers.actorList
      .mockReturnValueOnce({ actors: [{ pane_id: "vivo", available: true, description: "fazia" }] })
      .mockReturnValue({ actors: [{ pane_id: "vivo", available: false, description: "fazia" }] });
    expect((await api.spawnTask(request)).paneId).toBe("p1");
  });

  it("reuseIdle=false e revisão impedem retomada indicada pelo decisor", async () => {
    const { api, paneHandlers, request } = resumable({}, {}, { reuseIdle: false });
    await api.spawnTask(request);
    expect(paneHandlers.spawnPane).toHaveBeenCalledOnce();
  });

  it("recibo retomado usa configuração real, inclusive em persistência", async () => {
    const { api, opts, request } = resumable({}, { accountLabel: "Real" });
    const result = await api.spawnTask(request);
    expect(result).toMatchObject({
      reused: true,
      agent: "codex",
      model: "m",
      effort: "medium",
      skills: ["cb-worker", "cb-evidence"],
    });
    expect(result.receipt).toContain("codex");
    expect(opts.memoryStore.recordSpawnReceipt.mock.calls[0][0]).toMatchObject({
      agent: "codex",
      model: "m",
      account: "Real",
      reused: true,
    });
  });

  it("contrato está instalado durante entrega pronta para handoff", async () => {
    const { api, opts, paneHandlers, ptyManager } = setup();
    ptyManager.submitWhenReady = vi.fn(async (paneId) => {
      expect(opts.paneContracts.get(paneId)).toMatchObject({ retries: 2, attempts: 0 });
      return { ok: true };
    });
    await api.spawnTask({ prompt: "x", expect: { retries: 2 } });
    expect(ptyManager.submitWhenReady).toHaveBeenCalledOnce();
    expect(paneHandlers.writePane).not.toHaveBeenCalled();
    expect(paneHandlers.spawnPane.mock.calls[0][0].initialPrompt).toBeUndefined();
  });

  it("nova tarefa sem expect limpa contrato antigo antes de entregar", async () => {
    const { api, opts, paneHandlers } = setup(
      {},
      { spawnPane: vi.fn(async () => ({ ok: true, paneId: "p1", reused: true })) }
    );
    opts.paneContracts.set("p1", { retries: 3 });
    paneHandlers.writePane.mockImplementation(async () => {
      expect(opts.paneContracts.has("p1")).toBe(false);
      return { ok: true };
    });
    expect((await api.spawnTask({ prompt: "x" })).ok).toBe(true);
  });

  it("falha de entrega restaura contrato anterior e não registra sucesso", async () => {
    const { api, opts } = setup(
      {},
      { writePane: vi.fn(async () => ({ ok: false, error: "pane saiu" })) }
    );
    const old = { attempts: 1 };
    opts.paneContracts.set("p1", old);
    expect(await api.spawnTask({ prompt: "x", expect: {} })).toMatchObject({
      ok: false,
      error: "pane saiu",
    });
    expect(opts.paneContracts.get("p1")).toBe(old);
    expect(opts.memoryStore.recordSpawnReceipt).not.toHaveBeenCalled();
  });

  it("batch não perde os outros resultados quando um spawn lança", async () => {
    const { api } = setup(
      {},
      {
        spawnPane: vi
          .fn()
          .mockRejectedValueOnce(new Error("failed"))
          .mockResolvedValueOnce({ ok: true, paneId: "p2" }),
      }
    );
    const result = await api.spawnTask({ panes: [{ prompt: "a" }, { prompt: "b" }] });
    expect(result.panes).toMatchObject([
      { ok: false, error: "failed" },
      { ok: true, paneId: "p2" },
    ]);
  });

  it("batch não entrega duas tarefas ao mesmo worker ocioso", async () => {
    const { api, paneHandlers } = setup(
      {},
      {
        spawnPane: vi.fn(async ({ reuseIdle }) => ({
          ok: true,
          paneId: reuseIdle ? "idle" : "fresh",
          reused: reuseIdle,
        })),
      }
    );
    let finish;
    paneHandlers.writePane.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const pending = api.spawnTask({ panes: [{ prompt: "a" }, { prompt: "b" }] });
    await vi.waitFor(() => expect(paneHandlers.writePane).toHaveBeenCalledTimes(2));
    finish({ ok: true });
    const result = await pending;
    expect(result.panes.map((pane) => pane.paneId)).toEqual(["idle", "fresh"]);
  });
  it("sem prompt abre o pane vazio", async () => {
    const { api, paneHandlers } = setup();
    await api.spawnTask({ agent: "claude" });
    expect(paneHandlers.spawnPane).toHaveBeenCalledWith({ agent: "claude" });
  });

  it("com prompt envia os metadados e o nome ao pane", async () => {
    const { api, paneHandlers, opts } = setup({
      pickAccount: () => ({ id: "a1", label: "Trabalho" }),
    });
    const result = await api.spawnTask({
      prompt: "revise o login",
      name: "Revisar login",
      parentPaneId: "pai",
      agent: "claude",
    });
    const call = paneHandlers.spawnPane.mock.calls[0][0];
    expect(call).toMatchObject({
      label: "Revisar login",
      taskType: "revisar",
      effort: "high",
      accountId: "a1",
      accountLabel: "Trabalho",
      reuseIdle: false,
    });
    expect(call.initialPrompt).toBeUndefined();
    expect(paneHandlers.writePane.mock.calls[0][1]).toContain("handoff_submit");
    expect(result).toMatchObject({
      ok: true,
      paneId: "p1",
      name: "Revisar login",
      taskType: "revisar",
    });
    expect(opts.memoryStore.recordSpawnReceipt).toHaveBeenCalledOnce();
  });

  it("deriva o nome quando não foi dado", async () => {
    const { api, paneHandlers } = setup();
    await api.spawnTask({ prompt: "explique o projeto" });
    expect(paneHandlers.spawnPane.mock.calls[0][0].label).toBe("explique o projeto");
  });

  it("aplica opts.resolveSkills na whitelist", async () => {
    const { api, paneHandlers } = setup({
      resolveSkills: (skills) => skills.filter((skill) => skill !== "cb-worker"),
    });
    await api.spawnTask({ prompt: "olá" });
    expect(paneHandlers.spawnPane.mock.calls[0][0].allowedSkills).toEqual(["cb-evidence"]);
  });

  it("inclui as instruções do agente da linha no prompt", async () => {
    const table = createDefaultTable();
    table.rows.find((row) => row.id === "geral").agentName = "ag";
    const { api, paneHandlers } = setup({
      harnessTablePath: tableFile(table),
      getAgentInstructions: (name) => (name === "ag" ? "PERSONA" : null),
    });
    await api.spawnTask({ prompt: "olá" });
    expect(paneHandlers.writePane.mock.calls[0][1]).toMatch(/^PERSONA/);
  });

  it("retomar um worker pelo decisor avisa a tela e não abre pane", async () => {
    const table = createDefaultTable();
    table.decider = { ...table.decider, enabled: true, model: "m" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            { message: { content: '{"taskId":"geral","confidence":1,"resumePaneId":"vivo"}' } },
          ],
        }),
      })
    );
    const { api, paneHandlers } = setup(
      {
        harnessTablePath: tableFile(table),
        getDeciderCredentials: () => ({ baseUrl: "https://x", apiKey: "k" }),
        paneConfigs: new Map([
          [
            "vivo",
            {
              agent: "codex",
              cwd: "/ws",
              effort: "medium",
              allowedSkills: ["cb-worker", "cb-evidence"],
            },
          ],
        ]),
      },
      {
        actorList: vi.fn(() => ({
          actors: [{ pane_id: "vivo", available: true, description: "fazia" }],
        })),
      }
    );
    const result = await api.spawnTask({ prompt: "continue", name: "Continuar" });
    vi.unstubAllGlobals();
    expect(paneHandlers.spawnPane).not.toHaveBeenCalled();
    expect(result).toMatchObject({ paneId: "vivo", reused: true });
    expect(paneHandlers.emitPaneMeta).toHaveBeenCalledWith("vivo", {
      label: "Continuar",
      taskType: "geral",
    });
  });

  it("registra o contrato do pane", async () => {
    const { api, opts } = setup();
    await api.spawnTask({ prompt: "x", expect: { schema: { type: "object" }, retries: 2 } });
    expect(opts.paneContracts.get("p1")).toMatchObject({
      retries: 2,
      requireEvidence: true,
      attempts: 0,
    });
  });

  it("reaproveitado recebe o prompt por escrita", async () => {
    const { api, paneHandlers, opts } = setup(
      {},
      { spawnPane: vi.fn(async () => ({ ok: true, paneId: "p9", reused: true })) }
    );
    const result = await api.spawnTask({ prompt: "olá", name: "Nome" });
    expect(opts.paneLabels.get("p9")).toBe("Nome");
    expect(paneHandlers.writePane).toHaveBeenCalledWith("p9", expect.stringContaining("olá"), true);
    expect(result.reused).toBe(true);
    // Quem reaproveitou por spawnPane já avisou a tela.
    expect(paneHandlers.emitPaneMeta).not.toHaveBeenCalled();
  });

  it("falha do spawn volta com o erro e o recibo", async () => {
    const { api } = setup({}, { spawnPane: vi.fn(async () => ({ error: "sem CLI" })) });
    const result = await api.spawnTask({ prompt: "olá" });
    expect(result).toMatchObject({ ok: false, error: "sem CLI" });
    expect(result.receipt).toBeTruthy();
  });

  it("entrega o contexto do adaptador também no prompt enviado depois do spawn", async () => {
    const { api, paneHandlers } = setup({}, {
      spawnPane: vi.fn(async () => ({ ok: true, paneId: "p9", codebrainContext: "CONTEXTO NATIVO DO REPOSITÓRIO" })),
    });
    await api.spawnTask({ prompt: "validar o projeto" });
    expect(paneHandlers.writePane).toHaveBeenCalledWith("p9", expect.stringContaining("CONTEXTO NATIVO DO REPOSITÓRIO"), true);
    expect(paneHandlers.writePane).toHaveBeenCalledWith("p9", expect.stringContaining("validar o projeto"), true);
  });

  it("N panes em paralelo numa chamada", async () => {
    let id = 0;
    const { api } = setup({}, { spawnPane: vi.fn(async () => ({ ok: true, paneId: `p${++id}` })) });
    const result = await api.spawnTask({ panes: [{ prompt: "a" }, { prompt: "b" }] });
    expect(result.ok).toBe(true);
    expect(result.panes.map((pane) => pane.paneId)).toEqual(["p1", "p2"]);
  });

  it("recusa panes demais", async () => {
    const { api, paneHandlers } = setup();
    const result = await api.spawnTask({
      panes: Array.from({ length: 17 }, () => ({ prompt: "a" })),
    });
    expect(result.ok).toBe(false);
    expect(paneHandlers.spawnPane).not.toHaveBeenCalled();
  });
});

describe("catalogList", () => {
  const scanCatalog = () => [
    {
      kind: "skill",
      name: "alfa",
      description: "busca coisas",
      installedIn: [
        { cli: "claude", path: "/x" },
        { cli: "claude", path: "/y" },
      ],
      disabled: false,
    },
    {
      kind: "agent",
      name: "beta",
      description: "outra",
      installedIn: [{ cli: "claude", path: "/z" }],
      disabled: true,
    },
  ];

  it("filtra por tipo e texto, sem expor caminhos", () => {
    const { api } = setup({ scanCatalog });
    expect(api.catalogList({ kind: "agent" }).items.map((item) => item.name)).toEqual(["beta"]);
    const { items } = api.catalogList({ query: "BUSCA" });
    expect(items).toEqual([
      {
        kind: "skill",
        name: "alfa",
        description: "busca coisas",
        clis: ["claude"],
        disabled: false,
      },
    ]);
  });

  it("sem catálogo devolve vazio", () => {
    expect(setup().api.catalogList()).toEqual({ ok: true, items: [] });
  });
});

describe("findings", () => {
  it("preenche o workspace atual", () => {
    const findingAdd = vi.fn(() => ({ ok: true }));
    const { api } = setup({ memoryStore: { findingAdd } });
    api.findingAdd({ title: "t" });
    expect(findingAdd).toHaveBeenCalledWith({ title: "t", workspace: "/ws" });
  });
});
