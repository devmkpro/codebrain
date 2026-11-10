// @vitest-environment node
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLI_REGISTRY,
  accountCapableClis,
  buildHarnessArgs,
  buildOpencodeConfig,
  buildRegistryView,
  detectHarnesses,
  getGenericHarness,
  getHarness,
  harnessAgentDefaults,
  harnessSearchPaths,
  hermesHome,
  installRecipes,
  isGenericHarness,
  mergeJsonServer,
  upsertHermesMcpServer,
  upsertTomlMcpServer,
  type HarnessEntry,
} from "./cli-registry";

const entry = (id: string): HarnessEntry => {
  const found = getHarness(id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
};

const TARGET_IDS = [
  "claude", "openclaude", "codex", "gemini", "kimi", "cursor", "copilot",
  "kiro", "opencode", "grok", "antigravity", "hermes", "muse", "commandcode",
];

describe("registry integrity", () => {
  it("covers exactly the target harness set, with unique ids", () => {
    const ids = CLI_REGISTRY.map((item) => item.id);
    expect([...ids].sort()).toEqual([...TARGET_IDS].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(CLI_REGISTRY.map((item) => [item.id, item] as const))("%s has the required metadata", (_id, item) => {
    expect(item.label).toBeTruthy();
    expect(item.binaries.length).toBeGreaterThan(0);
    expect(item.docsUrl).toMatch(/^https:\/\//);
  });

  it("gives generic entries a spec and native entries none", () => {
    for (const item of CLI_REGISTRY) {
      expect(Boolean(item.generic)).toBe(item.spawn === "generic");
    }
  });

  it.each(CLI_REGISTRY.filter((item) => item.generic).map((item) => [item.id, item] as const))(
    "%s advertises only capabilities its spec implements",
    (_id, item) => {
      const spec = item.generic!;
      expect(item.capabilities.model).toBe(Boolean(spec.model));
      expect(item.capabilities.effort).toBe(Boolean(spec.effort));
      expect(item.capabilities.resume).toBe(Boolean(spec.resume));
      expect(item.capabilities.mcp).toBe(Boolean(spec.mcp));
      expect(item.capabilities.systemPrompt).toBe(Boolean(spec.instructions));
      expect(item.capabilities.multiAccount).toBe(Boolean(item.accountEnvVar));
    },
  );

  it("keeps unverified entries free of flags", () => {
    for (const item of CLI_REGISTRY.filter((candidate) => !candidate.verified)) {
      expect(item.generic?.model).toBeUndefined();
      expect(item.generic?.skipPermissions).toBeUndefined();
    }
  });

  it("never treats the Windows shell or the Kiro IDE launcher as a harness binary", () => {
    expect(entry("commandcode").binaries).not.toContain("cmd");
    expect(entry("kiro").binaries).toEqual(["kiro-cli"]);
  });

  it("only allows script installers from each vendor's own domain", () => {
    const hosts: Record<string, RegExp> = {
      kimi: /code\.kimi\.com/, cursor: /cursor\.com/, kiro: /cli\.kiro\.dev/, grok: /x\.ai\/cli/,
      antigravity: /antigravity\.google/, hermes: /hermes-agent\.nousresearch\.com/, muse: /dev\.meta\.ai/,
    };
    for (const item of CLI_REGISTRY) {
      if (item.install?.via !== "script") continue;
      for (const command of [item.install.unix, item.install.win]) {
        if (command) expect(command).toMatch(hosts[item.id]);
      }
    }
  });

  it("lists every harness in the pane_spawn agent enum", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../../../../packages/mcp/index.js"), "utf-8");
    const start = source.indexOf('"pane_spawn"');
    const enumBody = source.slice(source.indexOf(".enum([", start), source.indexOf("])", source.indexOf(".enum([", start)));
    for (const id of TARGET_IDS) expect(enumBody).toContain(`"${id}"`);
  });
});

describe("registry helpers", () => {
  it("separates generic from native harnesses", () => {
    expect(isGenericHarness("kiro")).toBe(true);
    expect(isGenericHarness("codex")).toBe(false);
    expect(isGenericHarness("shell")).toBe(false);
    expect(getGenericHarness(undefined)).toBeUndefined();
  });

  it("launches Kiro through its chat subcommand", () => {
    expect(harnessAgentDefaults().kiro).toEqual({ binary: "kiro-cli", args: ["chat"] });
    expect(harnessAgentDefaults().hermes).toEqual({ binary: "hermes", args: ["chat"] });
    expect(harnessAgentDefaults().grok).toEqual({ binary: "grok", args: [] });
    expect(harnessAgentDefaults().codex).toBeUndefined();
  });

  it("reports only CLIs with a documented config-dir env var as account capable", () => {
    expect(accountCapableClis()).toEqual(expect.arrayContaining([
      { id: "kiro", envVar: "KIRO_HOME" },
      { id: "grok", envVar: "GROK_HOME" },
      { id: "hermes", envVar: "HERMES_HOME" },
      { id: "claude", envVar: "CLAUDE_CONFIG_DIR" },
      { id: "codex", envVar: "CODEX_HOME" },
    ]));
    const ids = accountCapableClis().map((item) => item.id);
    for (const id of ["opencode", "antigravity", "muse", "commandcode", "cursor"]) expect(ids).not.toContain(id);
  });

  it("exposes an install recipe for every entry that has one", () => {
    const recipes = installRecipes();
    expect(recipes.opencode).toEqual({ via: "npm", pkg: "opencode-ai" });
    expect(recipes.commandcode).toEqual({ via: "npm", pkg: "command-code" });
    expect(recipes.kiro).toMatchObject({ via: "script" });
  });

  it("leaves Kiro on Windows without an invented installer", () => {
    const recipe = entry("kiro").install;
    expect(recipe?.via === "script" && recipe.win).toBeFalsy();
    expect(entry("kiro").supportedPlatforms).toContain("win32");
    expect(buildRegistryView({}).find((item) => item.id === "kiro")?.supportedPlatforms).toContain("win32");
  });

  it("expands install directories per platform", () => {
    const windows = harnessSearchPaths("kiro-cli", "win32", { LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" }, "C:\\Users\\a");
    expect(windows[0]).toBe("C:\\Users\\a\\AppData\\Local\\Kiro-Cli\\kiro-cli.exe");
    expect(harnessSearchPaths("opencode", "linux", {}, "/home/a")).toEqual(["/home/a/.opencode/bin/opencode"]);
    expect(harnessSearchPaths("kiro-cli", "win32", {}, "C:\\Users\\a")).toEqual([]);
    expect(harnessSearchPaths("not-a-cli", "linux", {}, "/home/a")).toEqual([]);
  });
});

describe("detection merging", () => {
  const entries = CLI_REGISTRY.filter((item) => item.id === "kiro" || item.id === "cursor");

  it("reports one result per id, passing requireVersion through", () => {
    const calls: Array<[string, boolean]> = [];
    const detected = detectHarnesses(entries, (binary, requireVersion) => {
      calls.push([binary, requireVersion]);
      return binary === "kiro-cli" ? { found: true, path: "/bin/kiro-cli", version: "3.1.0" } : { found: false };
    });
    expect(detected.kiro).toEqual({ found: true, path: "/bin/kiro-cli", version: "3.1.0" });
    expect(detected.cursor).toEqual({ found: false });
    expect(calls).toContainEqual(["cursor-agent", true]);
    expect(calls).toContainEqual(["kiro-cli", false]);
  });

  it("stops at the first binary found", () => {
    const multi = [{ ...entry("kiro"), binaries: ["first", "second"] }];
    const probed: string[] = [];
    const detected = detectHarnesses(multi, (binary) => {
      probed.push(binary);
      return { found: true, path: binary };
    });
    expect(probed).toEqual(["first"]);
    expect(detected.kiro.path).toBe("first");
  });

  it("builds the IPC view with defaults for anything undetected", () => {
    const view = buildRegistryView({ kiro: { found: true, version: "3.1.0" }, shell: { path: "/bin/sh" } });
    expect(view).toHaveLength(CLI_REGISTRY.length);
    const kiro = view.find((item) => item.id === "kiro")!;
    expect(kiro).toMatchObject({ found: true, version: "3.1.0", verified: true, loginCommand: "kiro-cli login" });
    expect(view.find((item) => item.id === "grok")).toMatchObject({ found: false, loginCommand: "grok login" });
  });
});

describe("buildHarnessArgs", () => {
  it("never injects flags for unverified entries, even if a spec was left behind", () => {
    expect(buildHarnessArgs({ ...entry("kiro"), verified: false }, { model: "x", effort: "high", skipPermissions: true }, ["literal"])).toEqual(["literal"]);
  });

  it("inserts flags before -- and ignores flag-like positional text", () => {
    expect(buildHarnessArgs(entry("kiro"), { model: "actual" }, ["--", "--model=literal"])).toEqual(["--model", "actual", "--", "--model=literal"]);
  });
  it("builds the full Kiro flag set", () => {
    expect(buildHarnessArgs(entry("kiro"), {
      model: "claude-sonnet-5.5", effort: "medium", skipPermissions: true, resumeSessionId: "abc",
    })).toEqual([
      "--model", "claude-sonnet-5.5", "--effort", "medium",
      "--trust-all-tools", "--trust-workspace", "--resume-id", "abc",
    ]);
  });

  it("omits effort when the CLI cannot take it", () => {
    expect(buildHarnessArgs(entry("hermes"), { model: "m", effort: "high" })).toEqual(["--model", "m"]);
    expect(buildHarnessArgs(entry("opencode"), { model: "a/b", effort: "high" })).toEqual(["--model", "a/b"]);
  });

  it("uses each CLI's own effort and permission flags", () => {
    expect(buildHarnessArgs(entry("muse"), { effort: "high", skipPermissions: true }))
      .toEqual(["--reasoning-effort", "high", "--yolo", "--trust-workspace"]);
    expect(buildHarnessArgs(entry("antigravity"), { skipPermissions: true })).toEqual(["--dangerously-skip-permissions"]);
    expect(buildHarnessArgs(entry("commandcode"), { skipPermissions: true })).toEqual(["--yolo", "--trust"]);
  });

  it("drops an OpenCode model that is not provider/model", () => {
    expect(buildHarnessArgs(entry("opencode"), { model: "gpt-5" })).toEqual([]);
  });

  it("never adds a skip-permissions flag unless asked", () => {
    expect(buildHarnessArgs(entry("grok"), { model: "grok-build" })).toEqual(["--model", "grok-build"]);
  });

  it("does not override flags or aliases the caller passed", () => {
    expect(buildHarnessArgs(entry("grok"), { model: "x" }, ["-m", "mine"])).toEqual(["-m", "mine"]);
    expect(buildHarnessArgs(entry("kiro"), { effort: "low" }, ["--effort=high"])).toEqual(["--effort=high"]);
    expect(buildHarnessArgs(entry("opencode"), { resumeSessionId: "new" }, ["-s", "mine"])).toEqual(["-s", "mine"]);
    expect(buildHarnessArgs(entry("grok"), { resumeSessionId: "new" }, ["-r", "mine"])).toEqual(["-r", "mine"]);
    expect(buildHarnessArgs(entry("kiro"), { resumeSessionId: "new" }, ["--resume"])).toEqual(["--resume"]);
  });

  it("passes Grok instructions as a flag only within the size limit", () => {
    expect(buildHarnessArgs(entry("grok"), { instructions: "regras" })).toEqual(["--rules", "regras"]);
    expect(buildHarnessArgs(entry("grok"), { instructions: "x".repeat(24_001) })).toEqual([]);
  });

  it("ignores instruction text for CLIs that read a file", () => {
    expect(buildHarnessArgs(entry("kiro"), { instructions: "regras" })).toEqual([]);
  });

  it("leaves Muse without a resume flag", () => {
    expect(buildHarnessArgs(entry("muse"), { resumeSessionId: "abc" })).toEqual([]);
  });
});

describe("config rendering", () => {
  it("merges a JSON server and keeps the others", () => {
    const merged = JSON.parse(mergeJsonServer('{"mcpServers":{"other":{"url":"u"}},"x":1}', "mcpServers", { url: "c" })!);
    expect(merged).toEqual({ mcpServers: { other: { url: "u" }, codebrain: { url: "c" } }, x: 1 });
  });

  it("refuses to replace an unreadable JSON file", () => {
    expect(mergeJsonServer("{ not json", "mcpServers", { url: "c" })).toBeNull();
    expect(mergeJsonServer("[]", "mcpServers", { url: "c" })).toBeNull();
    expect(mergeJsonServer('{"mcpServers":["keep"]}', "mcpServers", { url: "c" })).toBeNull();
    expect(mergeJsonServer('{"mcpServers":"keep"}', "mcpServers", { url: "c" })).toBeNull();
  });

  it("seeds required keys without overriding existing ones", () => {
    expect(JSON.parse(mergeJsonServer(null, "mcp_servers", {}, { schema_version: 1 })!).schema_version).toBe(1);
    expect(JSON.parse(mergeJsonServer('{"schema_version":2}', "mcp_servers", {}, { schema_version: 1 })!).schema_version).toBe(2);
  });

  it("replaces only the codebrain TOML table", () => {
    const text = '[models]\ndefault = "grok-build"\n\n[mcp_servers.codebrain]\nurl = "old"\n\n[mcp_servers.codebrain.headers]\nA = "b"\n\n[mcp_servers.other]\nurl = "keep"\n';
    const next = upsertTomlMcpServer(text, "http://new");
    expect(next).toContain('default = "grok-build"');
    expect(next).toContain('[mcp_servers.other]\nurl = "keep"');
    expect(next).toContain('[mcp_servers.codebrain]\nurl = "http://new"');
    expect(next).not.toContain("old");
    expect(next).not.toContain("headers");
  });

  it("produces the same TOML when applied twice", () => {
    const once = upsertTomlMcpServer("", "http://a");
    expect(upsertTomlMcpServer(once, "http://a")).toBe(once);
  });

  it("adds an mcp_servers block to YAML and keeps comments", () => {
    const next = upsertHermesMcpServer("# meu config\nmodel: x\n", "http://u")!;
    expect(next).toContain("# meu config");
    expect(next).toContain('mcp_servers:\n  codebrain:\n    url: "http://u"');
  });

  it("updates the existing codebrain server and keeps siblings", () => {
    const yaml = 'a: 1\nmcp_servers:\n  other:\n    url: "keep"\n  codebrain:\n    url: "old"\nz: 2\n';
    const next = upsertHermesMcpServer(yaml, "http://new")!;
    expect(next).toContain('other:\n    url: "keep"');
    expect(next).toContain('codebrain:\n    url: "http://new"');
    expect(next).not.toContain('"old"');
    expect(next).toContain("z: 2");
    expect(next.indexOf("mcp_servers")).toBeLessThan(next.indexOf("z: 2"));
  });

  it("replaces an empty inline YAML map but refuses a populated one", () => {
    expect(upsertHermesMcpServer("mcp_servers: {}\n", "http://u")).toContain('codebrain:\n    url: "http://u"');
    expect(upsertHermesMcpServer("mcp_servers: {a: {url: b}}\n", "http://u")).toBeNull();
  });

  it("renders OpenCode inline config in the forms every version accepts", () => {
    const config = JSON.parse(buildOpencodeConfig({ mcpUrl: "http://u", promptFile: "C:\\tmp\\p.md", skipPermissions: true }));
    expect(config.mcp.codebrain).toEqual({ type: "remote", url: "http://u", enabled: true, oauth: false });
    expect(config.instructions).toEqual(["C:/tmp/p.md"]);
    expect(config.permission).toBe("allow");
    expect(JSON.parse(buildOpencodeConfig({}))).toEqual({});
  });

  it("resolves the Hermes home per platform", () => {
    expect(hermesHome({ HERMES_HOME: "/x" }, "linux", "/h")).toBe("/x");
    expect(hermesHome({}, "linux", "/h")).toBe("/h/.hermes");
    expect(hermesHome({ LOCALAPPDATA: "C:\\L" }, "win32", "C:\\h")).toBe("C:\\L\\hermes");
  });
});
