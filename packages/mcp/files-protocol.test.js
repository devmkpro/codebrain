// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { createCodebrainMCPServer } = require("./index.js");
const { createFileHandlers } = require("./bridge/file-handlers.js");
const { createMultiEditHandlers } = require("./bridge/multi-edit-handlers.js");
const opened = [], roots = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map(x => x.close()));
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-file-protocol-")); roots.push(root);
  const opts = { getCurrentWorkspacePath: () => root };
  const server = createCodebrainMCPServer({ ...createFileHandlers(opts), ...createMultiEditHandlers(opts) });
  const client = new Client({ name: "files-feedback-fixture", version: "1" });
  const [left, right] = InMemoryTransport.createLinkedPair(); opened.push(client, server);
  await server.connect(right); await client.connect(left);
  const call = (name, args) => client.callTool({ name: "tool_invoke", arguments: { name, arguments: args } });
  return { root, call };
}
const data = response => JSON.parse(response.content[0].text);
describe("file tool schemas and real MCP protocol", () => {
  it("round-trips a long UTF-8 quoted line without host truncation or lost characters", async () => {
    const { root, call } = await fixture();
    const original = ('"Ação😀"\\'.repeat(7000)) + "\r\nlast line\n";
    fs.writeFileSync(path.join(root, "large.tsx"), original);
    let combined = "", startLine = 1, startColumn = 1;
    for (let n = 0; n < 100; n++) {
      const response = await call("file_read", { path: "large.tsx", startLine, startColumn, maxChars: 6000 });
      expect(response.isError).not.toBe(true);
      expect(Buffer.byteLength(response.content[0].text)).toBeLessThanOrEqual(6000);
      const page = data(response); combined += page.content;
      if (page.nextLine === null) break;
      startLine = page.nextLine; startColumn = page.nextColumn;
      expect(page.content.length).toBeGreaterThan(0);
    }
    expect(combined).toBe(original);
  });
  it("forwards append, range, search options and reports invalid paths as MCP errors", async () => {
    const { root, call } = await fixture();
    await call("file_write", { path: "notes.txt", content: "First\n" });
    await call("file_write", { path: "notes.txt", content: "Second\n", append: true });
    expect(fs.readFileSync(path.join(root, "notes.txt"), "utf8")).toBe("First\nSecond\n");
    expect(data(await call("file_budgeted_read", { path: "notes.txt", startLine: 2, endLine: 2 })).content).toBe("Second\n");
    expect(data(await call("file_search", { path: "notes.txt", content: "second", caseSensitive: false })).results[0]).toMatchObject({ line: 2, snippet: "Second" });
    expect((await call("file_search", { path: "missing", content: "second" })).isError).toBe(true);
  });
  it("preserves all-or-nothing preflight and dryRun over the schema boundary", async () => {
    const { root, call } = await fixture(); const file = path.join(root, "source.txt"); fs.writeFileSync(file, "one\ntwo\n");
    const edit = { oldString: "one", newString: "changed" };
    const preview = data(await call("file_multi_edit", { files: [{ path: "source.txt", edits: [edit] }], dryRun: true, returnDiff: true }));
    expect(preview.dryRun).toBe(true); expect(preview.diff).toContain("changed");
    expect(fs.readFileSync(file, "utf8")).toBe("one\ntwo\n");
    const invalid = data(await call("file_multi_edit", { path: "source.txt", edits: [edit, { oldString: "absent", newString: "bad" }] }));
    expect(invalid).toMatchObject({ ok: false, applied: 0 });
    expect(fs.readFileSync(file, "utf8")).toBe("one\ntwo\n");
  });
});
