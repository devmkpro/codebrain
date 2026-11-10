import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissionWizard } from "./MissionWizard";
import { spawnPilot } from "./pilot";
import { useMissionsStore } from "../../stores/missions-store";
import { useProvidersStore } from "../../stores/providers-store";

vi.mock("./pilot", async importOriginal => ({ ...await importOriginal<typeof import("./pilot")>(), spawnPilot: vi.fn().mockResolvedValue(true) }));

describe("criação de missão agêntica", () => {
  beforeEach(() => {
    useMissionsStore.setState({ missionsByWorkspace: {}, activeMissionByWorkspace: {} });
    (useProvidersStore.getState() as any).setProviders([
      { id: "claude-oauth", host: "claude", models: ["opus"] },
      { id: "kiro-account", host: "kiro", models: ["kiro-model"] },
    ]);
    vi.stubGlobal("codeBrainApp", { cli: { registry: vi.fn().mockResolvedValue([
      { id: "claude", label: "Claude Code", found: true, verified: true, capabilities: { model: true } },
      { id: "kiro", label: "Kiro CLI", found: true, verified: true, capabilities: { model: true } },
    ]) } });
    vi.mocked(spawnPilot).mockClear();
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("exige objetivo e persiste a CLI/modelo escolhidos antes de abrir o piloto", async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(<MissionWizard open workspacePath="D:/app" initialMode="agentico" onClose={onClose} onCreated={onCreated} />);
    expect(screen.getByRole("radio", { name: /Agêntico/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "próximo" }));
    expect((screen.getByRole("button", { name: "próximo" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Objetivo"), { target: { value: "  corrigir login  " } });
    await screen.findByRole("option", { name: /^Kiro CLI/ });
    fireEvent.change(screen.getByLabelText("CLI do piloto"), { target: { value: "kiro" } });
    fireEvent.change(screen.getByLabelText("Modelo do piloto"), { target: { value: "kiro-model" } });
    fireEvent.click(screen.getByRole("button", { name: "próximo" }));
    expect(screen.getByText("Kiro CLI · kiro-model")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "criar e abrir o piloto" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    const mission = useMissionsStore.getState().getWorkspaceMissions("D:/app")[0];
    expect(mission).toMatchObject({ mode: "agentico", objective: "corrigir login", pilot: { agent: "kiro", providerId: "kiro-account", model: "kiro-model" } });
    expect(spawnPilot).toHaveBeenCalledWith(expect.objectContaining({ missionId: mission.id, target: expect.objectContaining({ agent: "kiro", providerId: "kiro-account", model: "kiro-model" }) }));
    expect(onCreated).toHaveBeenCalledWith(mission.id, "agentico", undefined);
  });
});
