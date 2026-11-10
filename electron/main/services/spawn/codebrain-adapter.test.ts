// @vitest-environment node
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachCodebrainContext, discoverCodebrainContext, prepareCodebrainAdapter, writeSharedCodebrainGuide } from "./codebrain-adapter";
import { catalogInstructions, copyCatalogTo, getAgentInstructions, preferredCatalogInstall, scanCatalog, setCatalogMeta } from "../catalog";
import { CLI_REGISTRY } from "./cli-registry";

let taskDir: string;
let workspace: string;
const write = (relative: string, text: string | Buffer) => {
  const file = path.join(workspace, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};
const skill = (name: string) => {
  const base = `.codebrain/skills/${name}`;
  write(`${base}/skill.json`, JSON.stringify({ id: name, description: `${name} task`, entrypoint: "guide/start.md", credentials: "DO_NOT_SERIALIZE_MANIFEST" }));
  write(`${base}/guide/start.md`, `Use ${name}; read ../references/details.md and ../scripts/check.js`);
  write(`${base}/scripts/check.js`, "export const check = true;");
  write(`${base}/assets/pixel.bin`, Buffer.from([0, 255, 17, 128]));
  write(`${base}/references/details.md`, "Details");
  write(`${base}/.env`, "PRIVATE_ENV=secret");
  write(`${base}/vault/key.txt`, "VAULT_SECRET");
  write(`${base}/tmp/cache.txt`, "CACHE_SECRET");
  write(`${base}/credentials.json`, "CREDENTIAL_SECRET");
};
const prepare = (agent = "opencode", extra: Partial<Parameters<typeof prepareCodebrainAdapter>[0]> = {}) => prepareCodebrainAdapter({
  cwd: workspace, paneId: "pane-a", agent, allowedSkills: ["alpha"],
  env: { ...process.env, CODEX_HOME: path.join(taskDir, ".codex"), CLAUDE_CONFIG_DIR: path.join(taskDir, ".claude"), HERMES_HOME: path.join(taskDir, ".hermes"), XDG_CONFIG_HOME: path.join(taskDir, ".config") },
  ...extra,
});

beforeEach(() => {
  taskDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-adapter-test-"));
  workspace = path.join(taskDir, "project");
  fs.mkdirSync(workspace);
  vi.stubEnv("HOME", taskDir);
  vi.stubEnv("USERPROFILE", taskDir);
  vi.stubEnv("HERMES_HOME", path.join(taskDir, ".hermes"));
  vi.stubEnv("XDG_CONFIG_HOME", path.join(taskDir, ".config"));
  skill("alpha");
  skill("beta");
});
afterEach(() => {
  vi.unstubAllEnvs();
  if (path.dirname(path.resolve(taskDir)) !== path.resolve(os.tmpdir()) || !path.basename(taskDir).startsWith("cb-adapter-test-")) throw new Error("Unexpected cleanup target");
  fs.rmSync(taskDir, { recursive: true, force: true });
});

describe("Codebrain host discovery and portability", () => {
  it("records manifest entrypoints, origins and all safe resources", () => {
    const item = scanCatalog(workspace).find(item => item.name === "alpha")!;
    const install = preferredCatalogInstall(item, workspace);
    expect(install).toMatchObject({ cli: "codebrain", entrypoint: "guide/start.md", sourceRoot: path.join(workspace, ".codebrain/skills/alpha") });
    expect(install.resources).toContain(path.join("assets", "pixel.bin"));
    expect(install.resources).toContain(path.join("scripts", "check.js"));
    expect(install.resources?.join(" ")).not.toMatch(/\.env|vault|tmp|credentials/);
    expect(catalogInstructions(install)).toContain("Use alpha");
  });

  it("reads only named context/map/workflow docs and redacts credential values", () => {
    write(".codebrain/context.md", "Project context\nAPI_KEY=SUPER_PRIVATE\nhttps://user:pass@example.test");
    write(".codebrain/repository-map.json", '{"paths":["src"]}');
    write(".codebrain/workflow/release.md", "Review before release");
    write(".codebrain/workflow/vault/private.md", "NEVER_READ");
    write(".codebrain/.env", "NEVER_ENV");
    write(".codebrain/accounts.json", "NEVER_ACCOUNT");
    expect(discoverCodebrainContext(workspace)).toHaveLength(3);
    const result = prepare();
    expect(result.codebrainContext).toContain("Project context");
    expect(result.codebrainContext).not.toMatch(/SUPER_PRIVATE|user:pass|NEVER_/);
    const indexText = fs.readFileSync(result.codebrainCatalogPath, "utf8");
    expect(indexText).not.toMatch(/DO_NOT_SERIALIZE_MANIFEST|SUPER_PRIVATE|NEVER_|credentials\.json|vault/);
    const docs = JSON.parse(indexText).documents;
    expect(docs).toHaveLength(3);
    expect(fs.readFileSync(docs.find((doc: any) => doc.kind === "context").path, "utf8")).not.toContain("SUPER_PRIVATE");
  });

  it.each(CLI_REGISTRY.map(entry => entry.id))("ports authorized assets for %s without any CLI flags", agent => {
    const result = prepare(agent);
    expect(result.allowedSkills).toEqual(["alpha"]);
    const index = JSON.parse(fs.readFileSync(result.codebrainCatalogPath, "utf8"));
    expect(index.host).toBe("codebrain");
    expect(index.items.map((item: any) => item.name)).toEqual(["alpha"]);
    const bundle = path.dirname(index.items[0].entrypoint);
    expect(fs.readFileSync(path.join(bundle, "assets/pixel.bin"))).toEqual(Buffer.from([0, 255, 17, 128]));
    expect(fs.readFileSync(path.join(bundle, "scripts/check.js"), "utf8")).toContain("check = true");
    expect(JSON.parse(fs.readFileSync(path.join(bundle, "skill.json"), "utf8"))).not.toHaveProperty("credentials");
    expect(fs.readFileSync(path.join(bundle, "SKILL.md"), "utf8")).toContain("Use alpha");
    expect(fs.existsSync(path.join(bundle, ".env"))).toBe(false);
    expect(result.codebrainContext).not.toContain('"beta"');
    expect(result).not.toHaveProperty("args");
  });

  it("applies task and selected-agent skill limits together, including explicit empty", () => {
    write(".codebrain/agents/reviewer.md", "---\nname: reviewer\n---\n\nOnly review; do not implement.");
    setCatalogMeta({ kind: "agent", name: "reviewer", allowedSkills: ["alpha"] });
    const result = prepare("opencode", { agentName: "reviewer", allowedSkills: ["alpha", "beta"] });
    expect(result.allowedSkills).toEqual(["alpha"]);
    expect(result.codebrainContext).toContain("Only review; do not implement.");
    expect(prepare("opencode", { agentName: "reviewer", allowedSkills: ["beta"] }).allowedSkills).toEqual([]);
    expect(prepare("opencode", { allowedSkills: [] }).allowedSkills).toEqual([]);
    setCatalogMeta({ kind: "agent", name: "reviewer", disabled: true });
    expect(() => prepare("opencode", { agentName: "reviewer" })).toThrow(/ausente ou desativado/);
  });

  it("discovers agent manifests and copies personas as skill-compatible bundles", () => {
    write(".codebrain/agents/reviewer/agent.json", JSON.stringify({ id: "reviewer", entrypoint: "instructions.md", allowedSkills: ["alpha"] }));
    write(".codebrain/agents/reviewer/instructions.md", "Review persona");
    write(".codebrain/agents/reviewer/references/rules.md", "Review rules");
    expect(getAgentInstructions("reviewer", workspace)).toBe("Review persona");
    expect(prepare("opencode", { agentName: "reviewer", allowedSkills: ["alpha", "beta"] }).allowedSkills).toEqual(["alpha"]);
    const result = copyCatalogTo("reviewer", "kiro", workspace, "agent");
    expect(result.mode).toBe("skill-persona");
    expect(fs.readFileSync(path.join(result.copied[0], "references/rules.md"), "utf8")).toBe("Review rules");
    expect(fs.readFileSync(path.join(result.copied[0], "SKILL.md"), "utf8")).toContain("Review persona");
    expect(copyCatalogTo("reviewer", "opencode", workspace, "agent").mode).toBe("codebrain-files");
    expect(copyCatalogTo("reviewer", "codebrain", workspace, "agent").mode).toBe("codebrain-files");
    expect(getAgentInstructions("reviewer", workspace)).toBe("Review persona");
  });

  it("copyTo preserves user bundles and shared instruction/permission files", () => {
    const original = write(".claude/skills/alpha/SKILL.md", "USER VERSION");
    write("AGENTS.md", "USER INSTRUCTIONS");
    write(".claude/settings.json", '{"permissions":{"deny":["Bash"]}}');
    prepare("claude");
    expect(fs.readFileSync(original, "utf8")).toBe("USER VERSION");
    expect(fs.readFileSync(path.join(workspace, "AGENTS.md"), "utf8")).toBe("USER INSTRUCTIONS");
    expect(fs.readFileSync(path.join(workspace, ".claude/settings.json"), "utf8")).toBe('{"permissions":{"deny":["Bash"]}}');
  });

  it("shared guides never overwrite user instructions or carry a pane persona", () => {
    const userRule = write(".cursor/rules/codebrain.mdc", "USER_RULE");
    expect(writeSharedCodebrainGuide(userRule)).toBe(false);
    expect(fs.readFileSync(userRule, "utf8")).toBe("USER_RULE");
    const guide = path.join(workspace, ".gemini/codebrain-context.md");
    expect(writeSharedCodebrainGuide(guide)).toBe(true);
    expect(fs.readFileSync(guide, "utf8")).not.toContain("pane-a");
    expect(writeSharedCodebrainGuide(guide)).toBe(false);
  });

  it("rejects traversal entrypoints and omits external symlinks", () => {
    write(".codebrain/skills/escape/skill.json", JSON.stringify({ id: "escape", entrypoint: "../../vault/secret.md" }));
    write(".codebrain/vault/secret.md", "TOP_SECRET");
    const install = preferredCatalogInstall(scanCatalog(workspace).find(item => item.name === "escape")!, workspace);
    expect(install.entrypoint).toBeUndefined();
    const outside = path.join(taskDir, "private");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "private.md"), "EXTERNAL_SECRET");
    fs.symlinkSync(outside, path.join(workspace, ".codebrain/skills/alpha/outside"), "junction");
    const result = prepare();
    expect(fs.readFileSync(result.codebrainCatalogPath, "utf8")).not.toContain("outside");
  });

  it("does not reintroduce the legacy unfiltered lazy skill list", () => {
    const legacy = "BASE\n\n## Skills (lazy)\nLoad a matching skill with `skill_get({ id })` before using it.\n\n| forbidden | other skill |";
    const text = attachCodebrainContext(legacy, prepare("opencode", { allowedSkills: [] }).codebrainContext);
    expect(text).toContain("BASE");
    expect(text).not.toContain("forbidden");
    expect(text).toContain("Only these skills are authorized for this pane: []");
  });
});
