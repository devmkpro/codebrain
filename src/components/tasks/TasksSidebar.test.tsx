import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TasksSidebar } from "./TasksSidebar";
import { useTasksStore } from "../../stores/tasks-store";
import { useNavStore } from "../../stores/nav-store";

const select = (workspace: string | null) =>
  useNavStore.setState({
    tabs: workspace ? [{ workspacePath: workspace }] : [],
    activeTabIndex: 0,
    onHome: !workspace,
  } as any);
const task = (id: string, column = "inbox", workspacePath = "C:/a") => ({
  id,
  label: id,
  name: id,
  column,
  workspacePath,
  status: column === "done" ? "done" : "pending",
  createdAt: 1,
});
let rows: ReturnType<typeof task>[],
  paths: string[],
  update: (event: any) => void,
  registryUpdate: (event: any) => void;
let list: ReturnType<typeof vi.fn>, clear: ReturnType<typeof vi.fn>, off: ReturnType<typeof vi.fn>;
beforeEach(() => {
  rows = [task("A pending"), task("A done", "done"), task("B task", "inbox", "C:/b")];
  paths = ["C:/a", "C:/b"];
  select("C:/a");
  useTasksStore.setState({
    list: [],
    activeTaskId: null,
    workspace: null,
    available: false,
    visible: true,
    loading: false,
    clearing: false,
    error: null,
    actionError: null,
  });
  off = vi.fn();
  list = vi.fn(async ({ workspace }: { workspace: string }) => ({
    ok: true,
    workspace,
    tasks: rows.filter((row) => row.workspacePath === workspace),
  }));
  clear = vi.fn(
    async ({ workspace, scope, ids }: { workspace: string; scope: string; ids: string[] }) => {
      const previous = rows.length;
      rows = rows.filter(
        (row) =>
          !(
            row.workspacePath === workspace &&
            ids.includes(row.id) &&
            (scope === "all" || row.column === "done")
          )
      );
      update({ workspace, at: Date.now() });
      return { ok: true, deleted: previous - rows.length };
    }
  );
  vi.stubGlobal("codeBrainApp", {
    tasks: {
      list,
      clear,
      onUpdated: (callback: typeof update) => {
        update = callback;
        return off;
      },
    },
    workspaces: { recent: async () => paths },
    operations: {
      onUpdated: (callback: typeof registryUpdate) => {
        registryUpdate = callback;
        return vi.fn();
      },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("refreshes create/move/delete events and clears only confirmed completed task IDs before reloading", async () => {
  render(<TasksSidebar />);
  await screen.findByText("A pending");
  expect(screen.queryByText("B task")).toBeNull();
  rows.push(task("A created"));
  await act(async () => {
    update({ workspace: "C:/a" });
  });
  await screen.findByText("A created");
  rows = rows.map((row) => (row.id === "A created" ? { ...row, column: "done" } : row));
  await act(async () => {
    update({ workspace: "C:/a" });
  });
  fireEvent.click(screen.getByRole("button", { name: "limpar concluídas" }));
  expect(screen.getByRole("alertdialog").textContent).toContain("C:/a");
  expect(clear).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "confirmar limpeza" }));
  await waitFor(() => expect(screen.queryByText("A done")).toBeNull());
  expect(clear).toHaveBeenCalledWith({
    workspace: "C:/a",
    scope: "done",
    ids: ["A done", "A created"],
  });
  expect(rows.map((row) => row.id)).toEqual(["A pending", "B task"]);
  rows = rows.filter((row) => row.id !== "A pending");
  await act(async () => {
    update({ workspace: "C:/a" });
  });
  await waitFor(() => expect(screen.queryByText("A pending")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Atualizar tarefas" }));
  await screen.findByText(/Sem tarefas neste workspace/);
});

it("confirms an exact snapshot for all tasks, supports cancellation, and never includes another workspace", async () => {
  render(<TasksSidebar />);
  await screen.findByText("A pending");
  fireEvent.click(screen.getByRole("button", { name: "limpar todas" }));
  fireEvent.click(screen.getByRole("button", { name: "cancelar" }));
  expect(clear).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "limpar todas" }));
  rows.push(task("Arrived after confirmation"));
  await act(async () => {
    update({ workspace: "C:/a" });
  });
  fireEvent.click(screen.getByRole("button", { name: "confirmar limpeza" }));
  await screen.findByText("2 tarefa(s) removida(s).");
  expect(clear).toHaveBeenCalledWith({
    workspace: "C:/a",
    scope: "all",
    ids: ["A pending", "A done"],
  });
  expect(rows.map((row) => row.id)).toEqual(["B task", "Arrived after confirmation"]);
});

it("switches workspaces immediately and hides removed projects on registry invalidation or focus", async () => {
  render(<TasksSidebar />);
  await screen.findByText("A pending");
  act(() => select("C:/b"));
  expect(screen.queryByText("A pending")).toBeNull();
  await screen.findByText("B task");
  paths = ["C:/a"];
  await act(async () => {
    registryUpdate({ workspaceListChanged: true });
  });
  await screen.findByText("Workspace removido ou inexistente no registro.");
  expect(screen.queryByText("B task")).toBeNull();
  expect(rows.some((row) => row.id === "B task")).toBe(true);
  paths = ["C:/a", "C:/b"];
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  await screen.findByText("B task");
});

it("shows no global tasks without an active workspace and releases subscriptions on unmount", async () => {
  select(null);
  const { unmount } = render(<TasksSidebar />);
  await screen.findByText("Abra um workspace para ver as tarefas.");
  expect(list).not.toHaveBeenCalled();
  unmount();
  expect(off).toHaveBeenCalledOnce();
  act(() => select("C:/b"));
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(list).not.toHaveBeenCalled();
});

it("shows a failed cleanup and keeps its confirmation available for retry", async () => {
  clear.mockResolvedValue({ ok: false, error: "banco ocupado" });
  render(<TasksSidebar />);
  await screen.findByText("A pending");
  fireEvent.click(screen.getByRole("button", { name: "limpar todas" }));
  fireEvent.click(screen.getByRole("button", { name: "confirmar limpeza" }));
  await screen.findByText("banco ocupado");
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  expect(screen.getByText("A pending")).toBeTruthy();
});

it("does not display an old cleanup result in a different workspace", async () => {
  let complete!: (value: { ok: boolean; deleted: number }) => void;
  clear.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  render(<TasksSidebar />);
  await screen.findByText("A pending");
  fireEvent.click(screen.getByRole("button", { name: "limpar todas" }));
  fireEvent.click(screen.getByRole("button", { name: "confirmar limpeza" }));
  await waitFor(() => expect(clear).toHaveBeenCalledOnce());
  act(() => select("C:/b"));
  await screen.findByText("B task");
  await act(async () => {
    complete({ ok: true, deleted: 2 });
  });
  expect(screen.queryByText("2 tarefa(s) removida(s).")).toBeNull();
  expect(screen.getByText("B task")).toBeTruthy();
});
