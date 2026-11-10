import { beforeEach, describe, expect, it } from "vitest";
import { useMissionsStore } from "../../stores/missions-store";

describe("persistência de missões", () => {
  beforeEach(async () => {
    await useMissionsStore.persist.getOptions().storage?.removeItem("codebrain-missions");
    useMissionsStore.setState({ missionsByWorkspace: {}, activeMissionByWorkspace: {} });
  });

  it("arquivar a última missão mantém histórico e numeração ao criar a substituta", () => {
    const store = useMissionsStore.getState();
    const first = store.createMission("D:/app", { mode: "agentico", objective: "Objetivo" });
    store.archiveMission("D:/app", first);
    const missions = store.getWorkspaceMissions("D:/app");
    expect(missions).toHaveLength(2);
    expect(missions[0]).toMatchObject({ id: first, status: "archived", mode: "agentico", objective: "Objetivo" });
    expect(missions[1]).toMatchObject({ title: "Missão 2", status: "active" });
    expect(store.getActiveMissionId("D:/app")).toBe(missions[1].id);
    expect(store.getArchivedMissions("D:/app")).toHaveLength(1);
  });

  it("restaura o modo, objetivo, piloto e identidade operacional após reidratação", async () => {
    const store = useMissionsStore.getState();
    const id = store.createMission("D:/app", { mode: "agentico", objective: "  Objetivo  ", pilot: { agent: "kiro", model: "configured" } });
    store.updateMission("D:/app", id, { pilotPaneId: "pane-1", operationalMissionId: "mission_backend" });
    const storage = useMissionsStore.persist.getOptions().storage!;
    const saved = (await storage.getItem("codebrain-missions"))!;
    useMissionsStore.setState({ missionsByWorkspace: {}, activeMissionByWorkspace: {} });
    await storage.setItem("codebrain-missions", saved);
    await useMissionsStore.persist.rehydrate();
    expect(store.getWorkspaceMissions("D:/app")[0]).toMatchObject({ id, mode: "agentico", objective: "Objetivo", pilot: { agent: "kiro", model: "configured" }, pilotPaneId: "pane-1", operationalMissionId: "mission_backend" });
    expect(store.getActiveMissionId("D:/app")).toBe(id);
  });
});
