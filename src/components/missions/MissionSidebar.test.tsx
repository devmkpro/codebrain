import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissionSidebar } from "./MissionSidebar";
import { useMissionsStore } from "../../stores/missions-store";
import { usePanesStore } from "../../stores/panes-store";

vi.mock("./MissionWizard", () => ({ MissionWizard: () => null }));
vi.mock("../../hooks/useSpawnPane", () => ({ useSpawnPane: () => ({ handleSpawnFromConfig: vi.fn() }) }));
vi.mock("../../lib/notify", () => ({ notify: vi.fn() }));

describe("fechamento de missão", () => {
  const workspacePath = "D:/app";
  beforeEach(() => {
    useMissionsStore.setState({ missionsByWorkspace: {}, activeMissionByWorkspace: {} });
    usePanesStore.setState({ panes: [], layouts: {}, activePaneId: null });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("encerra somente os terminais da missão confirmada e preserva o histórico", async () => {
    const store = useMissionsStore.getState();
    const missionId = store.createMission(workspacePath, { title: "Alvo", mode: "agentico" });
    const other = store.createMission(workspacePath, { title: "Outra" });
    const panes = usePanesStore.getState() as any;
    panes.addPane({ id: "target-pane", cwd: workspacePath, missionId });
    panes.addPane({ id: "other-pane", cwd: workspacePath, missionId: other });
    const kill = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("codeBrainApp", { pty: { kill } });
    render(<MissionSidebar workspacePath={workspacePath} />);
    fireEvent.click(screen.getByRole("button", { name: "Fechar Alvo" }));
    fireEvent.click(screen.getByRole("button", { name: "fechar missão" }));
    await waitFor(() => expect(store.getArchivedMissions(workspacePath)).toHaveLength(1));
    expect(kill).toHaveBeenCalledExactlyOnceWith("target-pane");
    expect((usePanesStore.getState() as any).panes.map((pane: any) => pane.id)).toEqual(["other-pane"]);
    expect(store.getWorkspaceMissions(workspacePath)).toHaveLength(2);
  });
});
