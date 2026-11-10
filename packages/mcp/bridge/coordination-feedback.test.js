// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPaneHandlers } from "./pane-handlers.js";
import { createKanbanHandlers } from "./kanban-handlers.js";
import { createMissionHandlers } from "./mission-handlers.js";
import { createHarnessHandlers } from "./harness-handlers.js";

afterEach(() => vi.useRealTimers());

function setup(overrides = {}) {
  const panes = [
    { paneId: "pilot", agent: "kiro", cwd: "/a" },
    { paneId: "worker", agent: "kiro", cwd: "/a" },
    { paneId: "shell", agent: "shell", cwd: "/a" },
  ];
  const pty = Object.assign(new EventEmitter(), {
    hasPane: (id) => panes.some((p) => p.paneId === id),
    list: () => panes,
    writeSilent: vi.fn(),
    write: vi.fn(),
  });
  const metadata = new Map();
  const memoryStore = {
    actorRegister: vi.fn(() => ({ ok: true })),
    actorGet: ({ paneId }) => ({
      ok: true,
      actor: {
        pane_id: paneId,
        workspace: "/a",
        parent_pane_id: paneId === "shell" ? "other-worker" : "pilot",
        mission_id: "mission_a",
      },
    }),
    getActorRole: () => ({ ok: true, role: "worker", missionId: "mission_a" }),
    actorSetMetadata: vi.fn(({ paneId, metadata: value }) => {
      metadata.set(paneId, value);
      return { ok: true };
    }),
    actorGetMetadata: ({ paneId }) => ({ ok: true, metadata: metadata.get(paneId) || {} }),
    listKanbanTasks: vi.fn(() => ({ ok: true, tasks: [], count: 0 })),
    createKanbanTask: vi.fn(() => ({ ok: true, id: "task_1" })),
    getMission: ({ id }) => ({ ok: true, mission: { id, workspace: "/a" } }),
    resolveActiveMission: () => ({
      ok: true,
      mission: { id: "mission_unrelated", workspace: "/a" },
    }),
    findOrchestrator: () => ({ ok: true, count: 0, orchestrators: [] }),
    submitHandoff: () => ({ ok: true, id: "handoff_1" }),
    write: vi.fn(),
  };
  const opts = {
    memoryStore,
    paneConfigs: new Map([
      ["worker", { agent: "kiro", cwd: "/a", missionId: "mission_a", parentPaneId: "pilot" }],
      ["shell", { agent: "shell", parentPaneId: "other-worker", shellBusy: true }],
    ]),
    paneLabels: new Map(),
    getCurrentWorkspacePath: () => "/a",
    getCallerPaneId: () => "pilot",
    spawnPaneFn: vi.fn(async () => ({
      ok: true,
      paneId: "worker",
      missionId: "mission_a",
      cwd: "/a",
    })),
    ...overrides,
  };
  return { pty, opts, memoryStore, metadata, api: createPaneHandlers(pty, opts) };
}

describe("feedback de coordenação: regressões", () => {
  it("rejeita prompt de topo combinado com panes antes de abrir qualquer terminal", async () => {
    const { api, pty, opts } = setup();
    const harness = createHarnessHandlers(api, pty, opts);
    const result = await harness.spawnTask({ prompt: "PLACEHOLDER", panes: [{ prompt: "Real" }] });
    expect(result).toMatchObject({ ok: false });
    expect(opts.spawnPaneFn).not.toHaveBeenCalled();
  });

  it("task_list sem filtro usa workspace do caller em vez de consultar todos", async () => {
    const { opts, memoryStore } = setup({ getCurrentWorkspacePath: () => "/other" });
    await createKanbanHandlers(opts).taskList({});
    expect(memoryStore.listKanbanTasks).toHaveBeenCalledWith(
      expect.objectContaining({ workspace: "/a" })
    );
  });

  it("mission_context conserva missão/parent do worker e inclui atribuição persistida", async () => {
    const { opts } = setup();
    const result = await createMissionHandlers(opts).missionContext({ paneId: "worker" });
    expect(result).toMatchObject({
      mission: { id: "mission_a" },
      orchestrator: { paneId: "pilot" },
    });
  });

  it("spawn com prompt salva o texto completo vinculado ao pane e kanban", async () => {
    const { api, memoryStore } = setup();
    const prompt = "Implementar somente as telas de perfil. ".repeat(20);
    const result = await api.spawnPane({
      agent: "kiro",
      initialPrompt: prompt,
      parentPaneId: "pilot",
      missionId: "mission_a",
      reuseIdle: false,
    });
    expect(result.taskId).toBe("task_1");
    expect(memoryStore.createKanbanTask).toHaveBeenCalledWith(
      expect.objectContaining({
        description: prompt,
        assigned_to: "worker",
        workspace: "/a",
        mission_id: "mission_a",
      })
    );
  });

  it("recusa escrita em shell de outro dono, sem tocar stdin", async () => {
    const { api, pty } = setup();
    const result = await api.writePane("shell", "npm test", false);
    expect(result).toMatchObject({ ok: false });
    expect(pty.writeSilent).not.toHaveBeenCalled();
  });

  it("recusa paneId inexistente sem simular sucesso", async () => {
    const { api, pty } = setup();
    expect(await api.writePane("not-a-pane", "echo hi", false)).toMatchObject({
      ok: false,
      error: "pane not found",
    });
    expect(pty.writeSilent).not.toHaveBeenCalled();
  });

  it.each([true, undefined])(
    "recusa shell próprio ocupado ou de estado desconhecido: %s",
    async (busy) => {
      const { api, opts, pty } = setup();
      Object.assign(opts.paneConfigs.get("shell"), { parentPaneId: "pilot", shellBusy: busy });
      expect(await api.writePane("shell", "npm test", false)).toMatchObject({
        ok: false,
        identityVerified: false,
      });
      expect(pty.writeSilent).not.toHaveBeenCalled();
    }
  );

  it("aceita shell próprio explicitamente livre e piloto escrevendo no worker de IA", async () => {
    const { api, opts, pty } = setup();
    Object.assign(opts.paneConfigs.get("shell"), { parentPaneId: "pilot", shellBusy: false });
    expect(await api.writePane("shell", "echo hi", false, { fromPaneId: "pilot" })).toMatchObject({
      ok: true,
    });
    expect(
      await api.writePane("worker", "Continue no escopo", false, { fromPaneId: "pilot" })
    ).toMatchObject({ ok: true });
    expect(pty.writeSilent).toHaveBeenCalledTimes(2);
    expect(opts.memoryStore.createKanbanTask).not.toHaveBeenCalled();
  });

  it("pane_list expõe owner/shell/ocupação, nunca o prompt completo", async () => {
    const { api, opts } = setup();
    opts.paneConfigs.get("shell").shellExecutable = "cmd.exe";
    opts.paneConfigs.get("worker").spawnBrief = { prompt: "Não mostrar no inventário" };
    const panes = await api.listPanes(opts.paneLabels);
    expect(panes.find((pane) => pane.paneId === "shell")).toMatchObject({
      ownerPaneId: "other-worker",
      shell: "cmd.exe",
      shellBusy: true,
    });
    expect(JSON.stringify(panes)).not.toContain("Não mostrar no inventário");
  });

  it("reuse de shell exige mesmo owner conhecido e estado livre", () => {
    const { api, opts } = setup();
    opts.memoryStore.actorList = () => ({
      actors: [{ pane_id: "shell", role: "worker", status: "idle", agent: "shell" }],
    });
    expect(api.findIdleWorker({ agent: "shell" })).toBeNull();
    expect(api.findIdleWorker({ agent: "shell", parentPaneId: "pilot" })).toBeNull();
    expect(api.findIdleWorker({ agent: "shell", parentPaneId: "other-worker" })).toBeNull();
    opts.paneConfigs.get("shell").shellBusy = false;
    expect(api.findIdleWorker({ agent: "shell", parentPaneId: "other-worker" })).toMatchObject({
      pane_id: "shell",
    });
  });

  it("handoff informa destino e não escolhe piloto de outro workspace", async () => {
    const { api } = setup();
    const result = await api.handoffSubmit({
      paneId: "worker",
      status: "blocked",
      summary: "Falta autorização",
    });
    expect(result).toMatchObject({ ok: true, delivery: { paneId: "pilot", delivered: true } });
  });

  it("handoff sem destino seguro é salvo mas não enviado a outro workspace", async () => {
    const { api, opts, pty } = setup();
    opts.memoryStore.actorGet = ({ paneId }) => ({
      ok: true,
      actor: {
        pane_id: paneId,
        workspace: paneId === "worker" ? "/a" : "/b",
        parent_pane_id: paneId === "worker" ? "pilot" : null,
        mission_id: "mission_a",
      },
    });
    opts.roleMap = api.roleMap;
    api.roleMap.set("pilot", "orchestrator");
    opts.memoryStore.findOrchestrator = () => ({ ok: true, count: 1, orchestrators: ["pilot"] });
    const result = await api.handoffSubmit({
      paneId: "worker",
      status: "blocked",
      summary: "Sem destino",
    });
    expect(result).toMatchObject({
      ok: true,
      delivery: { paneId: null, delivered: false, acknowledged: false },
    });
    expect(pty.writeSilent).not.toHaveBeenCalled();
  });

  it("falha de gravação do handoff não dispara mensagem nem conclusão de task", async () => {
    const { api, opts, pty } = setup();
    opts.memoryStore.submitHandoff = () => ({ ok: false, error: "DB busy" });
    expect(
      await api.handoffSubmit({ paneId: "worker", status: "done", summary: "ok" })
    ).toMatchObject({ ok: false, error: "DB busy" });
    expect(pty.writeSilent).not.toHaveBeenCalled();
  });
});
