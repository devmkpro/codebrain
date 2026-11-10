import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPilotSpawnConfig, modelsForCli, PILOT_INSTRUCTIONS, resolvePilotTarget, spawnPilot, validateAgenticDraft } from "./pilot";
import { useMissionsStore } from "../../stores/missions-store";
import { usePanesStore } from "../../stores/panes-store";

vi.mock("../../lib/notify", () => ({ notify: vi.fn() }));

const providers = [
  { id: "claude-oauth", type: "oauth", models: ["opus", "sonnet"] },
  { id: "or", host: "openclaude", models: ["gpt-5"], env: { KEY: "x" } },
];

describe("missão agêntica", () => {
  it("exige objetivo", () => {
    expect(validateAgenticDraft({ objective: "   " })).toMatch(/objetivo/);
    expect(validateAgenticDraft({ objective: "trocar o login" })).toBeNull();
  });

  it("monta o spawn com o contrato do piloto", () => {
    const config = buildPilotSpawnConfig({
      workspacePath: "D:/app",
      missionId: "m1",
      objective: "  trocar o login ",
      target: { agent: "claude", model: "opus" },
      permissionMode: "bypassPermissions",
    });
    expect(config).toMatchObject({
      agent: "claude",
      model: "opus",
      cwd: "D:/app",
      missionId: "m1",
      role: "orchestrator",
      label: "Piloto",
      allowedSkills: ["cb-pilot", "cb-evidence"],
    });
    expect(config.orchestratorInstructions).toBe(PILOT_INSTRUCTIONS);
    expect(config.initialPrompt).toContain(PILOT_INSTRUCTIONS);
    expect(config.initialPrompt).toMatch(/Objetivo da missão:\ntrocar o login$/);
    expect(PILOT_INSTRUCTIONS).toContain("handoff_submit");
    expect(PILOT_INSTRUCTIONS).toMatch(/cb-pilot/);
    expect(PILOT_INSTRUCTIONS).toMatch(/pane_spawn/);
  });

  it("casa a CLI com o provider certo", () => {
    expect(resolvePilotTarget({ agent: "claude", model: "opus" }, providers)).toMatchObject({ agent: "claude", providerId: "claude-oauth", model: "opus" });
    expect(resolvePilotTarget({ agent: "openclaude", model: "" }, providers)).toMatchObject({ providerId: "or", env: { KEY: "x" } });
  });

  it("CLI sem provider abre pelo próprio login", () => {
    expect(resolvePilotTarget({ agent: "kimi", model: "" }, providers)).toEqual({ agent: "kimi", providerId: undefined, model: undefined });
  });

  it("sem escolha, usa a preferência do app", () => {
    expect(resolvePilotTarget({ agent: "", model: "" }, providers, "openclaude").agent).toBe("openclaude");
  });

  it("lista modelos só da CLI escolhida", () => {
    expect(modelsForCli("claude", providers)).toEqual(["opus", "sonnet"]);
    expect(modelsForCli("kimi", providers)).toEqual([]);
  });

  it("a opção preferida não mistura os modelos de todas as CLIs", () => {
    expect(modelsForCli("", providers)).toEqual(["opus", "sonnet"]);
    expect(modelsForCli("", providers, "openclaude")).toEqual(["gpt-5"]);
  });

  it("casa o registro gemini com providers e preferências gemini-cli", () => {
    const gemini = [{ id: "gemini-cli", host: "gemini-cli", models: ["gemini-pro"] }];
    expect(modelsForCli("gemini", gemini)).toEqual(["gemini-pro"]);
    expect(resolvePilotTarget({ agent: "", model: "gemini-pro" }, gemini, "gemini-cli"))
      .toMatchObject({ agent: "gemini", providerId: "gemini-cli", model: "gemini-pro" });
  });

  it("providers antigos sem host continuam associados ao OpenClaude", () => {
    const legacy = [{ id: "legacy", type: "openai-compat", models: ["model"] }];
    expect(resolvePilotTarget({ agent: "openclaude", model: "model" }, legacy).providerId).toBe("legacy");
  });
});

describe("abertura do piloto", () => {
  const workspacePath = "D:/app";
  const panes = () => usePanesStore.getState() as any;
  let missionId: string;

  beforeEach(() => {
    window.localStorage?.clear();
    useMissionsStore.setState({ missionsByWorkspace: {}, activeMissionByWorkspace: {} });
    usePanesStore.setState({ panes: [], layouts: {}, activePaneId: null });
    missionId = useMissionsStore.getState().createMission(workspacePath, { mode: "agentico", objective: "corrigir login" });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reconcilia evento antecipado, layout, CLI resolvida e os dois IDs de missão", async () => {
    const spawn = vi.fn(async (_config: unknown) => {
      const other = useMissionsStore.getState().createMission(workspacePath, { title: "Outra" });
      panes().addPane({ id: "pilot", cwd: workspacePath, missionId: other });
      return { ok: true, paneId: "pilot", agent: "gemini-cli", model: "resolved", providerId: "gemini-cli", missionId: "mission_backend", promptSubmitted: true };
    });
    vi.stubGlobal("codeBrainApp", { pty: { spawn } });
    expect(await spawnPilot({ workspacePath, missionId, objective: "corrigir login", target: { agent: "gemini" } })).toBe(true);
    const mission = useMissionsStore.getState().getWorkspaceMissions(workspacePath).find(item => item.id === missionId);
    expect(mission).toMatchObject({ pilotPaneId: "pilot", operationalMissionId: "mission_backend", pilot: { agent: "gemini-cli", providerId: "gemini-cli", model: "resolved" } });
    expect(panes().panes).toHaveLength(1);
    expect(panes().panes[0]).toMatchObject({ missionId, agent: "gemini-cli", model: "resolved", title: "Piloto", role: "orchestrator", workspacePath });
    expect(panes().layouts[workspacePath][missionId]).toEqual({ kind: "leaf", paneId: "pilot" });
    expect(Object.keys(panes().layouts[workspacePath])).toEqual([missionId]);
    expect(spawn.mock.calls[0][0]).toMatchObject({ missionId });
    expect((spawn.mock.calls[0][0] as { initialPrompt: string }).initialPrompt).toMatch(/Objetivo da missão:\ncorrigir login$/);
  });

  it("marca missão bloqueada quando o CLI abre mas não recebe o objetivo", async () => {
    vi.stubGlobal("codeBrainApp", { pty: { spawn: vi.fn().mockResolvedValue({ ok: true, paneId: "pilot", promptSubmitted: false }) } });
    expect(await spawnPilot({ workspacePath, missionId, objective: "corrigir login", target: { agent: "kiro" } })).toBe(false);
    expect(useMissionsStore.getState().getWorkspaceMissions(workspacePath)[0]).toMatchObject({ status: "blocked", pilotPaneId: "pilot" });
    expect(panes().panes).toHaveLength(1);
  });

  it("reenvia a associação operacional persistida ao reabrir o piloto", async () => {
    useMissionsStore.getState().updateMission(workspacePath, missionId, { operationalMissionId: "mission_existing" });
    const spawn = vi.fn().mockResolvedValue({ ok: true, paneId: "pilot", missionId: "mission_existing", promptSubmitted: true });
    vi.stubGlobal("codeBrainApp", { pty: { spawn } });
    await spawnPilot({ workspacePath, missionId, objective: "corrigir login", target: { agent: "kiro" } });
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ missionId, uiMissionId: missionId, operationalMissionId: "mission_existing" }));
  });

  it("preserva a configuração para diagnóstico se o spawn falhar", async () => {
    useMissionsStore.getState().updateMission(workspacePath, missionId, { pilot: { agent: "kiro", model: "configured" } });
    vi.stubGlobal("codeBrainApp", { pty: { spawn: vi.fn().mockRejectedValue(new Error("CLI ausente")) } });
    expect(await spawnPilot({ workspacePath, missionId, objective: "corrigir login", target: { agent: "kiro", model: "configured" } })).toBe(false);
    expect(useMissionsStore.getState().getWorkspaceMissions(workspacePath)[0]).toMatchObject({ status: "blocked", pilot: { agent: "kiro", model: "configured" } });
    expect(panes().panes).toHaveLength(0);
  });
});
