import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const linter = join(root, "scripts", "lint-artifact.mjs");
const contract = JSON.parse(readFileSync(join(root, "rules", "contract.json"), "utf8"));

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "cb-dna-lint-"));
  t.after(() => {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("cb-dna-lint-"));
    rmSync(dir, { recursive: true, force: true });
  });
  for (const file of contract.requiredFiles) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), file.endsWith(".json") ? "{}" : "Isolated provided fixture\n");
  }
  const css = "/* A1-identity A1-structure A2 B-slot */\n:root { --accent: #a43b12; }\n";
  writeFileSync(join(dir, "tokens.css"), css);
  writeFileSync(join(dir, "tailwind-v4.css"), "@theme { --accent: #a43b12; }\n");
  writeFileSync(join(dir, "design-tokens.json"), JSON.stringify({ accent: { value: "#a43b12", confidence: "provided", source: "isolated local fixture" } }));
  writeFileSync(join(dir, "components.manifest.json"), JSON.stringify({ selectors: [".button:hover", ".button:active", ".button:focus-visible"], states: [...contract.requiredStates.data, ...contract.requiredStates.form] }));
  return dir;
}

function lint(dir) {
  const result = spawnSync(process.execPath, [linter, dir], { encoding: "utf8", windowsHide: true, timeout: 10000 });
  assert.equal(result.error, undefined);
  return result;
}

test("isolated complete static fixture passes all imported P0/P1 gates without motion", (t) => {
  const result = lint(fixture(t));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /P0: 4\/4 pass.*P1: 3\/3 pass/);
});

test("forbidden accent fails instead of silently accepting a rebranded artifact", (t) => {
  const dir = fixture(t);
  writeFileSync(join(dir, "tokens.css"), ":root { --accent: #6366f1; }\n");
  const result = lint(dir);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /\[FAIL\] no-indigo-accent/);
});

test("unattributed tokens fail provenance", (t) => {
  const dir = fixture(t);
  writeFileSync(join(dir, "design-tokens.json"), JSON.stringify({ accent: { value: "#a43b12" } }));
  const result = lint(dir);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /\[FAIL\] token-provenance/);
});

test("motion capture requires its derived kit and actual keyframe bodies", (t) => {
  const dir = fixture(t);
  writeFileSync(join(dir, "source", "motion.json"), JSON.stringify({ source: { captureMode: "isolated-fixture" }, keyframes: [{ name: "move", offsets: [{ offset: "0%", properties: { opacity: "0" } }, { offset: "100%", properties: { opacity: "1" } }] }] }));
  const result = lint(dir);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /\[FAIL\] motion-derived-files/);
  assert.match(result.stdout, /\[PASS\] motion-keyframe-bodies/);
});

test("missing required files fail and invalid directories keep usage exit 2", (t) => {
  const dir = fixture(t);
  const empty = join(dir, "empty");
  mkdirSync(empty);
  const missing = lint(empty);
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /\[FAIL\] required-files/);
  assert.equal(lint(join(dir, "not-created")).status, 2);
});
