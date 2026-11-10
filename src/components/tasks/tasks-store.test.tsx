import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useNavStore } from "../../stores/nav-store";
import { useTasksStore, subscribeTaskUpdates } from "../../stores/tasks-store";

const tasks = () => useTasksStore.getState() as any;
const select = (workspace: string | null) =>
  useNavStore.setState({
    tabs: workspace ? [{ workspacePath: workspace }] : [],
    activeTabIndex: 0,
    onHome: !workspace,
  } as any);
const item = (id: string, workspace = "C:/a") => ({
  id,
  label: id,
  name: id,
  column: "inbox",
  status: "pending",
  workspacePath: workspace,
  createdAt: 1,
});
let stop: (() => void) | undefined;
beforeEach(() => {
  select("C:/a");
  useTasksStore.setState({
    list: [],
    activeTaskId: null,
    workspace: null,
    available: false,
    visible: false,
    loading: false,
    clearing: false,
    error: null,
    actionError: null,
  });
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.unstubAllGlobals();
});

it("never queries global tasks without an active workspace", async () => {
  select(null);
  const list = vi.fn().mockResolvedValue({ tasks: [item("global")] });
  vi.stubGlobal("codeBrainApp", {
    tasks: { list },
    workspaces: { recent: vi.fn().mockResolvedValue(["C:/a"]) },
  });
  await tasks().load();
  expect(list).not.toHaveBeenCalled();
  expect(tasks().list).toEqual([]);
});

it("does not allow a slow previous workspace request to overwrite the selected workspace", async () => {
  let finish!: (value: unknown) => void;
  const old = new Promise((resolve) => {
    finish = resolve;
  });
  const list = vi
    .fn()
    .mockImplementation(({ workspace }: { workspace: string }) =>
      workspace === "C:/a"
        ? old
        : Promise.resolve({ ok: true, workspace, tasks: [item("b", workspace)] })
    );
  vi.stubGlobal("codeBrainApp", {
    tasks: { list },
    workspaces: { recent: vi.fn().mockResolvedValue(["C:/a", "C:/b"]) },
  });
  const first = tasks().load();
  await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  select("C:/b");
  await tasks().load();
  finish({ ok: true, workspace: "C:/a", tasks: [item("a")] });
  await first;
  expect(tasks().list.map((task: any) => task.id)).toEqual(["b"]);
});

it("uses update payloads as scoped invalidations instead of injecting another project's tasks", async () => {
  let updated!: (event: any) => void;
  const list = vi.fn().mockResolvedValue({ ok: true, workspace: "C:/a", tasks: [item("a")] });
  vi.stubGlobal("codeBrainApp", {
    tasks: {
      list,
      onUpdated: (callback: typeof updated) => {
        updated = callback;
        return vi.fn();
      },
    },
    workspaces: { recent: vi.fn().mockResolvedValue(["C:/a"]) },
  });
  await tasks().load();
  stop = subscribeTaskUpdates();
  updated({ workspace: "C:/b", tasks: [item("foreign", "C:/b")] });
  await Promise.resolve();
  expect(tasks().list.map((task: any) => task.id)).toEqual(["a"]);
});

it("refuses an old preload response that does not identify the requested workspace", async () => {
  vi.stubGlobal("codeBrainApp", {
    tasks: { list: vi.fn().mockResolvedValue({ tasks: [item("global")] }) },
    workspaces: { recent: vi.fn().mockResolvedValue(["C:/a"]) },
  });
  await tasks().load();
  expect(tasks().list).toEqual([]);
  expect(tasks().error).toMatch(/não confirmou o workspace/);
});

it("does not let a response in flight revive tasks after the project is unlinked", async () => {
  let finish!: (value: unknown) => void;
  const old = new Promise((resolve) => {
    finish = resolve;
  });
  const list = vi.fn().mockReturnValue(old);
  const recent = vi.fn().mockResolvedValue(["C:/a"]);
  vi.stubGlobal("codeBrainApp", { tasks: { list }, workspaces: { recent } });
  const first = tasks().load();
  await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());
  recent.mockResolvedValue([]);
  await tasks().load();
  finish({ ok: true, workspace: "C:/a", tasks: [item("removed")] });
  await first;
  expect(tasks().list).toEqual([]);
  expect(tasks().available).toBe(false);
});
