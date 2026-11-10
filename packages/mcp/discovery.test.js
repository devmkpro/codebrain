// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createCodebrainMCPServer } = require("./index.js");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const opened = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(x => x.close())); vi.restoreAllMocks(); });
async function connect(bridge = {}) {
  const server = createCodebrainMCPServer(bridge);
  const client = new Client({ name: "cached-catalog-fixture", version: "1" });
  const [left, right] = InMemoryTransport.createLinkedPair();
  opened.push(client, server);
  await server.connect(right);
  await client.connect(left);
  return { server, client };
}
const value = result => JSON.parse(result.content[0].text);
describe("compact tool discovery for clients caching tools/list", () => {
  it("lists exact coordination names without loading every tool schema", async () => {
    const { client } = await connect();
    const result = value(await client.callTool({ name: "enable_tool_group", arguments: { group: "coordination" } }));
    expect(result.tools).toContain("handoff_submit");
    expect(result.tools).toContain("mission_context");
    expect(result.next).toContain("tool_invoke");
    expect(JSON.stringify(result).length).toBeLessThan(7000);
  });
  it("describes and invokes a single deferred tool through the original validated handler", async () => {
    const memoryRead = vi.fn(async args => ({ ok: true, memory: { id: args.id } }));
    const { client } = await connect({ memoryRead });
    const catalog = await client.listTools();
    expect(catalog.tools.some(x => x.name === "tool_invoke")).toBe(true);
    expect(catalog.tools.some(x => x.name === "memory_read")).toBe(false);
    const schema = value(await client.callTool({ name: "tool_invoke", arguments: { name: "memory_read", describeOnly: true } }));
    expect(schema.inputSchema.properties.id).toBeDefined();
    expect(memoryRead).not.toHaveBeenCalled();
    const result = await client.callTool({ name: "tool_invoke", arguments: { name: "codebrain::memory_read", arguments: { id: "fixture-id" } } });
    expect(value(result).memory.id).toBe("fixture-id");
    const invalid = await client.callTool({ name: "tool_invoke", arguments: { name: "memory_read", arguments: { id: 42 } } });
    expect(invalid.isError).toBe(true);
    expect(memoryRead).toHaveBeenCalledTimes(1);
  });
  it("rejects recursion, unknown names and prototype properties", async () => {
    const { client } = await connect();
    for (const name of ["tool_invoke", "constructor", "__proto__", "missing_tool"]) {
      expect((await client.callTool({ name: "tool_invoke", arguments: { name } })).isError).toBe(true);
    }
  });
  it("allows compact group discovery without returning schemas", async () => {
    const { client } = await connect();
    const result = value(await client.callTool({ name: "tool_groups", arguments: { group: "verify", includeTools: true } }));
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].tools).toContain("verify_run");
    expect(JSON.stringify(result)).not.toContain("inputSchema");
  });
  it("exposes shell_run through system with the original cancellation context", async () => {
    const shellRun = vi.fn(async (_args, context) => ({ ok: true, exitCode: 0, stdout: "fixture", stderr: "", hasSignal: context.signal instanceof AbortSignal }));
    const { client } = await connect({ shellRun });
    const group = value(await client.callTool({ name: "tool_groups", arguments: { group: "system", includeTools: true } }));
    expect(group.groups[0].tools).toContain("shell_run");
    const result = value(await client.callTool({ name: "tool_invoke", arguments: { name: "shell_run", arguments: { command: "node --version", timeoutMs: 3000 } } }));
    expect(result).toMatchObject({ exitCode: 0, hasSignal: true });
    expect(shellRun).toHaveBeenCalledOnce();
  });
  it("forwards explicit worker files/routes to verify_plan", async () => {
    const verifyPlan = vi.fn(async () => ({ ok: true }));
    const { client } = await connect({ verifyPlan });
    const args = { files: ["src/Chat.tsx"], routes: ["/chat"] };
    await client.callTool({ name: "tool_invoke", arguments: { name: "verify_plan", arguments: args } });
    expect(verifyPlan).toHaveBeenCalledWith(expect.objectContaining(args));
  });
  it("accepts mobile viewports through the real MCP schema", async () => {
    const scrapingSessionStart = vi.fn(async args => ({ ok: true, session_id: "mobile-fixture", width: args.window_width }));
    const { client } = await connect({ scrapingSessionStart });
    const mobile = await client.callTool({ name: "tool_invoke", arguments: { name: "scraping_session_start", arguments: { window_width: 390, window_height: 844 } } });
    expect(mobile.isError).not.toBe(true);
    expect(value(mobile)).toMatchObject({ ok: true, width: 390 });
    const tooSmall = await client.callTool({ name: "tool_invoke", arguments: { name: "scraping_session_start", arguments: { window_width: 100 } } });
    expect(tooSmall.isError).toBe(true);
    expect(scrapingSessionStart).toHaveBeenCalledTimes(1);
  });
  it("returns opt-in screenshots as image blocks, not base64 inside JSON", async () => {
    const browserScreenshot = vi.fn(async (_full, _pane, options) => ({ ok: true, path: "capture.png", mimeType: "image/png", ...(options.inline ? { data: "aGVsbG8=" } : {}) }));
    const { client } = await connect({ browserScreenshot, browserPageSummary: async () => ({ title: "fixture" }) });
    const normal = await client.callTool({ name: "browser_screenshot", arguments: {} });
    expect(normal.content).toHaveLength(1);
    expect(normal.content[0].text).not.toContain("data");
    const inline = await client.callTool({ name: "browser_screenshot", arguments: { inline: true, format: "png" } });
    expect(inline.content[1]).toMatchObject({ type: "image", mimeType: "image/png", data: "aGVsbG8=" });
    expect(inline.content[0].text).not.toContain("aGVsbG8=");
  });
  it("forwards pane context and never turns a refused write into success", async () => {
    const writePane = vi.fn(async () => ({ ok: false, code: "shell_busy", error: "busy" }));
    const taskList = vi.fn(async () => ({ ok: true, tasks: [] }));
    const { client } = await connect({ writePane, taskList });
    const denied = await client.callTool({ name: "pane_write", arguments: { paneId: "shell", text: "fixture", fromPaneId: "pilot" } });
    expect(denied.isError).toBe(true);
    expect(writePane).toHaveBeenCalledWith("shell", "fixture", true, { fromPaneId: "pilot" });
    await client.callTool({ name: "task_list", arguments: { callerPaneId: "worker" } });
    expect(taskList).toHaveBeenCalledWith(expect.any(Object), { callerPaneId: "worker" });
  });
  it("delivers complete updates past 200 characters and distinguishes storage from stdin submission", async () => {
    const messagePane = vi.fn(async () => ({ ok: true }));
    const { client } = await connect({ messagePane });
    const fs = require("node:fs");
    // Isolate the existing file-based inbox; never write into the real user's inbox.
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const persist = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});
    vi.spyOn(fs, "openSync").mockImplementation(() => { throw Error("fixture storage"); });
    const text = "x".repeat(500) + " — FINAL DO ESCOPO";
    const sent = await client.callTool({ name: "pane_send_message", arguments: { from: "pilot", to: "worker", content: text, type: "update" } });
    expect(value(sent)).toMatchObject({ ok: true, stored: true, submitted: true });
    expect(messagePane.mock.calls[0][1]).toContain(text);
    expect(JSON.parse(persist.mock.calls[0][1]).content).toBe(text);
    messagePane.mockResolvedValueOnce({ ok: false, error: "not an agent" });
    const denied = await client.callTool({ name: "pane_send_message", arguments: { from: "pilot", to: "worker", content: "fixture" } });
    expect(denied.isError).toBe(true);
    expect(value(denied)).toMatchObject({ stored: true, submitted: false });
  });
});
