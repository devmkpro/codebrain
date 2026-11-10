// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as asar from "@electron/asar";

const require = createRequire(import.meta.url);
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cleanup = [];
const schema = versions => `const migrations = [${versions.map(version => `{ version: ${version}, name: "v${version}", up() {} }`).join(",")}];\nmodule.exports = { migrations };\nthrow new Error("Never execute packaged schema code");\n`;

afterEach(() => {
  for (const dir of cleanup.splice(0)) {
    expect(path.dirname(dir)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(dir)).toMatch(/^cb-pack-schema-/);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function fixture({ old = false, change, versions = [1, 2, 3, 4], platform = "win32" } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cb-pack-schema-"));
  cleanup.push(temp);
  const sourceRoot = path.join(temp, "source");
  const staged = path.join(temp, "staged");
  const appOutDir = path.join(temp, "output");
  const resources = platform === "darwin" ? path.join(appOutDir, "Codebrain.app", "Contents", "Resources") : path.join(appOutDir, "resources");
  const files = {
    "package.json": JSON.stringify({ name: "codebrain", version: "2.0.1" }),
    "packages/memory/schema-migrations.js": schema(versions),
    "packages/memory/store.js": 'throw new Error("Never execute packaged store code");\n',
    "packages/memory/migrations.js": 'throw new Error("Never execute packaged migration runner");\n',
  };
  for (const [name, content] of Object.entries(files)) {
    for (const root of [sourceRoot, staged]) {
      const file = path.join(root, ...name.split("/"));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
  }
  if (old) {
    fs.writeFileSync(path.join(staged, "package.json"), JSON.stringify({ name: "codebrain", version: "1.21.5" }));
    fs.writeFileSync(path.join(staged, "packages", "memory", "schema-migrations.js"), schema([1, 2, 3]));
  }
  if (change) fs.appendFileSync(path.join(staged, "packages", "memory", change), "// stale packaged bytes\n");
  fs.mkdirSync(resources, { recursive: true });
  await asar.createPackage(staged, path.join(resources, "app.asar"));
  return { appOutDir, electronPlatformName: platform, packager: { projectDir: sourceRoot, appInfo: { productFilename: "Codebrain" } } };
}

function configuredHook() {
  const config = JSON.parse(fs.readFileSync(path.join(project, "package.json"), "utf8"));
  // Before the guard exists, electron-builder has no afterPack validation.
  return config.build.afterPack ? require(path.resolve(project, config.build.afterPack)) : async () => undefined;
}

it("rejects the old installed-style ASAR (1.21.5/schema 3) against 2.0.1/schema 4", async () => {
  await expect(configuredHook()(await fixture({ old: true }))).rejects.toThrow(/version|schema/i);
});

it.each(["store.js", "migrations.js", "schema-migrations.js"])("rejects a stale %s even when package version matches", async change => {
  await expect(configuredHook()(await fixture({ change }))).rejects.toThrow(new RegExp(change.replaceAll(".", "\\.")));
});

it.each(["win32", "linux", "darwin"])("accepts byte-identical %s ASAR without executing packaged modules", async platform => {
  await expect(configuredHook()(await fixture({ platform }))).resolves.toBeUndefined();
});

it("rejects schema 3 even if both source and ASAR are identically stale", async () => {
  await expect(configuredHook()(await fixture({ versions: [1, 2, 3] }))).rejects.toThrow(/migration.*4|schema.*4/i);
});

it("rejects non-contiguous migration versions using static validation", async () => {
  await expect(configuredHook()(await fixture({ versions: [1, 2, 4] }))).rejects.toThrow(/contiguous|sequence/i);
});

it("does not mistake version 4 in comments for a real migration or evaluate expressions", () => {
  const { migrationVersions } = configuredHook();
  expect(() => migrationVersions(`/* version: 4 */ ${schema([1, 2, 3])}`)).toThrow(/migration.*4/i);
  expect(() => migrationVersions('const migrations = [{version: process.exit(99)}];')).toThrow(/literal integer/i);
  expect(() => migrationVersions('const migrations = [{version: 1, ...unknown}];')).toThrow(/spread/i);
});

it("fails closed when the packer provides no app.asar", async () => {
  const context = await fixture();
  const archive = path.join(context.appOutDir, "resources", "app.asar");
  fs.unlinkSync(archive);
  await expect(configuredHook()(context)).rejects.toThrow(/app.asar missing/i);
});
