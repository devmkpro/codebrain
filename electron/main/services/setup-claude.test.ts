// @vitest-environment node
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ appPath: "", home: "", packaged: true, version: "2.0.1" }));
vi.mock("electron", () => ({ app: { getAppPath: () => fixture.appPath, getVersion: () => fixture.version, get isPackaged() { return fixture.packaged; } } }));
vi.mock("electron-log/main.js", () => ({ default: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("node:os", async importOriginal => ({ ...await importOriginal<typeof import("node:os")>(), homedir: () => fixture.home }));
vi.mock("./mcp-runtime", () => ({
  resolveStdioEntry: () => path.join(fixture.appPath, "packages", "mcp", "stdio.js"),
  buildStdioServerConfig: () => ({ command: "fixture-electron.exe", args: [path.join(fixture.appPath, "packages", "mcp", "stdio.js")], env: { ELECTRON_RUN_AS_NODE: "1" } }),
  isStdioConfigCurrent: () => false,
}));
import { readCodebrainMetadata, ensureClaudeWorkspaceSettings, setupClaudeIntegration, syncClaudeSettingsVersion } from "./setup-claude";

let root: string;
let resources: string;
let oldResources: PropertyDescriptor | undefined;
const writeJson = (file: string, value: unknown) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-claude-setup-"));
  resources = path.join(root, "resources");
  fixture.appPath = path.join(resources, "app.asar"); fixture.home = path.join(root, "isolated-home"); fixture.packaged = true; fixture.version = "2.0.1";
  fs.mkdirSync(fixture.home, { recursive: true });
  writeJson(path.join(fixture.appPath, "package.json"), { version: "2.0.1" });
  fs.mkdirSync(path.join(fixture.appPath, "packages", "mcp"), { recursive: true });
  fs.writeFileSync(path.join(fixture.appPath, "packages", "mcp", "index.js"), 'server.tool("a");\nserver.tool("b");\nserver.tool("c");');
  oldResources = Object.getOwnPropertyDescriptor(process, "resourcesPath");
  Object.defineProperty(process, "resourcesPath", { configurable: true, value: resources });
});
afterEach(() => {
  if (oldResources) Object.defineProperty(process, "resourcesPath", oldResources); else delete (process as any).resourcesPath;
  if (path.dirname(path.resolve(root)) === path.resolve(os.tmpdir())) fs.rmSync(root, { recursive: true, force: true });
});

describe("Claude setup runtime metadata", () => {
  it("reads package and tools from app.asar, not the bare resources directory", () => {
    writeJson(path.join(resources, "package.json"), { version: "0.0.1" });
    expect(readCodebrainMetadata()).toEqual({ version: "2.0.1", totalTools: 3 });
  });

  it("fixes existing global placeholders using the ASAR source, preserving user settings", () => {
    const file = path.join(fixture.home, ".claude", "settings.json");
    writeJson(file, { permissions: { keep: true }, env: { CUSTOM: "keep", CODEBRAIN_VERSION: "unknown" }, codebrain: { version: "unknown", mcp: { totalTools: 0, custom: true } } });
    syncClaudeSettingsVersion();
    expect(readJson(file)).toMatchObject({ permissions: { keep: true }, env: { CUSTOM: "keep", CODEBRAIN_VERSION: "2.0.1" }, codebrain: { version: "2.0.1", mcp: { totalTools: 3, custom: true } } });
  });

  it("installs correct metadata and keeps the Electron RUN_AS_NODE stdio contract", () => {
    writeJson(path.join(resources, "codebrain-claude", "settings.json"), { statusLine: { type: "command", command: "fixture-statusline" }, codebrain: { version: "unknown", mcp: { totalTools: 0 } } });
    setupClaudeIntegration();
    expect(readJson(path.join(fixture.home, ".claude", "settings.json"))).toMatchObject({ env: { CODEBRAIN_VERSION: "2.0.1" }, codebrain: { version: "2.0.1", mcp: { totalTools: 3 } } });
    expect(readJson(path.join(fixture.home, ".mcp.json"))).toMatchObject({ mcpServers: { codebrain: { command: "fixture-electron.exe", args: [path.join(fixture.appPath, "packages", "mcp", "stdio.js")], env: { ELECTRON_RUN_AS_NODE: "1" } } } });
  });

  it("shares authoritative metadata with workspace settings without losing nested fields", () => {
    const cwd = path.join(root, "workspace");
    const file = path.join(cwd, ".claude", "settings.json");
    writeJson(file, { permissions: { keep: true }, env: { CUSTOM: "keep" }, codebrain: { custom: true, mcp: { custom: true } } });
    ensureClaudeWorkspaceSettings(cwd);
    expect(readJson(file)).toMatchObject({ permissions: { keep: true }, env: { CUSTOM: "keep", CODEBRAIN_VERSION: "2.0.1" }, codebrain: { version: "2.0.1", custom: true, mcp: { totalTools: 3, custom: true } } });
  });

  it("uses the dev app root independently of cwd or the bundled module directory", () => {
    fixture.packaged = false;
    expect(readCodebrainMetadata()).toEqual({ version: "2.0.1", totalTools: 3 });
  });

  it("falls back to app version and unpacked source, never downgrades known metadata to unknown/zero", () => {
    fs.rmSync(path.join(fixture.appPath, "package.json"));
    fs.rmSync(path.join(fixture.appPath, "packages", "mcp", "index.js"));
    const source = path.join(resources, "app.asar.unpacked", "packages", "mcp", "index.js");
    fs.mkdirSync(path.dirname(source), { recursive: true }); fs.writeFileSync(source, 'server.tool("unpacked");');
    expect(readCodebrainMetadata()).toEqual({ version: "2.0.1", totalTools: 1 });
    fs.rmSync(source); fixture.version = "unknown";
    const cwd = path.join(root, "workspace"); const file = path.join(cwd, ".claude", "settings.json");
    writeJson(file, { env: { CODEBRAIN_VERSION: "2.0.0" }, codebrain: { version: "2.0.0", mcp: { totalTools: 12 } } });
    ensureClaudeWorkspaceSettings(cwd);
    expect(readJson(file)).toEqual({ env: { CODEBRAIN_VERSION: "2.0.0" }, codebrain: { version: "2.0.0", mcp: { totalTools: 12 } } });
  });
});
