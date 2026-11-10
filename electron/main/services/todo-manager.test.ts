// @vitest-environment node
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearTasks, listTasks, watchTaskMutations } from "./todo-manager";

const require = createRequire(import.meta.url);
const { createMemoryStore } = require("../../../packages/memory/store.js");
const { createKanbanHandlers } = require("../../../packages/mcp/bridge/kanban-handlers.js");
let directory: string, a: string, b: string, store: any, ctx: any, bridge: any;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "codebrain-tasks-service-"));
  a = path.join(directory, "a");
  b = path.join(directory, "b");
  fs.mkdirSync(a);
  fs.mkdirSync(b);
  store = createMemoryStore(path.join(directory, "memory.sqlite"));
  store.createKanbanTask({ title: "legacy global" });
  ctx = {
    memoryStore: store,
    currentWorkspacePath: a,
    WORKSPACES_FILE: path.join(directory, "workspaces.json"),
    mainWindow: {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send: vi.fn() },
    },
  };
  fs.writeFileSync(ctx.WORKSPACES_FILE, JSON.stringify([a, b]));
  watchTaskMutations(ctx);
  bridge = createKanbanHandlers({
    memoryStore: store,
    getCurrentWorkspacePath: () => ctx.currentWorkspacePath,
  });
});
afterEach(() => {
  store?.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

it("reflects real MCP create, move, complete, delete and clear, then persists the result after reopening SQLite", async () => {
  const mission = store.createMission({ title: "Other project history", workspace: b });
  const foreign = await bridge.taskCreate({
    title: "B task",
    workspace: b,
    mission_id: mission.id,
  });
  const created = await bridge.taskCreate({ title: "A task", workspace: a });
  expect(listTasks(ctx, { workspace: a }).tasks.map((task) => task.id)).toEqual([created.id]);
  await bridge.taskMove({ id: created.id, column: "in_progress" });
  expect(listTasks(ctx, { workspace: a }).tasks[0].status).toBe("running");
  await bridge.taskComplete({ id: created.id, result: "done" });
  expect(listTasks(ctx, { workspace: a }).tasks[0].column).toBe("done");
  expect(
    clearTasks(ctx, { workspace: a, scope: "done", ids: [created.id, foreign.id] })
  ).toMatchObject({ ok: true, deleted: 1 });
  const disposable = await bridge.taskCreate({ title: "Delete through MCP", workspace: a });
  await bridge.taskDelete({ id: disposable.id });
  expect(listTasks(ctx, { workspace: a }).tasks).toEqual([]);
  store.close();
  store = createMemoryStore(path.join(directory, "memory.sqlite"));
  ctx.memoryStore = store;
  expect(listTasks(ctx, { workspace: a }).tasks).toEqual([]);
  expect(listTasks(ctx, { workspace: b }).tasks.map((task) => task.id)).toEqual([foreign.id]);
  expect(store.getMission({ id: mission.id }).mission.title).toBe("Other project history");
  expect(
    store.listKanbanTasks({ limit: -1 }).tasks.some((task: any) => task.title === "legacy global")
  ).toBe(true);
  expect(
    ctx.mainWindow.webContents.send.mock.calls.filter((call: any[]) => call[0] === "tasks:updated")
      .length
  ).toBeGreaterThanOrEqual(6);
});

it("never implicitly restricts the sidebar to one active mission", async () => {
  const first = store.createMission({ title: "First", workspace: a });
  const second = store.createMission({ title: "Second", workspace: a });
  const one = await bridge.taskCreate({ title: "one", workspace: a, mission_id: first.id });
  const two = await bridge.taskCreate({ title: "two", workspace: a, mission_id: second.id });
  expect(
    listTasks(ctx, { workspace: a })
      .tasks.map((task) => task.id)
      .sort()
  ).toEqual([one.id, two.id].sort());
  expect(
    listTasks(ctx, { workspace: a, mission_id: first.id }).tasks.map((task) => task.id)
  ).toEqual([one.id]);
});

it("hides removed or missing projects and unscoped rows without destroying database history", async () => {
  const removed = await bridge.taskCreate({ title: "keep after unlink", workspace: b });
  fs.writeFileSync(ctx.WORKSPACES_FILE, JSON.stringify([a]));
  expect(listTasks(ctx, { workspace: b }).tasks).toEqual([]);
  expect(clearTasks(ctx, { workspace: b, scope: "all", ids: [removed.id] }).ok).toBe(false);
  fs.rmdirSync(b);
  expect(listTasks(ctx, { workspace: b }).tasks).toEqual([]);
  expect(listTasks(ctx).tasks).toEqual([]);
  expect(store.listKanbanTasks({ limit: -1 }).tasks.map((task: any) => task.id)).toContain(
    removed.id
  );
});

it("clears only confirmed IDs and rechecks the done column, preserving tasks created after confirmation", async () => {
  const changed = await bridge.taskCreate({ title: "moved while confirming", workspace: a });
  await bridge.taskComplete({ id: changed.id });
  const selected = listTasks(ctx, { workspace: a }).tasks.map((task) => task.id);
  const newer = await bridge.taskCreate({ title: "new task", workspace: a });
  await bridge.taskMove({ id: changed.id, column: "in_progress" });
  expect(clearTasks(ctx, { workspace: a, scope: "done", ids: selected })).toMatchObject({
    ok: true,
    deleted: 0,
  });
  expect(clearTasks(ctx, { workspace: a, scope: "all", ids: selected })).toMatchObject({
    ok: true,
    deleted: 1,
  });
  expect(listTasks(ctx, { workspace: a }).tasks.map((task) => task.id)).toEqual([newer.id]);
});

it("inherits a mission workspace for an MCP create without a workspace and does not double-subscribe mutations", async () => {
  watchTaskMutations(ctx);
  const mission = store.createMission({ title: "B", workspace: b });
  const result = await bridge.taskCreate({ title: "mission-owned", mission_id: mission.id });
  expect(listTasks(ctx, { workspace: a }).tasks).toEqual([]);
  expect(listTasks(ctx, { workspace: b }).tasks[0].id).toBe(result.id);
  expect(ctx.mainWindow.webContents.send).toHaveBeenCalledTimes(1);
  expect(ctx.mainWindow.webContents.send).toHaveBeenCalledWith(
    "tasks:updated",
    expect.objectContaining({ workspace: b })
  );
});

it("emits one invalidation for a bulk cleanup rather than one per deleted task", async () => {
  const one = await bridge.taskCreate({ title: "one", workspace: a });
  const two = await bridge.taskCreate({ title: "two", workspace: a });
  ctx.mainWindow.webContents.send.mockClear();
  expect(clearTasks(ctx, { workspace: a, scope: "all", ids: [one.id, two.id] })).toMatchObject({
    ok: true,
    deleted: 2,
  });
  expect(ctx.mainWindow.webContents.send).toHaveBeenCalledTimes(1);
  expect(ctx.mainWindow.webContents.send).toHaveBeenCalledWith(
    "tasks:updated",
    expect.objectContaining({ workspace: a })
  );
});
