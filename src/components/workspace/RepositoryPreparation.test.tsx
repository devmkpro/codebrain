import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useNavStore } from "../../stores/nav-store";
import { usePaneLauncherStore } from "../../stores/pane-launcher-store";
import { RepositoryPreparation } from "./RepositoryPreparation";

const status = (workspace: string, initialized = false) => ({ ok: true, initialized, workspace, stack: [], commands: [], skills: [], files: [], git: false });
const openPreparation = () => act(() => { window.dispatchEvent(new CustomEvent("codebrain:prepare-repository")); });

beforeEach(() => {
  useNavStore.setState({ tabs: [{ workspacePath: "C:/a" }, { workspacePath: "C:/b" }], activeTabIndex: 0, onHome: false } as any);
  usePaneLauncherStore.setState({ open: false, request: null });
  Object.defineProperty(window, "codeBrainApp", { configurable: true, value: { workspace: { preparationStatus: vi.fn(async (ws: string) => status(ws)) } } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("keeps manual preparation open across refreshes of an initialized repository", async () => {
  vi.useFakeTimers();
  vi.mocked(window.codeBrainApp.workspace.preparationStatus).mockImplementation(async (ws) => status(ws, true));
  render(<RepositoryPreparation workspacePath="C:/a" />);
  await act(async () => {});
  openPreparation();
  await act(async () => { await vi.advanceTimersByTimeAsync(16000); });
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("opens only in the active workspace and does not leave a modal in inactive tabs", async () => {
  render(<><RepositoryPreparation workspacePath="C:/a" /><RepositoryPreparation workspacePath="C:/b" /></>);
  await act(async () => {});
  openPreparation();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  act(() => useNavStore.setState({ activeTabIndex: 1 }));
  expect(screen.queryByRole("dialog")).toBeNull();
  openPreparation();
  fireEvent.click(screen.getByText("escolher provider e iniciar"));
  expect(usePaneLauncherStore.getState().request?.initialPrompt).toContain("Workspace: C:/b");
  act(() => useNavStore.setState({ activeTabIndex: 0 }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("allows manual preparation when the recommendation is hidden in files or map", async () => {
  render(<RepositoryPreparation workspacePath="C:/a" showRecommendation={false} />);
  await act(async () => {});
  expect(screen.queryByText("Preparar este repositório")).toBeNull();
  openPreparation();
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.click(screen.getByText("escolher provider e iniciar"));
  expect(usePaneLauncherStore.getState().request?.initialPrompt).toContain("Workspace: C:/a");
});
