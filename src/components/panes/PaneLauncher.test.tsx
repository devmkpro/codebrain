import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("orders newest first using source dates without promoting an old default or calling model zero recommended", () => {
    const provider = {
      ...codex, models: ["auto", "gpt-5.9", "gpt-5.10", "gpt-4.1"],
      defaultModel: "gpt-5.9", recommendedModel: "gpt-5.9",
      modelsMetadata: [
        { id: "gpt-5.9", created: "2025-01-01" },
        { id: "gpt-4.1", created: "2026-01-01" },
        { id: "gpt-5.10", created: "2026-11-01" },
      ],
    };
    useProvidersStore.setState({ providers: [provider] } as any);
    render(<PaneLauncher />);
    fireEvent.click(screen.getAllByText("Codex")[0]);
    const modelLabels = () => screen.getAllByRole("button").map((button) => button.textContent).filter((text) => text === "auto" || text?.startsWith("gpt-"));
    expect(modelLabels()).toEqual(["gpt-5.10", "gpt-4.1", "gpt-5.9", "auto"]);
    expect(screen.queryByText(/recomendado pelo provider/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Buscar modelo"), { target: { value: "gpt" } });
    expect(modelLabels()).toEqual(["gpt-5.10", "gpt-4.1", "gpt-5.9"]);
    expect(provider.models).toEqual(["auto", "gpt-5.9", "gpt-5.10", "gpt-4.1"]);
  });

  it("uses numeric version order when release metadata is absent", () => {
    useProvidersStore.setState({ providers: [{ ...codex, models: ["gpt-5.9", "auto", "gpt-5.10"] }] } as any);
    render(<PaneLauncher />);
    fireEvent.click(screen.getAllByText("Codex")[0]);
    expect(screen.getAllByRole("button").map((button) => button.textContent).filter((text) => text === "auto" || text?.startsWith("gpt-")))
      .toEqual(["gpt-5.10", "gpt-5.9", "auto"]);
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

  it("resets model selection when a provider changes harness during a refresh", () => {
    useProvidersStore.setState({ providers: [codex] } as any);
    const { rerender } = render(<PaneLauncher />);
    fireEvent.click(screen.getAllByText("Codex")[0]);
    act(() => useProvidersStore.setState({ providers: [{ ...codex, host: "kiro", models: ["auto"] }] } as any));
    rerender(<PaneLauncher />);
    expect(screen.getByLabelText("Buscar provider")).toBeTruthy();
    expect(screen.queryByText("gpt-5.6-terra")).toBeNull();
  });

  it("explains an empty result instead of showing a blank list", () => {
    render(<PaneLauncher />);
    fireEvent.click(screen.getAllByText("OpenRouter")[0]);
    fireEvent.change(screen.getByLabelText("Buscar modelo"), { target: { value: "mistral" } });

    expect(screen.getByText(/Nenhum modelo para/)).toBeTruthy();
  });

  it("portals the dialog above its backdrop and closes with Escape", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const { container } = render(<PaneLauncher />);
    const dialog = screen.getByRole("dialog", { name: "Novo pane" });
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.className).toContain("z-10");
    expect(screen.getByRole("button", { name: "Fechar seletor" }).className).toContain("z-0");
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("keeps provider back inside the selector and the brand Home action closes it", () => {
    render(<PaneLauncher />);
    fireEvent.click(screen.getAllByText("Codex")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Voltar aos providers" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Buscar provider" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Codebrain — Início" }));
    expect((useNavStore.getState() as { onHome: boolean }).onHome).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
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
