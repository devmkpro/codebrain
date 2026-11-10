import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useNavStore } from "../../stores/nav-store";
import { usePaneLauncherStore } from "../../stores/pane-launcher-store";
import { RepositoryPreparation } from "./RepositoryPreparation";

const status = (workspace: string, initialized = false) => ({
  ok: true,
  initialized,
  workspace,
  stack: [],
  commands: [],
  skills: [],
  files: [],
  git: false,
});
const openPreparation = () =>
  act(() => {
    window.dispatchEvent(new CustomEvent("codebrain:prepare-repository"));
  });

beforeEach(() => {
  useNavStore.setState({
    tabs: [{ workspacePath: "C:/a" }, { workspacePath: "C:/b" }],
    activeTabIndex: 0,
    onHome: false,
  } as any);
  usePaneLauncherStore.setState({ open: false, request: null });
  Object.defineProperty(window, "codeBrainApp", {
    configurable: true,
    value: {
      workspace: {
        preparationStatus: vi.fn(async (ws: string) => status(ws)),
        prepare: vi.fn(async ({ workspace }: { workspace: string }) => ({
          ...status(workspace, true),
          created: [".codebrain/context.md"],
        })),
      },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("keeps manual preparation open across refreshes of an initialized repository", async () => {
  vi.useFakeTimers();
  vi.mocked(window.codeBrainApp.workspace.preparationStatus).mockImplementation(async (ws) =>
    status(ws, true)
  );
  render(<RepositoryPreparation workspacePath="C:/a" />);
  await act(async () => {});
  openPreparation();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(16000);
  });
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("opens only in the active workspace and does not leave a modal in inactive tabs", async () => {
  render(
    <>
      <RepositoryPreparation workspacePath="C:/a" />
      <RepositoryPreparation workspacePath="C:/b" />
    </>
  );
  await act(async () => {});
  openPreparation();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  act(() => useNavStore.setState({ activeTabIndex: 1 }));
  expect(screen.queryByRole("dialog")).toBeNull();
  openPreparation();
  fireEvent.click(screen.getByText("preparar localmente"));
  await screen.findByText(/Preparação concluída/);
  expect(window.codeBrainApp.workspace.prepare).toHaveBeenCalledWith({
    workspace: "C:/b",
    createCommit: false,
  });
  expect(usePaneLauncherStore.getState().open).toBe(false);
  act(() => useNavStore.setState({ activeTabIndex: 0 }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("allows manual preparation when the recommendation is hidden in files or map", async () => {
  render(<RepositoryPreparation workspacePath="C:/a" showRecommendation={false} />);
  await act(async () => {});
  expect(screen.queryByText("Preparar este repositório")).toBeNull();
  openPreparation();
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.click(screen.getByText("preparar localmente"));
  await screen.findByText(/Preparação concluída/);
  expect(window.codeBrainApp.workspace.prepare).toHaveBeenCalledWith({
    workspace: "C:/a",
    createCommit: false,
  });
  fireEvent.click(screen.getByText("aprofundar com agente"));
  expect(usePaneLauncherStore.getState().request?.initialPrompt).toContain("Workspace: C:/a");
  expect(usePaneLauncherStore.getState().request?.initialPrompt).toContain("skill.json");
});

it("confirms disk status when a preparation response still reports the previous incomplete state", async () => {
  vi.mocked(window.codeBrainApp.workspace.prepare).mockResolvedValue({
    ...status("C:/a"),
    created: [],
  });
  vi.mocked(window.codeBrainApp.workspace.preparationStatus)
    .mockResolvedValueOnce(status("C:/a"))
    .mockResolvedValue(status("C:/a", true));
  render(<RepositoryPreparation workspacePath="C:/a" />);
  await act(async () => {});
  openPreparation();
  fireEvent.click(screen.getByText("preparar localmente"));
  await screen.findByText(/Preparação concluída/);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("reports backend failures without success and keeps the error visible across polling", async () => {
  vi.useFakeTimers();
  vi.mocked(window.codeBrainApp.workspace.prepare).mockResolvedValue({
    ...status("C:/a"),
    ok: false,
    error: "skill.json inválido",
  });
  render(<RepositoryPreparation workspacePath="C:/a" />);
  await act(async () => {});
  openPreparation();
  fireEvent.click(screen.getByText("preparar localmente"));
  await act(async () => {});
  expect(screen.getByRole("alert").textContent).toContain("skill.json inválido");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(16000);
  });
  expect(screen.getByRole("alert").textContent).toContain("skill.json inválido");
  expect(screen.queryByText(/Preparação concluída/)).toBeNull();
});

it("ignores a status request started before the successful preparation", async () => {
  vi.useFakeTimers();
  let complete!: (value: ReturnType<typeof status>) => void;
  const old = new Promise<ReturnType<typeof status>>((resolve) => {
    complete = resolve;
  });
  vi.mocked(window.codeBrainApp.workspace.preparationStatus)
    .mockResolvedValueOnce(status("C:/a"))
    .mockImplementationOnce(() => old);
  render(<RepositoryPreparation workspacePath="C:/a" />);
  await act(async () => {});
  openPreparation();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(8000);
  });
  fireEvent.click(screen.getByText("preparar localmente"));
  await act(async () => {});
  await act(async () => {
    complete(status("C:/a"));
  });
  expect(screen.getByText("aprofundar com agente")).toBeTruthy();
  expect(screen.queryByText("preparar localmente")).toBeNull();
});

it("shows inspection errors in the manual dialog rather than disappearing", async () => {
  vi.mocked(window.codeBrainApp.workspace.preparationStatus).mockRejectedValue(
    new Error("sem acesso ao workspace")
  );
  render(<RepositoryPreparation workspacePath="C:/a" showRecommendation={false} />);
  await act(async () => {});
  openPreparation();
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("sem acesso ao workspace")
  );
});
