// @vitest-environment node
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron-log/main.js", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { getHarness } from "./cli-registry";
import { prepareGenericHarness, wireExternalMcpServers, type PrepareHarnessInput } from "./harness-spawn";

const MCP_URL = "http://127.0.0.1:7000/mcp";
let cwd: string;
let promptFile: string;

const base = (overrides: Partial<PrepareHarnessInput> = {}): PrepareHarnessInput => ({
  args: [],
  env: {},
  cwd,
  mcpUrl: MCP_URL,
  buildPromptFile: () => promptFile,
  ...overrides,
});

const read = (rel: string) => fs.readFileSync(path.join(cwd, rel), "utf-8");

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "harness-spawn-"));
  promptFile = path.join(cwd, "prompt-source.md");
  fs.writeFileSync(promptFile, "PROMPT DO CODEBRAIN", "utf-8");
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe("prepareGenericHarness", () => {
  it("wires Kiro through workspace files and CLI flags", () => {
    const args = prepareGenericHarness(getHarness("kiro")!, base({ model: "claude-sonnet-5.5", effort: "high" }));
    expect(args).toEqual(["--model", "claude-sonnet-5.5", "--effort", "high", "--trust-all-tools", "--trust-workspace", "--agent", expect.stringMatching(/^codebrain-/)]);
    expect(JSON.parse(read(".kiro/settings/mcp.json")).mcpServers.codebrain).toEqual({ url: MCP_URL });
    expect(JSON.parse(read(`.kiro/agents/${args.at(-1)}.json`))).toMatchObject({ prompt: "PROMPT DO CODEBRAIN", includeMcpJson: true });
  });

  it("keeps the user's other MCP servers when merging", () => {
    fs.mkdirSync(path.join(cwd, ".kiro/settings"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".kiro/settings/mcp.json"), '{"mcpServers":{"mine":{"command":"x"}}}');
    prepareGenericHarness(getHarness("kiro")!, base());
    const servers = JSON.parse(read(".kiro/settings/mcp.json")).mcpServers;
    expect(servers.mine).toEqual({ command: "x" });
    expect(servers.codebrain).toBeDefined();
  });

  it("leaves a corrupt MCP file alone and still launches", () => {
    fs.mkdirSync(path.join(cwd, ".kiro/settings"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".kiro/settings/mcp.json"), "{ corrompido");
    const args = prepareGenericHarness(getHarness("kiro")!, base());
    expect(read(".kiro/settings/mcp.json")).toBe("{ corrompido");
    expect(args).toContain("--trust-all-tools");
  });

  it("omits permission flags in a non-bypass mode", () => {
    const args = prepareGenericHarness(getHarness("kiro")!, base({ permissionMode: "default" }));
    expect(args).not.toContain("--trust-all-tools");
  });

  it("wires Antigravity MCP without leaking pane identity through shared rules", () => {
    const buildPromptFile = vi.fn(() => promptFile);
    prepareGenericHarness(getHarness("antigravity")!, base({ buildPromptFile }));
    expect(fs.existsSync(path.join(cwd, ".agents/rules/codebrain.md"))).toBe(false);
    expect(buildPromptFile).not.toHaveBeenCalled();
    expect(JSON.parse(read(".agents/mcp_config.json")).mcpServers.codebrain).toEqual({ serverUrl: MCP_URL });
  });

  it("does not overwrite a file the user owns", () => {
    fs.mkdirSync(path.join(cwd, ".commandcode"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".commandcode/AGENTS.md"), "meu arquivo");
    prepareGenericHarness(getHarness("commandcode")!, base());
    expect(read(".commandcode/AGENTS.md")).toBe("meu arquivo");
  });

  it("keeps Kiro pane prompts isolated instead of replacing shared steering", () => {
    const first = prepareGenericHarness(getHarness("kiro")!, base()).at(-1);
    fs.writeFileSync(promptFile, "NOVO PROMPT", "utf-8");
    const second = prepareGenericHarness(getHarness("kiro")!, base()).at(-1);
    expect(second).not.toBe(first);
    expect(JSON.parse(read(`.kiro/agents/${first}.json`)).prompt).toBe("PROMPT DO CODEBRAIN");
    expect(JSON.parse(read(`.kiro/agents/${second}.json`)).prompt).toBe("NOVO PROMPT");
    expect(fs.existsSync(path.join(cwd, ".kiro/steering/codebrain.md"))).toBe(false);
  });

  it("skips Command Code instructions when a root AGENTS.md would shadow them", () => {
    fs.writeFileSync(path.join(cwd, "AGENTS.md"), "do projeto");
    const args = prepareGenericHarness(getHarness("commandcode")!, base());
    expect(fs.existsSync(path.join(cwd, ".commandcode/AGENTS.md"))).toBe(false);
    expect(JSON.parse(read(".mcp.json")).mcpServers.codebrain).toEqual({ type: "http", url: MCP_URL });
    expect(args).toContain("--yolo");
  });

  it("configures OpenCode only through the environment", () => {
    const env: Record<string, string> = {};
    const args = prepareGenericHarness(getHarness("opencode")!, base({ env, model: "anthropic/claude" }));
    const config = JSON.parse(env["OPENCODE_CONFIG_CONTENT"]);
    expect(config.mcp.codebrain.url).toBe(MCP_URL);
    expect(config.permission).toBe("allow");
    expect(args).toEqual(["--model", "anthropic/claude"]);
    expect(fs.readdirSync(cwd)).toEqual(["prompt-source.md"]);
  });

  it("merges OpenCode wiring without losing explicit caller permissions and servers", () => {
    const env = { OPENCODE_CONFIG_CONTENT: '{"permission":"ask","instructions":["mine.md"],"mcp":{"mine":{"type":"local"}}}' };
    prepareGenericHarness(getHarness("opencode")!, base({ env }));
    expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT)).toMatchObject({
      permission: "ask", instructions: ["mine.md", promptFile.replace(/\\/g, "/")],
      mcp: { mine: { type: "local" }, codebrain: { url: MCP_URL } },
    });
  });

  it("passes the Grok prompt inline and writes the project TOML", () => {
    const args = prepareGenericHarness(getHarness("grok")!, base());
    expect(args).toEqual(["--yolo", "--rules", "PROMPT DO CODEBRAIN"]);
    expect(read(".grok/config.toml")).toContain(`url = "${MCP_URL}"`);
  });

  it("writes the Hermes config and skill under HERMES_HOME", () => {
    const home = path.join(cwd, "hermes-home");
    const args = prepareGenericHarness(getHarness("hermes")!, base({ env: { HERMES_HOME: home } }));
    expect(args).toEqual(["--yolo", "-s", expect.stringMatching(/^codebrain-/)]);
    expect(fs.readFileSync(path.join(home, "config.yaml"), "utf-8")).toContain(`url: "${MCP_URL}"`);
    const skill = fs.readFileSync(path.join(home, "skills", args.at(-1)!, "SKILL.md"), "utf-8");
    expect(skill.startsWith(`---\nname: ${args.at(-1)}\n`)).toBe(true);
    expect(skill).toContain("PROMPT DO CODEBRAIN");
    fs.writeFileSync(promptFile, "OUTRO PANE");
    const second = prepareGenericHarness(getHarness("hermes")!, base({ env: { HERMES_HOME: home } })).at(-1)!;
    expect(second).not.toBe(args.at(-1));
    expect(fs.readFileSync(path.join(home, "skills", args.at(-1)!, "SKILL.md"), "utf-8")).toBe(skill);
  });

  it("wires Muse with an optional server and no prompt", () => {
    const configHome = path.join(cwd, "xdg");
    const buildPromptFile = vi.fn(() => promptFile);
    const args = prepareGenericHarness(getHarness("muse")!, base({ env: { XDG_CONFIG_HOME: configHome }, buildPromptFile }));
    const settings = JSON.parse(fs.readFileSync(path.join(configHome, "muse/settings.json"), "utf-8"));
    expect(settings.schema_version).toBe(1);
    expect(settings.mcpServers.codebrain).toEqual({ type: "streamable-http", url: MCP_URL, enabled: true, required: false });
    expect(buildPromptFile).not.toHaveBeenCalled();
    expect(args).toEqual(["--yolo", "--trust-workspace"]);
  });

  it("launches without MCP files when the server is not up", () => {
    const args = prepareGenericHarness(getHarness("kiro")!, base({ mcpUrl: undefined }));
    expect(fs.existsSync(path.join(cwd, ".kiro/settings/mcp.json"))).toBe(false);
    expect(args).toContain("--trust-all-tools");
  });

  it("survives a prompt builder that throws", () => {
    const args = prepareGenericHarness(getHarness("kiro")!, base({ buildPromptFile: () => { throw new Error("boom"); } }));
    expect(args).toContain("--trust-all-tools");
    expect(fs.existsSync(path.join(cwd, ".kiro/settings/mcp.json"))).toBe(true);
  });

  it("leaves an experimental harness as a simple launch even with a stale spec", () => {
    const buildPromptFile = vi.fn(() => promptFile);
    const env = {};
    expect(prepareGenericHarness({ ...getHarness("opencode")!, verified: false }, base({ env, args: ["mine"], buildPromptFile }))).toEqual(["mine"]);
    expect(env).toEqual({});
    expect(buildPromptFile).not.toHaveBeenCalled();
    expect(fs.readdirSync(cwd)).toEqual(["prompt-source.md"]);
  });

  it("respects an explicitly selected Kiro custom agent", () => {
    const buildPromptFile = vi.fn(() => promptFile);
    const args = prepareGenericHarness(getHarness("kiro")!, base({ args: ["--agent=mine"], buildPromptFile }));
    expect(args.filter((arg) => arg.startsWith("--agent"))).toEqual(["--agent=mine"]);
    expect(buildPromptFile).not.toHaveBeenCalled();
  });

  it("does not replace a Kiro agent whose prompt happens to mention the managed marker", () => {
    const args = prepareGenericHarness(getHarness("kiro")!, base());
    const rel = `.kiro/agents/${args.at(-1)}.json`;
    const ownedByUser = JSON.stringify({ description: "mine", prompt: "Example: <!-- codebrain:managed -->" });
    fs.writeFileSync(path.join(cwd, rel), ownedByUser);
    const next = prepareGenericHarness(getHarness("kiro")!, base());
    expect(read(rel)).toBe(ownedByUser);
    expect(next).not.toContain("--agent");
  });

  it("puts generated Kiro arguments before the positional separator", () => {
    const args = prepareGenericHarness(getHarness("kiro")!, base({ args: ["--", "--agent=literal"], model: "m" }));
    expect(args.indexOf("--agent")).toBeLessThan(args.indexOf("--"));
    expect(args.slice(args.indexOf("--"))).toEqual(["--", "--agent=literal"]);
  });

  it("keeps invalid OpenCode content intact", () => {
    const env = { OPENCODE_CONFIG_CONTENT: "{invalid" };
    prepareGenericHarness(getHarness("opencode")!, base({ env }));
    expect(env.OPENCODE_CONFIG_CONTENT).toBe("{invalid");
  });

  it("merges inherited OpenCode content", () => {
    vi.stubEnv("OPENCODE_CONFIG_CONTENT", '{"theme":"mine","permission":{"bash":"deny"}}');
    try {
      const env: Record<string, string> = {};
      prepareGenericHarness(getHarness("opencode")!, base({ env }));
      expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT)).toMatchObject({ theme: "mine", permission: { bash: "deny" }, mcp: { codebrain: { url: MCP_URL } } });
    } finally { vi.unstubAllEnvs(); }
  });

  it.each(["mcpServers", "mcp_servers"])("preserves Muse %s spelling without creating a conflicting second key", (key) => {
    const configHome = path.join(cwd, "xdg");
    fs.mkdirSync(path.join(configHome, "muse"), { recursive: true });
    fs.writeFileSync(path.join(configHome, "muse/settings.json"), JSON.stringify({ [key]: { mine: { url: "keep" } } }));
    prepareGenericHarness(getHarness("muse")!, base({ env: { XDG_CONFIG_HOME: configHome } }));
    const settings = JSON.parse(fs.readFileSync(path.join(configHome, "muse/settings.json"), "utf-8"));
    expect(settings[key].mine.url).toBe("keep");
    expect(settings[key].codebrain.url).toBe(MCP_URL);
    expect(settings[key === "mcpServers" ? "mcp_servers" : "mcpServers"]).toBeUndefined();
  });
});

describe("external stdio MCP wiring", () => {
  const servers = { "http-toolkit": { command: "node", args: ["toolkit-server.js", "--stdio"] } };

  it.each([
    ["kiro", ".kiro/settings/mcp.json"],
    ["antigravity", ".agents/mcp_config.json"],
    ["commandcode", ".mcp.json"],
  ] as const)("keeps approved .cmd launcher literal and forwards env for %s", (id, file) => {
    const command = path.join(cwd, "approved tools", "http-toolkit-mcp.cmd");
    const server = { command, args: [], env: { TOOLKIT_MODE: "test" } };
    const input = base({ mcpUrl: undefined, externalMcpServers: { toolkit: server } });
    prepareGenericHarness(getHarness(id)!, input);
    expect(JSON.parse(read(file)).mcpServers.toolkit).toMatchObject(server);
    expect(input.env.TOOLKIT_MODE).toBeUndefined();
  });

  it("uses OpenCode environment mapping and a direct .cmd command without shell wrappers", () => {
    const command = path.join(cwd, "approved tools", "http-toolkit-mcp.cmd");
    const input = base({ mcpUrl: undefined, externalMcpServers: { toolkit: { command, args: [], env: { TOOLKIT_MODE: "test" } } } });
    prepareGenericHarness(getHarness("opencode")!, input);
    expect(JSON.parse(input.env.OPENCODE_CONFIG_CONTENT).mcp.toolkit).toEqual({
      type: "local", command: [command], environment: { TOOLKIT_MODE: "test" }, enabled: true,
    });
    expect(input.env.TOOLKIT_MODE).toBeUndefined();
  });

  it.each(["mcpServers", "mcp_servers"])("forwards Muse stdio env and literal .cmd command using %s", (key) => {
    const configHome = path.join(cwd, "xdg");
    const file = path.join(configHome, "muse/settings.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ [key]: {} }));
    const server = { command: path.join(cwd, "approved tools", "http-toolkit-mcp.cmd"), args: [], env: { TOOLKIT_MODE: "test" } };
    prepareGenericHarness(getHarness("muse")!, base({ mcpUrl: undefined, env: { XDG_CONFIG_HOME: configHome }, externalMcpServers: { toolkit: server } }));
    expect(JSON.parse(fs.readFileSync(file, "utf-8"))[key].toolkit).toMatchObject(server);
  });

  it("wires Kiro standard stdio even without the Codebrain HTTP server", () => {
    prepareGenericHarness(getHarness("kiro")!, base({ mcpUrl: undefined, externalMcpServers: servers }));
    expect(JSON.parse(read(".kiro/settings/mcp.json"))).toEqual({ mcpServers: servers });
    expect(servers["http-toolkit"].args).toEqual(["toolkit-server.js", "--stdio"]);
  });

  it.each([
    ["kiro", ".kiro/settings/mcp.json", false],
    ["antigravity", ".agents/mcp_config.json", false],
    ["commandcode", ".mcp.json", true],
  ] as const)("preserves unrelated JSON config for %s and uses its confirmed schema", (id, rel, typed) => {
    fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
    fs.writeFileSync(path.join(cwd, rel), JSON.stringify({ theme: "mine", mcpServers: { mine: { command: "keep" } } }));
    prepareGenericHarness(getHarness(id)!, base({ externalMcpServers: servers }));
    const config = JSON.parse(read(rel));
    expect(config.theme).toBe("mine");
    expect(config.mcpServers.mine).toEqual({ command: "keep" });
    expect(config.mcpServers.codebrain.url ?? config.mcpServers.codebrain.serverUrl).toBe(MCP_URL);
    expect(config.mcpServers["http-toolkit"]).toEqual({ ...(typed ? { type: "stdio" } : {}), ...servers["http-toolkit"] });
  });

  it("preserves existing same-name servers and the reserved Codebrain server", () => {
    fs.mkdirSync(path.join(cwd, ".kiro/settings"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".kiro/settings/mcp.json"), JSON.stringify({ mcpServers: { "http-toolkit": { command: "mine" }, codebrain: { url: "keep" } } }));
    wireExternalMcpServers(getHarness("kiro")!, base(), { ...servers, codebrain: { command: "do-not-run", args: [] } });
    expect(JSON.parse(read(".kiro/settings/mcp.json")).mcpServers).toEqual({ "http-toolkit": { command: "mine" }, codebrain: { url: "keep" } });
  });

  it("merges OpenCode local command arrays without changing permissions or existing servers", () => {
    const env = { OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: "ask", theme: "mine", mcp: { other: { type: "local", command: ["keep"] } } }) };
    prepareGenericHarness(getHarness("opencode")!, base({ env, externalMcpServers: servers }));
    expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT)).toMatchObject({
      permission: "ask", theme: "mine", instructions: [promptFile.replace(/\\/g, "/")],
      mcp: { other: { command: ["keep"] }, codebrain: { url: MCP_URL }, "http-toolkit": { type: "local", command: ["node", "toolkit-server.js", "--stdio"], enabled: true } },
    });
    expect(fs.existsSync(path.join(cwd, "opencode.json"))).toBe(false);
  });

  it("respects inherited OpenCode config including a same-name external server", () => {
    vi.stubEnv("OPENCODE_CONFIG_CONTENT", JSON.stringify({ mcp: { "http-toolkit": { type: "local", command: ["mine"] } } }));
    const input = base({ env: {} });
    wireExternalMcpServers(getHarness("opencode")!, input, servers);
    expect(JSON.parse(input.env.OPENCODE_CONFIG_CONTENT).mcp["http-toolkit"].command).toEqual(["mine"]);
  });

  it.each(["mcpServers", "mcp_servers"])("writes compatible optional Muse stdio using only %s", (key) => {
    const configHome = path.join(cwd, "xdg");
    const file = path.join(configHome, "muse/settings.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ theme: "mine", [key]: { other: { command: "keep" } } }));
    prepareGenericHarness(getHarness("muse")!, base({ env: { XDG_CONFIG_HOME: configHome }, externalMcpServers: servers }));
    const config = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(config.theme).toBe("mine");
    expect(config[key].other.command).toBe("keep");
    expect(config[key]["http-toolkit"]).toEqual({ ...servers["http-toolkit"], enabled: true, ...(key === "mcp_servers" ? { transport: "stdio", mode: "optional" } : { type: "stdio", required: false }) });
    expect(config[key === "mcpServers" ? "mcp_servers" : "mcpServers"]).toBeUndefined();
  });

  it("preserves ambiguous Muse settings instead of mixing schemas", () => {
    const configHome = path.join(cwd, "xdg");
    const file = path.join(configHome, "muse/settings.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const original = '{"mcpServers":{},"mcp_servers":{},"theme":"mine"}';
    fs.writeFileSync(file, original);
    wireExternalMcpServers(getHarness("muse")!, base({ env: { XDG_CONFIG_HOME: configHome } }), servers);
    expect(fs.readFileSync(file, "utf-8")).toBe(original);
  });

  it.each(["{broken", "[]", "null", '{"mcpServers":null}', '{"mcpServers":[]}', '{"mcpServers":"invalid"}'])("preserves invalid JSON settings verbatim: %s", (original) => {
    fs.mkdirSync(path.join(cwd, ".kiro/settings"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".kiro/settings/mcp.json"), original);
    wireExternalMcpServers(getHarness("kiro")!, base(), servers);
    expect(read(".kiro/settings/mcp.json")).toBe(original);
  });

  it("keeps invalid OpenCode JSON intact", () => {
    const input = base({ env: { OPENCODE_CONFIG_CONTENT: "{broken" }, externalMcpServers: servers });
    prepareGenericHarness(getHarness("opencode")!, input);
    expect(input.env.OPENCODE_CONFIG_CONTENT).toBe("{broken");
  });

  it("does not wire unverified, non-MCP, native or unconfirmed TOML/YAML schemas", () => {
    const kiro = getHarness("kiro")!;
    for (const entry of [
      { ...kiro, verified: false },
      { ...kiro, capabilities: { ...kiro.capabilities, mcp: false } },
      getHarness("claude")!, getHarness("grok")!, getHarness("hermes")!,
    ]) wireExternalMcpServers(entry, base(), servers);
    expect(fs.readdirSync(cwd)).toEqual(["prompt-source.md"]);
  });

  it("does not change the launch of an experimental harness with external servers", () => {
    const input = base({ args: ["mine"], externalMcpServers: servers });
    expect(prepareGenericHarness({ ...getHarness("kiro")!, verified: false }, input)).toEqual(["mine"]);
    expect(input.env).toEqual({});
    expect(fs.readdirSync(cwd)).toEqual(["prompt-source.md"]);
  });

  it("does nothing for empty or invalid stdio entries", () => {
    wireExternalMcpServers(getHarness("kiro")!, base(), {});
    wireExternalMcpServers(getHarness("kiro")!, base(), { invalid: { command: " ", args: [] }, codebrain: servers["http-toolkit"] });
    expect(fs.readdirSync(cwd)).toEqual(["prompt-source.md"]);
  });
});
