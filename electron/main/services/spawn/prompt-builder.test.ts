import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./prompt-builder";
import { CLI_REGISTRY } from "./cli-registry";

const temporaryDirs: string[] = [];

function makeContext() {
  return {
    providerStore: { listFull: () => [] },
    ptyManager: { list: () => [] },
    detachedPaneIds: new Set<string>(),
    workspaceConfigStore: { getAccessMode: () => "workspace" },
  } as any;
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("prompt builder token budget", () => {
  it("keeps the base prompt below its unchanged budget with SSH/MCP safety intact", () => {
    const prompt = fs.readFileSync(path.resolve("prompts/codebrain-system.md"), "utf8");
    expect(Buffer.byteLength(prompt, "utf8")).toBeLessThanOrEqual(3_000);
    for (const contract of ["mcp__codebrain__*", "scraping_*", "session_id", "never use host",
      "deployment docs/CI", "project-to-host mapping", "authorized access vault",
      "cb-ssh-operations", "cb-safe-deploy", "preserve jobs, data and rollback",
      "Never run `git add`", "pane_spawn", "verify_plan", "verify_run", "never guess a password",
      "OK|PART|FAIL|BLOCK"]) expect(prompt).toContain(contract);
  });

  it("discovers large catalogs lazily without copying descriptions or triggers into the prompt", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "codebrain-prompt-"));
    temporaryDirs.push(cwd);
    const description = "DESIGN_CATALOG_SENTINEL " + "á|\n".repeat(500);
    for (let index = 0; index < 40; index++) {
      const dir = path.join(cwd, ".codebrain", "skills", `design-${index}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "skill.json"), JSON.stringify({
        id: `design-${index}`, name: `Design ${index}`, description, triggers: ["LONG_TRIGGER_SENTINEL".repeat(50)],
      }));
    }
    const prompt = fs.readFileSync(buildSystemPrompt(makeContext(), { paneId: "lazy", cwd, role: "worker" }), "utf8");
    expect(Buffer.byteLength(prompt, "utf8")).toBeLessThan(8_000);
    expect(prompt).toContain("skill_list");
    expect(prompt).toContain("skill_get({ id })");
    expect(prompt).not.toContain("DESIGN_CATALOG_SENTINEL");
    expect(prompt).not.toContain("LONG_TRIGGER_SENTINEL");
    // Lazy discovery must not delete or truncate the actual skill resources.
    expect(JSON.parse(fs.readFileSync(path.join(cwd, ".codebrain", "skills", "design-0", "skill.json"), "utf8")).description).toBe(description);
  });

  it.each(CLI_REGISTRY.map((entry) => entry.id))(
    "keeps the %s worker prompt compact and lazy",
    (agent) => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "codebrain-prompt-"));
      temporaryDirs.push(cwd);
      const promptFile = buildSystemPrompt(makeContext(), {
        paneId: "p1",
        cwd,
        agent,
        role: "worker",
      });
      const prompt = fs.readFileSync(promptFile, "utf8");

      expect(Buffer.byteLength(prompt, "utf8")).toBeLessThan(8_000);
      expect(prompt).not.toContain("mcp__codebrain__mcp__codebrain__");
      expect(prompt).toContain("Direct conversation needs no bootstrap");
      expect(prompt).toContain("OK|PART|FAIL|BLOCK");
      expect(prompt).not.toContain("[MK MODE]");
      expect(prompt).not.toContain("MK MODE — Operational Core");
    }
  );
});
