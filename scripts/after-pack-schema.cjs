"use strict";

// electron-builder afterPack gate. Reads source/archive bytes only: never
// require(), import(), eval() or vm-run code extracted from the application.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { parse } = require("@babel/parser");

const MEMORY_FILES = ["schema-migrations.js", "store.js", "migrations.js"];
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

/** Validate the literal migration catalog without evaluating its up() bodies. */
function migrationVersions(source) {
  const ast = parse(source, { sourceType: "script" });
  const declarations = ast.program.body.flatMap(node => node.type === "VariableDeclaration" && node.kind === "const" ? node.declarations : []);
  const catalog = declarations.find(node => node.id.type === "Identifier" && node.id.name === "migrations");
  if (catalog?.init?.type !== "ArrayExpression" || !catalog.init.elements.length) {
    throw new Error("schema migration catalog must be a non-empty literal array");
  }
  const versions = catalog.init.elements.map(entry => {
    if (entry?.type !== "ObjectExpression") throw new Error("schema migration entries must be literal objects");
    if (entry.properties.some(property => property.type === "SpreadElement" || property.computed)) {
      throw new Error("schema migration entries cannot use spread or computed properties");
    }
    const properties = entry.properties.filter(property =>
      (property.key.name === "version" || property.key.value === "version"));
    if (properties.length !== 1 || properties[0].type !== "ObjectProperty" || properties[0].value.type !== "NumericLiteral" || !Number.isSafeInteger(properties[0].value.value)) {
      throw new Error("schema migration version must be one literal integer per entry");
    }
    return properties[0].value.value;
  });
  if (versions.some((version, index) => version !== index + 1)) {
    throw new Error("schema migration sequence must be contiguous, starting at 1, without duplicates");
  }
  if (!versions.includes(4)) throw new Error("schema migration 4 must be included in this release");
  return versions;
}

/** Exported for read-only release audits and isolated ASAR regression fixtures. */
async function auditAsar(archive, sourceRoot) {
  const asar = await import("@electron/asar");
  archive = path.resolve(archive);
  sourceRoot = path.resolve(sourceRoot);
  if (!fs.existsSync(archive)) throw new Error(`[schema-after-pack] app.asar missing: ${archive}`);
  asar.uncache(archive);
  const readPacked = relative => {
    try { return asar.extractFile(archive, path.join(...relative.split("/"))); }
    catch (error) { throw new Error(`[schema-after-pack] Cannot read ${relative} from ${archive}: ${error.message}`); }
  };
  const expected = JSON.parse(fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8"));
  const packed = JSON.parse(readPacked("package.json").toString("utf8"));
  const errors = [];
  if (typeof expected.version !== "string" || !expected.version || packed.version !== expected.version) {
    errors.push(`package version mismatch: source=${expected.version}, ASAR=${packed.version}`);
  }
  let versions;
  const files = MEMORY_FILES.map(name => {
    const relative = `packages/memory/${name}`;
    const source = fs.readFileSync(path.join(sourceRoot, "packages", "memory", name));
    const packaged = readPacked(relative);
    if (!source.equals(packaged)) errors.push(`${relative} byte mismatch: source SHA256=${sha256(source)}, ASAR SHA256=${sha256(packaged)}`);
    if (name === "schema-migrations.js") {
      // Validate both, including a stale source tree copied identically to ASAR.
      for (const [label, bytes] of [["source", source], ["ASAR", packaged]]) {
        try { versions = migrationVersions(bytes.toString("utf8")); }
        catch (error) { errors.push(`${label} ${relative}: ${error.message}`); }
      }
    }
    return { path: relative, sha256: sha256(packaged) };
  });
  if (errors.length) throw new Error(`[schema-after-pack] Refusing stale/inconsistent package ${archive}:\n- ${errors.join("\n- ")}`);
  return { version: packed.version, schemaVersion: versions.at(-1), files };
}

async function afterPack(context) {
  if (!context?.appOutDir || !context.packager?.projectDir) {
    throw new Error("[schema-after-pack] Missing electron-builder appOutDir/projectDir context");
  }
  const resources = context.electronPlatformName === "darwin"
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
    : path.join(context.appOutDir, "resources");
  const result = await auditAsar(path.join(resources, "app.asar"), context.packager.projectDir);
  console.log(`[schema-after-pack] PASS version=${result.version} schema=${result.schemaVersion}; ${result.files.length} memory files byte-identical`);
}

module.exports = afterPack;
module.exports.auditAsar = auditAsar;
module.exports.migrationVersions = migrationVersions;
