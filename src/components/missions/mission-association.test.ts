import { beforeEach, describe, expect, it } from "vitest";
import { ingestMissionPane } from "./mission-association";
import { useMissionsStore } from "../../stores/missions-store";
import { usePanesStore } from "../../stores/panes-store";

const workspace = "D:/App";
const panes = () => usePanesStore.getState() as any;

beforeEach(() => {
  useMissionsStore.setState({ missionsByWorkspace: {}, activeMissionByWorkspace: {} });
  usePanesStore.setState({ panes: [], layouts: {}, activePaneId: null });
});

describe("associação de panes no renderer", () => {
  it("publica a associação do piloto e recebe um helper antes da resposta do spawn", () => {
    const store = useMissionsStore.getState();
    const id = store.createMission(workspace, { mode: "agentico", objective: "Login" });
    ingestMissionPane({ paneId: "pilot", agent: "kiro", model: "chosen", cwd: workspace, missionId: id, uiMissionId: id, operationalMissionId: "mission_backend", role: "orchestrator" });
    expect(store.getWorkspaceMissions(workspace)[0]).toMatchObject({ operationalMissionId: "mission_backend", pilotPaneId: "pilot", pilot: { agent: "kiro", model: "chosen" } });
    const other = store.createMission(workspace, { title: "Outra" });
    ingestMissionPane({ paneId: "helper", cwd: "D:/worktree", workspacePath: "d:\\app\\", missionId: "mission_backend", parentPaneId: "pilot", label: "Corrigir login", role: "worker" });
    expect(panes().panes.find((pane: any) => pane.id === "helper")).toMatchObject({ missionId: id, operationalMissionId: "mission_backend", workspacePath: workspace, cwd: "D:/worktree", parentPaneId: "pilot", label: "Corrigir login" });
    expect(store.getActiveMissionId(workspace)).toBe(other);
    expect(panes().layouts[workspace]["mission_backend"]).toBeUndefined();
    // O bridge pode repetir pane:added só com metadados, sem a associação.
    ingestMissionPane({ paneId: "helper", cwd: "D:/worktree", label: "Corrigir login" });
    expect(panes().panes.find((pane: any) => pane.id === "helper")).toMatchObject({ missionId: id, operationalMissionId: "mission_backend", workspacePath: workspace });
  });

  it("reconcilia mission_id legado e move pane já existente sem duplicar", () => {
    const store = useMissionsStore.getState();
    const id = store.createMission(workspace, { mode: "agentico", operationalMissionId: "mission_backend" });
    const other = store.createMission(workspace, { title: "Outra" });
    panes().addPane({ id: "helper", cwd: workspace, missionId: other });
    ingestMissionPane({ paneId: "helper", cwd: workspace, mission_id: "mission_backend", label: "Corrigir login", effort: "high", accountLabel: "Conta", role: "worker" });
    expect(panes().panes).toHaveLength(1);
    expect(panes().panes[0]).toMatchObject({ missionId: id, label: "Corrigir login", effort: "high", accountLabel: "Conta" });
    expect(panes().layouts[workspace][other]).toBeUndefined();
    expect(panes().layouts[workspace][id]).toEqual({ kind: "leaf", paneId: "helper" });
  });

  it("não associa uma missão operacional desconhecida à missão ativa", () => {
    const store = useMissionsStore.getState();
    const current = store.createMission(workspace, { title: "Atual", operationalMissionId: "mission_current" });
    ingestMissionPane({ paneId: "helper", cwd: workspace, missionId: "mission_other" });
    const mission = store.getWorkspaceMissions(workspace).find(item => item.operationalMissionId === "mission_other")!;
    expect(mission.id).not.toBe(current);
    expect(panes().panes[0].missionId).toBe(mission.id);
    expect(store.getActiveMissionId(workspace)).toBe(current);
    ingestMissionPane({ paneId: "helper", cwd: workspace, operationalMissionId: "mission_other" });
    expect(store.getWorkspaceMissions(workspace)).toHaveLength(2);
  });
});
