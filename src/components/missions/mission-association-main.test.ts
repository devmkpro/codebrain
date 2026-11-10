// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const { send, handlers } = vi.hoisted(() => ({ send: vi.fn(), handlers: new Map<string, (...args: any[]) => any>() }));
vi.mock("../../../electron/main/context", () => ({ safeSend: send }));
vi.mock("../../../electron/main/pty-manager", () => ({ resolveCommand: () => ({ unavailable: false, binary: process.platform === "win32" ? "C:\\Windows\\System32\\cmd.exe" : "/bin/sh", args: [] }) }));
vi.mock("../../../electron/main/window", () => ({ createDetachedPaneWindow: vi.fn() }));
vi.mock("electron", () => ({ ipcMain: { handle: (name: string, fn: (...args: any[]) => any) => handlers.set(name, fn) }, BrowserWindow: {} }));
vi.mock("electron-log/main.js", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../../electron/main/services/spawn/provider-resolver", () => ({ resolveProvider: (_ctx: unknown, config: any) => ({ agent: config.agent || "shell", provider: null, providerId: null, model: config.model }) }));

// Importação em runtime: este teste Node permanece no escopo autorizado sem
// incorporar o processo main ao projeto TypeScript do renderer.
const spawnPath = "../../../electron/main/services/pane-spawn";
const ipcPath = "../../../electron/main/ipc/register-pane";
const { resolvePaneMission, paneMissionMetadata, spawnPaneInternal } = await import(spawnPath);
const { registerPaneHandlers } = await import(ipcPath);

function context(saved: Record<string, unknown> = {}) {
  let config = saved;
  let nextMission = 0;
  const actors = new Map<string, any>();
  return {
    currentWorkspacePath: "D:/unrelated",
    paneConfigs: new Map<string, any>(),
    missionAssociations: new Map<string, string>(),
    paneRegistry: new Map(),
    providerHealth: new Map(),
    detachedPaneIds: new Set(),
    configStore: { get: () => config, set: vi.fn(patch => { config = { ...config, ...patch }; }) },
    memoryStore: {
      createMission: vi.fn(() => ({ ok: true, id: `mission_${++nextMission}` })),
      resolveActiveMission: vi.fn(() => ({ mission: { id: "mission_foreign" } })),
      actorRegister: vi.fn(actor => { actors.set(actor.paneId, actor); return { ok: true }; }),
      getActorRole: vi.fn(({ paneId }) => actors.has(paneId) ? { ok: true, ...actors.get(paneId) } : { ok: false }),
      actorGet: vi.fn(({ paneId }) => ({ actor: actors.get(paneId) })),
    },
    ptyManager: {
      spawn: vi.fn(async ({ paneId }) => paneId),
      submitWhenReady: vi.fn(async (_paneId: string, _prompt: string) => ({ ok: true, waitedMs: 0, promptSubmitted: true, deliveryState: "submitted" })),
      list: vi.fn(() => []),
    },
    hooksManager: { runPreSpawnHooks: vi.fn(async () => {}), fire: vi.fn() },
  };
}

beforeEach(() => { send.mockReset(); handlers.clear(); });

describe("associação operacional de missões", () => {
  it("cria uma missão para um brief explícito mesmo sem parent ou missão de UI", () => {
    const ctx = context();
    ctx.memoryStore.resolveActiveMission.mockReturnValue({ mission: null });
    expect(resolvePaneMission(ctx, { agent: "kiro", spawnBrief: "Corrigir somente perfil" }, "D:/app"))
      .toMatchObject({ operationalMissionId: "mission_1" });
    expect(ctx.memoryStore.createMission).toHaveBeenCalledWith(expect.objectContaining({ workspace: "D:/app" }));
  });

  it("cria associações distintas no mesmo workspace e reutiliza a mesma após reinício", () => {
    const ctx = context();
    const first = resolvePaneMission(ctx, { missionId: "ui-a", role: "orchestrator" }, "D:/app");
    const second = resolvePaneMission(ctx, { missionId: "ui-b", role: "orchestrator" }, "D:/app");
    expect(first).toEqual({ uiMissionId: "ui-a", operationalMissionId: "mission_1" });
    expect(second).toEqual({ uiMissionId: "ui-b", operationalMissionId: "mission_2" });
    expect(resolvePaneMission(ctx, { missionId: "ui-a" }, "D:/app")).toEqual(first);
    expect(ctx.memoryStore.createMission).toHaveBeenCalledTimes(2);
    expect(ctx.memoryStore.resolveActiveMission).not.toHaveBeenCalled();
    const restarted = context(ctx.configStore.get());
    expect(resolvePaneMission(restarted, { missionId: "ui-a" }, "D:/app")).toEqual(first);
    expect(restarted.memoryStore.createMission).not.toHaveBeenCalled();
  });

  it("separa o mesmo ID local em workspaces distintos e recusa reutilização operacional cruzada", () => {
    const ctx = context();
    resolvePaneMission(ctx, { missionId: "ui-a" }, "D:/one");
    expect(resolvePaneMission(ctx, { missionId: "ui-a" }, "D:/two").operationalMissionId).toBe("mission_2");
    expect(() => resolvePaneMission(ctx, { uiMissionId: "ui-b", operationalMissionId: "mission_1" }, "D:/one")).toThrow(/outra missão da interface/);
  });

  it("herda o pai, inclusive só pelo ator persistido, sem usar a missão ativa", () => {
    const ctx = context();
    const binding = resolvePaneMission(ctx, { missionId: "ui-a" }, "D:/app");
    ctx.paneConfigs.set("pilot", { missionId: binding.operationalMissionId, uiMissionId: "ui-a", workspacePath: "D:/app", cwd: "D:/app" });
    expect(resolvePaneMission(ctx, { parentPaneId: "pilot" }, "D:/app")).toEqual(binding);
    ctx.memoryStore.actorRegister({ paneId: "persisted", missionId: binding.operationalMissionId });
    expect(resolvePaneMission(ctx, { parentPaneId: "persisted" }, "D:/app")).toEqual(binding);
    expect(ctx.memoryStore.resolveActiveMission).not.toHaveBeenCalled();
  });

  it("publica os dois IDs e registra o ator antes de entregar o prompt", async () => {
    const ctx = context();
    ctx.ptyManager.submitWhenReady.mockImplementation(async () => {
      expect(ctx.paneConfigs.get("pilot")).toMatchObject({ missionId: "mission_1", uiMissionId: "ui-a", allowedSkills: ["cb-pilot"], parentPaneId: undefined });
      expect(ctx.memoryStore.getActorRole({ paneId: "pilot" })).toMatchObject({ missionId: "mission_1", role: "orchestrator" });
      expect(send).toHaveBeenCalledWith(ctx, "pane:added", expect.objectContaining({ missionId: "ui-a", uiMissionId: "ui-a", operationalMissionId: "mission_1", workspacePath: "D:/app" }));
      return { ok: true, waitedMs: 0, promptSubmitted: true, deliveryState: "submitted" };
    });
    const result = await spawnPaneInternal(ctx, { paneId: "pilot", agent: "shell", cwd: "D:/app", uiMissionId: "ui-a", role: "orchestrator", initialPrompt: "objetivo", allowedSkills: ["cb-pilot"] });
    expect(result).toMatchObject({ ok: true, missionId: "mission_1", uiMissionId: "ui-a", operationalMissionId: "mission_1", promptSubmitted: true });
    expect(ctx.ptyManager.submitWhenReady).toHaveBeenCalledOnce();
  });

  it("spawna helper em worktree no workspace do pai com a associação herdada", async () => {
    const ctx = context();
    resolvePaneMission(ctx, { missionId: "ui-a" }, "D:/app");
    ctx.paneConfigs.set("pilot", { missionId: "mission_1", uiMissionId: "ui-a", workspacePath: "D:/app", cwd: "D:/app" });
    const result = await spawnPaneInternal(ctx, { paneId: "helper", agent: "shell", cwd: "D:/worktree", parentPaneId: "pilot" });
    expect(result).toMatchObject({ ok: true, missionId: "mission_1", uiMissionId: "ui-a" });
    expect(ctx.paneConfigs.get("helper")).toMatchObject({ missionId: "mission_1", uiMissionId: "ui-a", workspacePath: "D:/app", cwd: "D:/worktree", parentPaneId: "pilot" });
    expect(ctx.memoryStore.actorRegister).toHaveBeenCalledWith(expect.objectContaining({ paneId: "helper", workspace: "D:/app", missionId: "mission_1" }));
  });

  it("pty:list publica UI e operacional separadamente e preserva todos os metadados", async () => {
    const ctx = context();
    resolvePaneMission(ctx, { missionId: "ui-a" }, "D:/app");
    ctx.paneConfigs.set("helper", { missionId: "mission_1", uiMissionId: "ui-a", workspacePath: "D:/app", cwd: "D:/worktree", role: "worker", label: "Corrigir login", taskType: "backend", effort: "high", accountId: "account", accountLabel: "Conta", allowedSkills: ["cb-worker"], parentPaneId: "pilot" });
    ctx.ptyManager.list.mockReturnValue([{ paneId: "helper", agent: "shell", cwd: "D:/worktree" }] as never);
    registerPaneHandlers(ctx);
    const result = await handlers.get("pty:list")!();
    expect(result.panes[0]).toMatchObject({ missionId: "ui-a", uiMissionId: "ui-a", operationalMissionId: "mission_1", mission_id: "mission_1", workspacePath: "D:/app", parentPaneId: "pilot", label: "Corrigir login", accountId: "account", allowedSkills: ["cb-worker"] });
    expect(paneMissionMetadata(ctx, "helper").missionId).toBe("ui-a");
  });

  it("pane:getRole devolve o ID operacional camelCase do store", async () => {
    const ctx = context();
    ctx.memoryStore.actorRegister({ paneId: "helper", role: "worker", missionId: "mission_1" });
    registerPaneHandlers(ctx);
    expect(await handlers.get("pane:getRole")!(null, "helper")).toMatchObject({ role: "worker", missionId: "mission_1" });
  });

  it("integra o host Codebrain numa CLI sem system prompt, sem turno de bootstrap", async () => {
    const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-spawn-adapter-test-"));
    vi.stubEnv("HOME", taskDir);
    vi.stubEnv("USERPROFILE", taskDir);
    try {
      const workspace = path.join(taskDir, "project");
      fs.mkdirSync(path.join(workspace, ".codebrain", "agents"), { recursive: true });
      fs.writeFileSync(path.join(workspace, ".codebrain", "context.md"), "CONTEXT_FROM_CODEBRAIN");
      fs.writeFileSync(path.join(workspace, ".codebrain", "agents", "reviewer.md"), "---\nname: reviewer\n---\n\nREVIEWER_PERSONA");
      const ctx = context();
      const result = await spawnPaneInternal(ctx, { paneId: "muse-pane", cwd: workspace, agent: "muse", agentName: "reviewer", allowedSkills: [], permissionMode: "default", initialPrompt: "REAL_USER_TASK" });
      expect(result).toMatchObject({ ok: true, codebrainContext: expect.stringContaining("REVIEWER_PERSONA"), codebrainCatalogPath: expect.any(String) });
      const prompt = ctx.ptyManager.submitWhenReady.mock.calls[0][1];
      expect(prompt).toContain("CONTEXT_FROM_CODEBRAIN");
      expect(prompt).toContain("REAL_USER_TASK");
      expect(prompt).toContain("Only these skills are authorized for this pane: []");
      expect(ctx.ptyManager.submitWhenReady).toHaveBeenCalledOnce();
      expect(ctx.paneConfigs.get("muse-pane")).toMatchObject({ agentName: "reviewer", allowedSkills: [], codebrainCatalogPath: result.codebrainCatalogPath });
      const later = context();
      const deferred = await spawnPaneInternal(later, { paneId: "deferred", cwd: workspace, agent: "muse", allowedSkills: [], permissionMode: "default" });
      expect(deferred.codebrainContext).toContain("Codebrain host adapter");
      expect(later.ptyManager.submitWhenReady).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      if (path.dirname(path.resolve(taskDir)) !== path.resolve(os.tmpdir())) throw new Error("Unexpected test cleanup target");
      fs.rmSync(taskDir, { recursive: true, force: true });
    }
  });
});
