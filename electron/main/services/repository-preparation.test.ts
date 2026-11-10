// @vitest-environment node
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getRepositoryPreparationStatus, prepareRepository } from "./repository-preparation";

let root: string;
let outside: string | undefined;
const write = (file: string, content: string) => {
  const target = join(root, ".codebrain", file);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content);
};
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "codebrain-preparation-test-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (outside) rmSync(outside, { recursive: true, force: true });
  outside = undefined;
  vi.unstubAllGlobals();
});

it("does not mark partial preparation as complete", () => {
  write("context.md", "");
  expect(getRepositoryPreparationStatus(root).initialized).toBe(false);
  write("context.md", "Project context");
  write("baseline.json", JSON.stringify({ stack: [], commands: [] }));
  expect(getRepositoryPreparationStatus(root).initialized).toBe(false);
  write("repository-map.md", "Project map");
  write("workflow.md", "Project workflow");
  expect(getRepositoryPreparationStatus(root).initialized).toBe(false);
  write("skills/custom-project/SKILL.md", "Project-specific guidance");
  expect(getRepositoryPreparationStatus(root).initialized).toBe(false);
  write("baseline.json", "{}");
  expect(getRepositoryPreparationStatus(root).initialized).toBe(false);
  write("baseline.json", "invalid JSON");
  expect(getRepositoryPreparationStatus(root).initialized).toBe(false);
});

it("prepares an offline fixture with native skills consumable by the real MCP loader and working scripts", async () => {
  const network = vi.fn(() => {
    throw new Error("offline");
  });
  vi.stubGlobal("fetch", network);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "fixture",
      scripts: { test: "node -e \"console.log('fixture verified')\"" },
      dependencies: { react: "*" },
      devDependencies: { typescript: "*" },
    })
  );
  const result = prepareRepository(root);
  expect(result.ok).toBe(true);
  expect(result.initialized).toBe(true);
  expect(result.skills.map((skill) => skill.id)).toEqual(
    expect.arrayContaining(["project-conventions", "test-and-verify", "react-frontend"])
  );
  expect(result.commands).toEqual(["npm run test"]);
  const { createSkillHandlers } = createRequire(import.meta.url)(
    "../../../packages/mcp/bridge/skill-handlers.js"
  );
  const bridge = createSkillHandlers({ getCurrentWorkspacePath: () => root });
  const listed = await bridge.skillList({ scope: "project" });
  expect(listed.map((skill: { id: string }) => skill.id)).toEqual(
    expect.arrayContaining(["project-conventions", "test-and-verify", "react-frontend"])
  );
  const skill = await bridge.skillGet({ scope: "project", id: "test-and-verify" });
  expect(skill.ok).toBe(true);
  expect(skill.content[skill.manifest.entrypoint]).toContain(".codebrain/scripts/verify.cjs");
  expect(
    execFileSync(process.execPath, [join(root, ".codebrain/scripts/context.cjs")], {
      encoding: "utf8",
      cwd: tmpdir(),
    })
  ).toContain("React");
  expect(
    execFileSync(process.execPath, [join(root, ".codebrain/scripts/verify.cjs"), "--list"], {
      encoding: "utf8",
      cwd: tmpdir(),
    }).trim()
  ).toBe("npm run test");
  expect(
    execFileSync(process.execPath, [join(root, ".codebrain/scripts/verify.cjs"), "--run", "test"], {
      encoding: "utf8",
      cwd: tmpdir(),
    })
  ).toContain("fixture verified");
  expect(readFileSync(join(root, ".codebrain/baseline.json"), "utf8")).toContain(
    '"verification": "not-run"'
  );
  expect(network).not.toHaveBeenCalled();
  expect(existsSync(join(root, ".git"))).toBe(false);
});

it("preserves human context and repairs legacy markdown-only skills without overwriting them", () => {
  write("context.md", "Human decisions stay here.");
  write("skills/project-conventions/SKILL.md", "Human conventions.");
  expect(prepareRepository(root).initialized).toBe(true);
  expect(readFileSync(join(root, ".codebrain/context.md"), "utf8")).toBe(
    "Human decisions stay here."
  );
  expect(readFileSync(join(root, ".codebrain/skills/project-conventions/SKILL.md"), "utf8")).toBe(
    "Human conventions."
  );
  expect(prepareRepository(root).created).toEqual([]);
});

it("reports malformed existing native skill instead of claiming completion or overwriting it", () => {
  write("skills/project-conventions/skill.json", "broken JSON");
  const result = prepareRepository(root);
  expect(result.ok).toBe(false);
  expect(result.initialized).toBe(false);
  expect(result.error).toContain("project-conventions/skill.json");
  expect(readFileSync(join(root, ".codebrain/skills/project-conventions/skill.json"), "utf8")).toBe(
    "broken JSON"
  );
  expect(existsSync(join(root, ".codebrain/baseline.json"))).toBe(false);
});

it("does not mark preparation complete when a native entrypoint or helper is missing", () => {
  expect(prepareRepository(root).initialized).toBe(true);
  rmSync(join(root, ".codebrain/skills/test-and-verify/SKILL.md"));
  expect(getRepositoryPreparationStatus(root).initialized).toBe(false);
  expect(prepareRepository(root).initialized).toBe(true);
  rmSync(join(root, ".codebrain/scripts/verify.cjs"));
  expect(getRepositoryPreparationStatus(root).initialized).toBe(false);
});

it("refuses symbolic-link destinations and leaves the outside fixture untouched", () => {
  outside = mkdtempSync(join(tmpdir(), "codebrain-preparation-outside-"));
  symlinkSync(outside, join(root, ".codebrain"), "junction");
  const result = prepareRepository(root);
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/link simbólico/);
  expect(existsSync(join(outside, "context.md"))).toBe(false);
});

it("uses the project package manager and does not invent a composer test script", () => {
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ packageManager: "pnpm@10", scripts: { test: "vitest" } })
  );
  writeFileSync(
    join(root, "composer.json"),
    JSON.stringify({ require: { "laravel/framework": "*" } })
  );
  const result = prepareRepository(root);
  expect(result.commands).toEqual(["pnpm run test"]);
  expect(result.stack).toContain("Laravel");
});

it("rejects invalid project metadata before writing preparation files", () => {
  writeFileSync(join(root, "package.json"), "invalid");
  expect(prepareRepository(root).error).toMatch(/package.json inválido/);
  expect(existsSync(join(root, ".codebrain"))).toBe(false);
});
