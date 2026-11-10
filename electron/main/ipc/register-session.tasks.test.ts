// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { registerSessionHandlers } from "./register-session";

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>() }));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (name: string, callback: (...args: any[]) => any) => handlers.set(name, callback),
  },
  dialog: {},
}));
vi.mock("electron-log/main.js", () => ({ default: { error: vi.fn() } }));
let root: string | undefined;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
  handlers.clear();
});

it("does not fall back to the current project when tasks:list has no explicit workspace", async () => {
  root = mkdtempSync(join(tmpdir(), "codebrain-tasks-ipc-"));
  const list = vi
    .fn()
    .mockReturnValue({
      ok: true,
      tasks: [{ id: "old", title: "old", workspace: root, column_name: "inbox" }],
    });
  registerSessionHandlers({
    currentWorkspacePath: root,
    memoryStore: { listKanbanTasks: list },
  } as any);
  const response = await handlers.get("tasks:list")!(null);
  expect(response.tasks).toEqual([]);
  expect(list).not.toHaveBeenCalled();
});
