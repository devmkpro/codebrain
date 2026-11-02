// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { getRepositoryPreparationStatus, prepareRepository } from "./repository-preparation";

let root: string;
const write = (file: string, content: string) => {
  const target = join(root, ".codebrain", file);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content);
};
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "codebrain-preparation-test-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

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
  expect(getRepositoryPreparationStatus(root).initialized).toBe(true);
  write("baseline.json", "{}");
  expect(getRepositoryPreparationStatus(root).initialized).toBe(false);
  write("baseline.json", "invalid JSON");
  expect(getRepositoryPreparationStatus(root).initialized).toBe(false);
});

it("recognizes the existing generator output as complete", () => {
  expect(prepareRepository(root).initialized).toBe(true);
});
