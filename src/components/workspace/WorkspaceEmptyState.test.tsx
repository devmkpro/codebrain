import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { usePaneLauncherStore } from "../../stores/pane-launcher-store";
import { useModalsStore } from "../../stores/modals-store";
import { useProvidersStore } from "../../stores/providers-store";
import { WorkspaceEmptyState } from "./WorkspaceEmptyState";

const configuredProviders = [
  { id: "claude-oauth", label: "Claude", models: ["claude-sonnet-4-6", "claude-opus-4-8"] },
  { id: "codex-oauth", label: "Codex", models: ["gpt-5.6-sol", "gpt-5.6-terra"] },
];

describe("WorkspaceEmptyState", () => {
  beforeEach(() => {
    usePaneLauncherStore.setState({ open: false });
    useModalsStore.setState({
      showSquadWizard: false,
      squadWizardPreset: null,
      showProviders: false,
    });
    useProvidersStore.setState({ providers: configuredProviders } as any);
  });
  afterEach(cleanup);

  it("shows only the terminal-first empty state and opens the pane launcher", () => {
    render(<WorkspaceEmptyState />);

    expect(screen.getByText("Nenhum agente aberto")).toBeTruthy();
    expect(screen.queryByText("Nenhuma missão ativa")).toBeNull();
    expect(screen.queryByText("Nenhuma sessão salva")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /pane/i }));
    expect(usePaneLauncherStore.getState().open).toBe(true);
  });

  it("opens the squad wizard pre-filled with Opus orchestrating Codex workers", () => {
    render(<WorkspaceEmptyState />);

    fireEvent.click(screen.getByRole("button", { name: /time/i }));

    const state = useModalsStore.getState();
    expect(state.showSquadWizard).toBe(true);
    expect(state.squadWizardPreset?.orchestrator).toEqual({
      providerId: "claude-oauth",
      model: "claude-opus-4-8",
    });
    expect(state.squadWizardPreset?.workers.length).toBeGreaterThan(0);
    for (const worker of state.squadWizardPreset!.workers) {
      expect(worker.providerId).toBe("codex-oauth");
      expect(worker.model).toBe("gpt-5.6-terra");
    }
  });

  it("sends the user to providers instead of an unusable wizard when none are configured", () => {
    useProvidersStore.setState({ providers: [] } as any);
    render(<WorkspaceEmptyState />);

    fireEvent.click(screen.getByRole("button", { name: /time/i }));

    expect(useModalsStore.getState().showSquadWizard).toBe(false);
    expect(useModalsStore.getState().showProviders).toBe(true);
  });
});
