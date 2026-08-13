import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { usePaneLauncherStore } from "../../stores/pane-launcher-store";
import { WorkspaceEmptyState } from "./WorkspaceEmptyState";

describe("WorkspaceEmptyState", () => {
  beforeEach(() => usePaneLauncherStore.setState({ open: false }));
  afterEach(cleanup);

  it("shows only the terminal-first empty state and opens the pane launcher", () => {
    render(<WorkspaceEmptyState />);

    expect(screen.getByText("Nenhum agente aberto")).toBeTruthy();
    expect(screen.queryByText("Nenhuma missão ativa")).toBeNull();
    expect(screen.queryByText("Nenhuma sessão salva")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /pane/i }));
    expect(usePaneLauncherStore.getState().open).toBe(true);
  });
});
