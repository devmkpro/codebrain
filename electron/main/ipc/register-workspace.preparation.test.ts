// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { registerWorkspaceHandlers } from "./register-workspace";
import type { AppContext } from "../context";

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>() }));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler),
  },
  dialog: {},
}));
vi.mock("../services/workspace", () => ({
  readRecentWorkspaces: vi.fn(),
  saveRecentWorkspaces: vi.fn(),
  touchWorkspace: vi.fn(),
  writeContextFiles: vi.fn(),
}));

let root: string | undefined;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
  handlers.clear();
});

it("workspace:prepare produces a complete native fixture and workspace:preparation-status agrees", async () => {
  root = mkdtempSync(join(tmpdir(), "codebrain-ipc-preparation-"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "ipc-fixture",
      dependencies: { react: "*" },
      scripts: { test: "node --test" },
    })
  );
  registerWorkspaceHandlers({} as AppContext);
  const before = await handlers.get("workspace:preparation-status")!(null, root);
  expect(before.initialized).toBe(false);
  const result = await handlers.get("workspace:prepare")!(null, {
    workspace: root,
    createCommit: false,
  });
  expect(result).toMatchObject({ ok: true, initialized: true, missing: [] });
  expect(result.created).toContain(".codebrain/scripts/context.cjs");
  expect(result.files).toContain(".codebrain/skills/project-conventions/skill.json");
  const after = await handlers.get("workspace:preparation-status")!(null, root);
  expect(after).toMatchObject({ ok: true, initialized: true, missing: [] });
  expect(after.files).toEqual(result.files);
});
