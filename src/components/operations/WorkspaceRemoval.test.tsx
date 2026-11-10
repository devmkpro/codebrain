import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspacesPage } from "../../views/home/WorkspacesPage";
import { useNavStore } from "../../stores/nav-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { usePanesStore } from "../../stores/panes-store";

beforeEach(() => {
  useNavStore.setState({ tabs: [{ workspacePath: "D:/removed", view: { kind: "workspace" } }, { workspacePath: "D:/existing", view: { kind: "workspace" } }], activeTabIndex: 0, onHome: true } as any);
  useWorkspaceStore.setState({ path: "D:/removed" } as any);
  usePanesStore.setState({ panes: [] });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("workspace unlink UI", () => {
  it("removes a project from registry and tabs, preserving other projects and panes", async () => {
    let paths = ["D:/removed", "D:/existing"];
    const remove = vi.fn(async (path) => { paths = paths.filter((item) => item !== path); return { ok: true }; });
    vi.stubGlobal("codeBrainApp", { workspaces: { recent: async () => paths, remove } });
    render(<WorkspacesPage />);
    await waitFor(() => expect(screen.getByText(/2 recentes/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Desvincular removed" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Desvincular removed" })).toBeNull());
    expect((useNavStore.getState() as any).tabs.map((tab) => tab.workspacePath)).toEqual(["D:/existing"]);
    expect((useWorkspaceStore.getState() as any).path).toBe("D:/existing");
    expect(paths).toEqual(["D:/existing"]);
    expect(screen.getByRole("button", { name: "Desvincular existing" })).toBeTruthy();
  });

  it("does not remove a tab or hide the project when persistence fails", async () => {
    vi.stubGlobal("codeBrainApp", { workspaces: { recent: async () => ["D:/removed", "D:/existing"], remove: async () => ({ ok: false, error: "write failed" }) } });
    render(<WorkspacesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Desvincular removed" }));
    await screen.findByText("write failed");
    expect((useNavStore.getState() as any).tabs).toHaveLength(2);
    expect((useWorkspaceStore.getState() as any).path).toBe("D:/removed");
  });

  it("unlinks the matching path even if tabs reorder while IPC is pending", async () => {
    let finish: (result: any) => void = () => {};
    let paths = ["D:/removed", "D:/existing"];
    vi.stubGlobal("codeBrainApp", { workspaces: { recent: async () => paths, remove: () => new Promise((resolve) => { finish = resolve; }) } });
    render(<WorkspacesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Desvincular removed" }));
    act(() => { (useNavStore.getState() as any).moveTab(0, 1); });
    paths = ["D:/existing"];
    await act(async () => { finish({ ok: true }); });
    await waitFor(() => expect((useNavStore.getState() as any).tabs).toHaveLength(1));
    expect((useNavStore.getState() as any).tabs[0].workspacePath).toBe("D:/existing");
  });
});
