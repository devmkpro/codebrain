// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createMCPBridge } = require("./bridge.js");
let root;
beforeEach(() => {
  vi.useFakeTimers(); root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-feedback-memory-"));
  vi.spyOn(require("./bridge/request-logger.js"), "getRequestLogger").mockReturnValue({});
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
describe("automatic file memory workspace attribution", () => {
  it("resolves a relative filename from the workspace, not the Codebrain process cwd", async () => {
    const write = vi.fn(() => ({ ok: true }));
    const pty = Object.assign(new EventEmitter(), { list: () => [] });
    const bridge = createMCPBridge(pty, { dataDir: root, memoryStore: { write }, getCurrentWorkspacePath: () => root });
    expect((await bridge.fileWrite({ path: "src/Entry.tsx", content: "export {};", createDirs: true })).ok).toBe(true);
    expect(write).toHaveBeenCalledWith(expect.objectContaining({
      key: "file-changed-src/Entry.tsx", workspace: root,
      content: expect.stringContaining(path.join(root, "src", "Entry.tsx")),
    }));
  });
  it("does not copy credential-file bodies into automatic shared memories", async () => {
    const write = vi.fn(() => ({ ok: true }));
    const pty = Object.assign(new EventEmitter(), { list: () => [] });
    const bridge = createMCPBridge(pty, { dataDir: root, memoryStore: { write }, getCurrentWorkspacePath: () => root });
    await bridge.fileWrite({ path: ".env", content: "EXAMPLE_PASSWORD=synthetic-fixture-only", createDirs: true });
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0][0].content).not.toContain("synthetic-fixture-only");
  });
});
