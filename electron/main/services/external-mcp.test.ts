// @vitest-environment node
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { externalMcpOverrides, mergeMcpFile, readExternalMcpServers } from "./external-mcp";
const fixtures: string[] = [];
const fixture = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-external-mcp-")); fixtures.push(dir); return dir; };
afterEach(() => { for (const dir of fixtures.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
describe("explicit external MCP registration", () => {
  it("loads a launcher with spaces without executing it", () => {
    const home = fixture();
    const file = path.join(home, ".codebrain/mcp.json");
    fs.mkdirSync(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { "http-toolkit": { command: "C:\\Programs\\HTTP Toolkit\\mcp.cmd" }, codebrain: { command: "ignored" } } }));
    expect(readExternalMcpServers(home)).toEqual({ "http-toolkit": { command: "C:\\Programs\\HTTP Toolkit\\mcp.cmd", args: [] } });
  });
  it("preserves unrelated servers, project overrides and top-level settings", () => {
    const file = path.join(fixture(), "mcp.json");
    fs.writeFileSync(file, JSON.stringify({ note: "keep", mcpServers: { other: { url: "keep" }, "http-toolkit": { command: "custom" }, codebrain: { url: "old" } } }));
    mergeMcpFile(file, { "http-toolkit": { command: "default" }, codebrain: { url: "new" } });
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ note: "keep", mcpServers: { other: { url: "keep" }, "http-toolkit": { command: "custom" }, codebrain: { url: "new" } } });
  });
  it("never overwrites invalid user configuration", () => {
    const file = path.join(fixture(), "mcp.json"); fs.writeFileSync(file, "{broken");
    expect(() => mergeMcpFile(file, {})).toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe("{broken");
  });
  it("uses quoted TOML keys and does not auto-approve external tools", () => {
    const args = externalMcpOverrides({ "http-toolkit": { command: "C:\\HTTP Toolkit\\mcp.cmd", args: [] } });
    expect(args).toEqual(["-c", 'mcp_servers."http-toolkit".command="C:\\\\HTTP Toolkit\\\\mcp.cmd"', "-c", 'mcp_servers."http-toolkit".args=[]']);
    expect(args.join(" ")).not.toContain("approve");
  });
});
