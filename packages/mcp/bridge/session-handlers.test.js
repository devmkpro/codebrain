// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import { createMemoryStore } from "../../memory/store.js";
import {
  createSessionHandlers,
  validateSpawnRequest,
  MAX_SPAWN_PROMPT_CHARS,
} from "./session-handlers.js";
import { createPaneHandlers } from "./pane-handlers.js";
import { createHarnessHandlers } from "./harness-handlers.js";
import { createMissionHandlers } from "./mission-handlers.js";
import { createKanbanHandlers } from "./kanban-handlers.js";

const fixtures = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.store.close();
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-coordination-"));
  const file = path.join(dir, "fixture.db");
  const state = { dir, file, store: createMemoryStore(file) };
  fixtures.push(state);
  const missionA = state.store.createMission({ title: "A", workspace: "D:/project-a" }).id;
  const missionB = state.store.createMission({ title: "B", workspace: "D:/project-b" }).id;
  state.store.actorRegister({
    paneId: "pilot",
    role: "worker",
    workspace: "D:/project-a",
    missionId: missionA,
    agent: "kiro",
  });
  state.store.actorRegister({
    paneId: "worker",
    parentPaneId: "pilot",
    workspace: "D:/project-a",
    missionId: missionA,
    agent: "kiro",
  });
  const opts = {
    get memoryStore() {
      return state.store;
    },
    getCallerPaneId: () => "worker",
    getCurrentWorkspacePath: () => "D:/project-b",
  };
  return { state, missionA, missionB, opts, api: createSessionHandlers(opts) };
}

describe("session: atribuição durável, contexto e escopo", () => {
  it("fluxo real harness -> kanban -> mission_context mantém atribuição após timeout e updates", async () => {
    const { state, opts, missionA } = fixture();
    const config = {
      ...opts,
      memoryStore: state.store,
      paneConfigs: new Map(),
      spawnPaneFn: vi.fn(async () => ({
        ok: true,
        paneId: "worker",
        cwd: "D:/project-a",
        missionId: missionA,
      })),
    };
    const pty = Object.assign(new EventEmitter(), {
      hasPane: (id) => ["worker", "pilot"].includes(id),
      list: () => [
        { paneId: "worker", agent: "kiro" },
        { paneId: "pilot", agent: "kiro" },
      ],
      writeSilent: vi.fn(),
      write: vi.fn(),
      submitWhenReady: vi.fn(async () => {
        const context = await createMissionHandlers(config).missionContext({ paneId: "worker" });
        expect(context.myTasks).toHaveLength(1);
        expect(context.spawnAssignment.prompt).toBe("Implementar somente perfil");
        return { ok: false, deliveryState: "uncertain", error: "Timeout aguardando prontidão" };
      }),
    });
    const panes = createPaneHandlers(pty, config);
    state.store.actorSetMetadata({
      paneId: "worker",
      metadata: { preservedAccessContext: { mode: "read_only" } },
    });
    const api = createHarnessHandlers(panes, pty, config);
    const result = await api.spawnTask({
      prompt: "Implementar somente perfil",
      parentPaneId: "pilot",
      agent: "kiro",
      missionId: missionA,
      cwd: "D:/project-a",
      reuseIdle: false,
    });
    expect(result).toMatchObject({
      ok: false,
      paneId: "worker",
      assignmentPersisted: true,
      promptDelivered: false,
      deliveryState: "uncertain",
    });
    expect(result.taskId).toMatch(/^ktask_/);
    expect(
      state.store.actorGetMetadata({ paneId: "worker" }).metadata.preservedAccessContext
    ).toEqual({ mode: "read_only" });
    await panes.writePane("worker", "Nova regra além da sua tarefa", false, {
      fromPaneId: "pilot",
    });
    await panes.messagePane("worker", "Continue no escopo", false);
    expect(state.store.listKanbanTasks({}).count).toBe(1);
    state.store.close();
    state.store = createMemoryStore(state.file);
    const reloaded = createMissionHandlers({ ...config, memoryStore: state.store });
    expect((await reloaded.missionContext({ paneId: "worker" })).spawnAssignment).toMatchObject({
      prompt: "Implementar somente perfil",
      taskId: result.taskId,
      deliveryState: "uncertain",
    });
    expect(
      (
        await createKanbanHandlers({ ...config, memoryStore: state.store }).taskList(
          {},
          { fromPaneId: "worker" }
        )
      ).tasks[0].id
    ).toBe(result.taskId);
  });

  it("preserva prompt inteiro/task/parent após fechar e reabrir SQLite, mesmo sem entrega à CLI", async () => {
    const { state, missionA, api } = fixture();
    const prompt = "Somente auth, perfil e planos. Não tocar marketplace.\n".repeat(40);
    const saved = api.persistSpawnAssignment({
      paneId: "worker",
      prompt,
      name: "Redesenhar perfil",
    });
    expect(saved).toMatchObject({ ok: true, persisted: true });
    expect(
      api.setSpawnPromptDelivery({
        paneId: "worker",
        delivered: false,
        error: "CLI não ficou pronta",
      }).ok
    ).toBe(true);
    state.store.close();
    state.store = createMemoryStore(state.file);
    const context = await api.missionContext({ paneId: "worker" });
    expect(context).toMatchObject({
      mission: { id: missionA },
      orchestrator: { paneId: "pilot" },
      action: "adopt",
      spawnAssignment: {
        prompt,
        taskId: saved.taskId,
        promptDelivered: false,
        deliveryError: "CLI não ficou pronta",
      },
    });
    expect(context.myTasks).toHaveLength(1);
    expect(context.myTasks[0]).toMatchObject({
      id: saved.taskId,
      description: prompt,
      assigned_to: "worker",
      workspace: "D:/project-a",
      mission_id: missionA,
    });
    expect(api.persistSpawnAssignment({ paneId: "worker", prompt }).taskId).toBe(saved.taskId);
    expect((await api.taskList({})).count).toBe(1);
    expect(api.setSpawnPromptDelivery({ paneId: "worker", delivered: true }).ok).toBe(true);
    expect((await api.missionContext({ paneId: "worker" })).spawnAssignment).toMatchObject({
      promptDelivered: true,
      deliveryError: null,
    });
  });

  it("default usa caller, filtros explícitos preservam cross-workspace, caller desconhecido não vaza UI", async () => {
    const { state, missionA, missionB, api, opts } = fixture();
    state.store.createKanbanTask({ title: "A", workspace: "D:/project-a", mission_id: missionA });
    state.store.createKanbanTask({ title: "B", workspace: "D:/project-b", mission_id: missionB });
    state.store.createKanbanTask({ title: "Global legada" });
    expect((await api.taskList({})).tasks.map((task) => task.title)).toEqual(["A"]);
    expect(
      (await api.taskList({ workspace: "D:/project-b" })).tasks.map((task) => task.title)
    ).toEqual(["B"]);
    expect((await api.taskList({ mission_id: missionB })).tasks.map((task) => task.title)).toEqual([
      "B",
    ]);
    expect(
      await createSessionHandlers({
        memoryStore: state.store,
        getCurrentWorkspacePath: opts.getCurrentWorkspacePath,
      }).taskList({})
    ).toMatchObject({ tasks: [], scopeRequired: true });
    expect(await api.taskList({}, { fromPaneId: "not-existing" })).toMatchObject({
      tasks: [],
      scopeRequired: true,
    });
  });

  it("metadados de entrega e updates não criam atribuições", () => {
    const { state, api } = fixture();
    expect(api.setSpawnPromptDelivery({ paneId: "worker", delivered: true }).ok).toBe(false);
    expect(state.store.listKanbanTasks({}).tasks).toHaveLength(0);
  });

  it("assigned_to explícito mantém compatibilidade sem caller e consulta de contexto não reatribui o pane", async () => {
    const { state, missionA, missionB } = fixture();
    state.store.createKanbanTask({
      title: "Minha tarefa",
      assigned_to: "worker",
      workspace: "D:/project-a",
      mission_id: missionA,
    });
    state.store.actorRegister({
      paneId: "foreign-pilot",
      role: "orchestrator",
      workspace: "D:/project-b",
      missionId: missionB,
    });
    const api = createSessionHandlers({ memoryStore: state.store });
    expect((await api.taskList({ assigned_to: "worker" })).tasks.map((task) => task.title)).toEqual(
      ["Minha tarefa"]
    );
    const query = await api.missionContext({
      paneId: "worker",
      workspace: "D:/project-b",
      missionId: missionB,
    });
    expect(query.orchestrator?.paneId).toBe("foreign-pilot");
    expect(state.store.getActorRole({ paneId: "worker" }).missionId).toBe(missionA);
  });

  it("não busca missão global nem piloto de outro projeto quando falta contexto", async () => {
    const { state, api, missionB } = fixture();
    state.store.actorRegister({
      paneId: "foreign",
      workspace: "D:/project-b",
      missionId: missionB,
      role: "orchestrator",
    });
    const unknown = await api.missionContext({ paneId: "unknown" });
    expect(unknown).toMatchObject({ ok: false, tasks: [], myTasks: [] });
    const foreignQuery = await api.missionContext({ paneId: "worker", workspace: "D:/project-b" });
    expect(foreignQuery).toMatchObject({
      mission: null,
      orchestrator: null,
      spawnAssignment: null,
      myTasks: [],
    });
  });

  it("erro de task preserva prompt e retorna resultado parcial honesto", async () => {
    const { state, api } = fixture();
    state.store.createKanbanTask = () => ({ ok: false, error: "DB ocupada" });
    const saved = api.persistSpawnAssignment({ paneId: "worker", prompt: "Implementar perfil" });
    expect(saved).toMatchObject({ ok: false, persisted: true, taskId: null, error: "DB ocupada" });
    expect((await api.missionContext({ paneId: "worker" })).spawnAssignment.prompt).toBe(
      "Implementar perfil"
    );
  });

  it("não salva task órfã se o pane não está registrado", () => {
    const { state, api } = fixture();
    expect(api.persistSpawnAssignment({ paneId: "unknown", prompt: "Trabalho" })).toMatchObject({
      ok: false,
      persisted: false,
    });
    expect(state.store.listKanbanTasks({}).count).toBe(0);
  });
});

describe("session: validação e limite de spawn", () => {
  it.each([
    { prompt: "PLACEHOLDER", panes: [{ prompt: "Real" }] },
    { prompt: "", panes: [{ prompt: "Real" }] },
    { panes: [] },
    { panes: "wrong" },
    { panes: [{ prompt: "ok" }, { prompt: " " }] },
    { prompt: "x".repeat(MAX_SPAWN_PROMPT_CHARS + 1) },
    { panes: Array.from({ length: 5 }, () => ({ prompt: "x".repeat(MAX_SPAWN_PROMPT_CHARS) })) },
  ])("rejeita lote/texto inválido antes de qualquer mutação", async (request) => {
    const spawnTask = vi.fn();
    const api = createSessionHandlers({ spawnTask });
    expect((await api.spawnTask(request)).ok).toBe(false);
    expect(spawnTask).not.toHaveBeenCalled();
  });

  it("mantém no máximo 2 spawns, resultados ordenados e falhas individuais, inclusive outra chamada concorrente", async () => {
    let active = 0;
    let peak = 0;
    const spawned = [];
    const spawnTask = vi.fn(async (request) => {
      active++;
      peak = Math.max(peak, active);
      spawned.push(request);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      if (request.prompt === "fail") throw new Error("CLI indisponível");
      return { ok: true, paneId: request.prompt };
    });
    const api = createSessionHandlers({ spawnTask });
    const [batch, single] = await Promise.all([
      api.spawnTask({
        parentPaneId: "pilot",
        agent: "kiro",
        panes: ["one", "fail", "three", "four", "five"].map((prompt) => ({ prompt })),
      }),
      api.spawnTask({ prompt: "single", agent: "codex" }),
    ]);
    expect(peak).toBe(2);
    expect(batch.ok).toBe(false);
    expect(batch.panes).toHaveLength(5);
    expect(batch.panes.map((result) => result.index)).toEqual([0, 1, 2, 3, 4]);
    expect(batch.panes[1]).toMatchObject({ ok: false, error: "CLI indisponível" });
    expect(single).toMatchObject({ ok: true, paneId: "single" });
    expect(spawned.filter((request) => request.agent === "kiro")).toHaveLength(5);
    expect(spawned.every((request) => !request.panes)).toBe(true);
  });

  it("permite spawn legado vazio e lote sem prompt de topo", () => {
    expect(validateSpawnRequest({}).ok).toBe(true);
    expect(validateSpawnRequest({ panes: [{ prompt: "Real" }] }).ok).toBe(true);
  });
});
