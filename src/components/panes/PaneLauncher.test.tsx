import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePaneLauncherStore } from "../../stores/pane-launcher-store";
import { useProvidersStore } from "../../stores/providers-store";
import { useNavStore } from "../../stores/nav-store";
import { usePanesStore } from "../../stores/panes-store";
import { PaneLauncher } from "./PaneLauncher";

const openRouter = {
  id: "openrouter",
  label: "OpenRouter",
  host: "openclaude",
  models: [
    "anthropic/claude-opus-4",
    "anthropic/claude-sonnet-4",
    "google/gemini-2.5-pro",
    "meta-llama/llama-4-maverick",
    "x-ai/grok-4.3",
  ],
};
const codex = {
  id: "codex-oauth",
  label: "Codex",
  host: "codex",
  models: ["gpt-5.6-terra", "gpt-5.5"],
};

describe("PaneLauncher search", () => {
  beforeEach(() => {
    useProvidersStore.setState({ providers: [openRouter, codex], load: async () => {} } as any);
    useNavStore.setState({ tabs: [{ workspacePath: "C:/repo" }], activeTabIndex: 0 } as any);
    usePanesStore.setState({ panes: [], layouts: {}, activePaneId: null } as any);
    usePaneLauncherStore.setState({ open: true, request: null });
  });
  afterEach(cleanup);

  it("filters providers by a model they carry", () => {
    render(<PaneLauncher />);
    expect(screen.getAllByText("OpenRouter").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Codex").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Buscar provider"), { target: { value: "grok" } });

    expect(screen.getAllByText("OpenRouter").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Codex")).toHaveLength(0);
  });

  it("filters the model list once a provider is picked", () => {
    render(<PaneLauncher />);
    fireEvent.click(screen.getAllByText("OpenRouter")[0]);

    // Picking a provider clears the query so the full catalogue is visible.
    expect(screen.getByText("anthropic/claude-opus-4")).toBeTruthy();
    expect(screen.getByText("x-ai/grok-4.3")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Buscar modelo"), { target: { value: "claude opus" } });

    expect(screen.getByText("anthropic/claude-opus-4")).toBeTruthy();
    expect(screen.queryByText("anthropic/claude-sonnet-4")).toBeNull();
    expect(screen.queryByText("x-ai/grok-4.3")).toBeNull();
  });

  it("explains an empty result instead of showing a blank list", () => {
    render(<PaneLauncher />);
    fireEvent.click(screen.getAllByText("OpenRouter")[0]);
    fireEvent.change(screen.getByLabelText("Buscar modelo"), { target: { value: "mistral" } });

    expect(screen.getByText(/Nenhum modelo para/)).toBeTruthy();
  });

  it("sends the preparation prompt as part of spawn instead of racing a delayed write", async () => {
    const spawn = vi.fn(async () => ({
      ok: true,
      paneId: "pane-preparation",
      promptSubmitted: true,
    }));
    const write = vi.fn();
    Object.defineProperty(window, "codeBrainApp", {
      configurable: true,
      value: { pty: { spawn, write } },
    });
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: { getItem: vi.fn(() => null) },
    });
    usePaneLauncherStore.setState({
      open: true,
      request: {
        title: "Agente de preparação",
        initialPrompt: "Prepare o repositório agora.",
      },
    });

    render(<PaneLauncher />);
    fireEvent.click(screen.getAllByText("Codex")[0]);
    fireEvent.click(screen.getByText("gpt-5.6-terra"));

    await waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "C:/repo",
        initialPrompt: "Prepare o repositório agora.",
      })
    );
    expect(write).not.toHaveBeenCalled();
  });
});
