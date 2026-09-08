import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { usePaneLauncherStore } from "../../stores/pane-launcher-store";
import { useProvidersStore } from "../../stores/providers-store";
import { useNavStore } from "../../stores/nav-store";
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
});
