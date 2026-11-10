// @vitest-environment node

import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createPaneHandlers } from "./pane-handlers.js";

function setup(overrides = {}) {
  const ptyManager = Object.assign(new EventEmitter(), {
    list: () => [{ paneId: "p1", agent: "claude" }],
    hasPane: () => true,
    writeSilent: vi.fn(),
    write: vi.fn(),
  });
  const emitToRenderer = vi.fn();
  const paneConfigs = new Map([["p1", { effort: "high", accountLabel: "Trabalho" }]]);
  const opts = { emitToRenderer, paneConfigs, paneLabels: new Map(), paneContracts: new Map(), ...overrides };
  return { api: createPaneHandlers(ptyManager, opts), emitToRenderer, paneConfigs, opts };
}

const store = (idle = []) => ({
  submitHandoff: vi.fn(() => ({ ok: true })),
  actorList: () => ({ actors: idle }),
  actorRegister: vi.fn(),
  listKanbanTasks: () => ({ tasks: [] }),
  write: vi.fn(),
});

describe("pane:meta", () => {
  it("reaproveitar atualiza nome e tarefa, mas mantém o esforço real do pane", async () => {
    const memoryStore = store([{ pane_id: "p1", role: "worker", status: "idle", agent: "claude" }]);
    const { api, emitToRenderer, paneConfigs } = setup({ memoryStore });
    const result = await api.spawnPane({ agent: "claude", label: "Novo nome", taskType: "corrigir" });
    expect(result.reused).toBe(true);
    expect(emitToRenderer).toHaveBeenCalledWith("pane:meta", {
      paneId: "p1",
      label: "Novo nome",
      taskType: "corrigir",
      effort: "high",
      accountLabel: "Trabalho",
    });
    expect(paneConfigs.get("p1")).toMatchObject({ label: "Novo nome", taskType: "corrigir", effort: "high" });
  });

  it("handoff aceito manda status e resumo da evidência", async () => {
    const { api, emitToRenderer } = setup({ memoryStore: store() });
    await api.handoffSubmit({ paneId: "p1", summary: "ok", status: "done", evidence: { files: ["a"] } });
    expect(emitToRenderer).toHaveBeenCalledWith(
      "pane:meta",
      expect.objectContaining({ paneId: "p1", handoffStatus: "done", contractStatus: "none", evidence: "evidência: 1 arquivos" }),
    );
  });

  it("handoff recusado pelo contrato avisa a tela", async () => {
    const paneContracts = new Map([["p1", { retries: 1, attempts: 0 }]]);
    const { api, emitToRenderer } = setup({ memoryStore: store(), paneContracts });
    const result = await api.handoffSubmit({ paneId: "p1", summary: "ok", status: "done" });
    expect(result.rejected).toBe(true);
    expect(emitToRenderer).toHaveBeenCalledWith(
      "pane:meta",
      expect.objectContaining({ handoffStatus: "rejected", contractStatus: "failed", evidence: "⚠ contrato reprovado" }),
    );
  });

  it("repassa os metadados ao abrir um pane novo", async () => {
    const spawnPaneFn = vi.fn(async () => ({ ok: true, paneId: "novo" }));
    const { api } = setup({ spawnPaneFn });
    await api.spawnPane({ agent: "claude", label: "L", taskType: "t", effort: "high", accountId: "a", accountLabel: "A", allowedSkills: ["s"], reuseIdle: false });
    expect(spawnPaneFn).toHaveBeenCalledWith(
      expect.objectContaining({ label: "L", taskType: "t", effort: "high", accountId: "a", accountLabel: "A", allowedSkills: ["s"] }),
    );
  });

  it("pane_list traz os metadados", async () => {
    const { api, paneConfigs } = setup();
    paneConfigs.get("p1").taskType = "testar";
    const [pane] = await api.listPanes(new Map([["p1", "Nome"]]));
    expect(pane).toMatchObject({ label: "Nome", taskType: "testar", effort: "high", accountLabel: "Trabalho" });
  });

  it.each([
    { effort: "low" },
    { accountId: "other-account" },
    { allowedSkills: ["cb-reviewer"] },
    { cwd: "/another-project" },
    { agentName: "cb-reviewer" },
  ])("abre um processo novo quando o runtime solicitado difere: %j", async (requested) => {
    const memoryStore = store([{ pane_id: "p1", role: "worker", status: "idle", agent: "claude" }]);
    const spawnPaneFn = vi.fn(async () => ({ ok: true, paneId: "new" }));
    const { api, opts } = setup({ memoryStore, spawnPaneFn });
    opts.paneLabels.set("p1", "Mesmo nome");
    const result = await api.spawnPane({ agent: "claude", label: "Mesmo nome", ...requested });
    expect(result.paneId).toBe("new");
    expect(spawnPaneFn).toHaveBeenCalledOnce();
  });

  it("revisão em pane novo não reutiliza nem um nome igual", async () => {
    const spawnPaneFn = vi.fn(async () => ({ ok: true, paneId: "review" }));
    const { api, opts } = setup({ spawnPaneFn });
    opts.paneLabels.set("p1", "Revisar");
    expect((await api.spawnPane({ agent: "claude", label: "Revisar", reuseIdle: false })).paneId).toBe("review");
    expect(spawnPaneFn).toHaveBeenCalledWith(expect.objectContaining({ role: "worker" }));
  });

  it("não substitui a missão operacional ao registrar o pane aberto pelo main", async () => {
    const memoryStore = store();
    const spawnPaneFn = vi.fn(async () => ({ ok: true, paneId: "new", missionId: "mission_operational" }));
    const { api } = setup({ memoryStore, spawnPaneFn });
    await api.spawnPane({ agent: "kiro", missionId: "local-mission", parentPaneId: "pilot", reuseIdle: false });
    expect(memoryStore.actorRegister).toHaveBeenCalledWith(expect.objectContaining({
      paneId: "new", missionId: "mission_operational", role: "worker", parentPaneId: "pilot",
    }));
  });

  it("nome igual não reaproveita processo ocupado nem apaga seu nome", async () => {
    const spawnPaneFn = vi.fn(async () => ({ ok: true, paneId: "new" }));
    const { api, opts } = setup({ spawnPaneFn });
    opts.paneLabels.set("p1", "Implementar");
    expect((await api.spawnPane({ agent: "claude", label: "Implementar" })).paneId).toBe("new");
    expect(opts.paneLabels.get("p1")).toBe("Implementar");
  });
});
