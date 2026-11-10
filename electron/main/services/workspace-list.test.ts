// @vitest-environment node
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readRecentWorkspaces, removeWorkspace, touchWorkspace } from "./workspace-list";

let directory: string;
let ctx: any;
let existing: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "codebrain-workspaces-"));
  existing = path.join(directory, "existing");
  fs.mkdirSync(existing);
  ctx = {
    WORKSPACES_FILE: path.join(directory, "workspaces.json"), currentWorkspacePath: existing,
    mainWindow: { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } },
  };
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

describe("workspace registry", () => {
  it("prunes missing paths and files, deduplicates existing directories", () => {
    const file = path.join(directory, "file.txt");
    fs.writeFileSync(file, "not a directory");
    fs.writeFileSync(ctx.WORKSPACES_FILE, JSON.stringify([existing, path.join(existing, "."), file, path.join(directory, "missing"), null]));
    expect(readRecentWorkspaces(ctx)).toEqual([existing]);
    expect(JSON.parse(fs.readFileSync(ctx.WORKSPACES_FILE, "utf-8"))).toEqual([existing]);
    expect(ctx.mainWindow.webContents.send).toHaveBeenCalledWith("operations:updated", expect.objectContaining({ workspaceListChanged: true }));
  });

  it("unlinks only the registry entry, leaving directories/history untouched", () => {
    const history = path.join(existing, "history.json");
    fs.writeFileSync(history, '{"mission":"kept"}');
    fs.writeFileSync(ctx.WORKSPACES_FILE, JSON.stringify([existing]));
    removeWorkspace(ctx, existing);
    expect(readRecentWorkspaces(ctx)).toEqual([]);
    expect(ctx.currentWorkspacePath).toBe("");
    expect(fs.readFileSync(history, "utf-8")).toBe('{"mission":"kept"}');
    expect(ctx.mainWindow.webContents.send).toHaveBeenCalledWith("operations:updated", expect.objectContaining({ workspaceListChanged: true }));
  });

  it("allows explicitly reopening an unlinked existing directory", () => {
    fs.writeFileSync(ctx.WORKSPACES_FILE, JSON.stringify([existing]));
    removeWorkspace(ctx, existing);
    touchWorkspace(ctx, existing);
    expect(readRecentWorkspaces(ctx)).toEqual([existing]);
  });

  it("does not register a nonexistent directory", () => {
    touchWorkspace(ctx, path.join(directory, "missing"));
    expect(readRecentWorkspaces(ctx)).toEqual([]);
    expect(ctx.mainWindow.webContents.send).not.toHaveBeenCalled();
  });

  it("does not report success when unlink cannot persist the registry", () => {
    ctx.WORKSPACES_FILE = path.join(directory, "missing-parent", "workspaces.json");
    expect(() => removeWorkspace(ctx, existing)).toThrow();
    expect(ctx.currentWorkspacePath).toBe(existing);
    expect(ctx.mainWindow.webContents.send).not.toHaveBeenCalled();
  });
});
