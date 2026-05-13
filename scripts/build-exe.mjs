/**
 * Build script for Windows .exe packaging
 * Uses @electron/packager (no winCodeSign / no admin needed)
 * Then zips the result for a portable distribution.
 *
 * Usage:
 *   node scripts/build-exe.mjs              → portable .zip
 *   node scripts/build-exe.mjs --installer  → also tries NSIS installer (needs admin)
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, cpSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import * as fs from "node:fs";
import * as path from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIST = join(ROOT, "dist");
const PKG_JSON = JSON.parse(fs.readFileSync(join(ROOT, "package.json"), "utf-8"));
const VERSION = PKG_JSON.version;
const PRODUCT = PKG_JSON.productName ?? "Codebrain";

// ── Step 1: Build renderer + main ────────────────────────────────────────────
console.log("\n[1/3] Building renderer + main process...");
const buildResult = spawnSync("npx", ["electron-vite", "build"], {
  cwd: ROOT, stdio: "inherit", shell: true,
});
if (buildResult.status !== 0) process.exit(buildResult.status ?? 1);

// ── Step 2: Package with @electron/packager ───────────────────────────────────
console.log("\n[2/3] Packaging with @electron/packager...");

const outDir = join(DIST, `${PRODUCT}-win32-x64`);
if (existsSync(outDir)) rmSync(outDir, { recursive: true });

const packagerArgs = [
  "electron-packager",
  ROOT,
  PRODUCT,
  "--platform=win32",
  "--arch=x64",
  `--out=${DIST}`,
  "--overwrite",
  "--no-prune",
  "--asar",
  "--asar-unpack=**/{*.node,@lydell}/**",
  `--app-version=${VERSION}`,
  `--build-version=${VERSION}`,
  "--ignore=node_modules/@babel",
  "--ignore=scripts",
  "--ignore=src",
  "--ignore=electron",
  "--ignore=\\.git",
  "--ignore=\\.env",
  "--ignore=dist",
  "--ignore=renderer-bundle\\.js",
  "--ignore=main-bundle\\.js",
  "--ignore=preload-bundle\\.js",
];

// Add icon if it exists
const iconPath = join(ROOT, "resources", "icon.ico");
if (existsSync(iconPath)) packagerArgs.push(`--icon=${iconPath}`);

const packResult = spawnSync("npx", packagerArgs, {
  cwd: ROOT, stdio: "inherit", shell: true,
});
if (packResult.status !== 0) process.exit(packResult.status ?? 1);

// ── Step 3: Create .zip ───────────────────────────────────────────────────────
console.log("\n[3/3] Creating portable .zip...");

const zipName = `${PRODUCT}-${VERSION}-win-x64.zip`;
const zipPath = join(DIST, zipName);

// Use PowerShell's Compress-Archive (available on all Win 10+)
const psResult = spawnSync("powershell", [
  "-Command",
  `Compress-Archive -Path '${outDir}' -DestinationPath '${zipPath}' -Force`,
], { stdio: "inherit", shell: false });

if (psResult.status === 0) {
  console.log(`\n✓ Built: dist/${zipName}`);
  console.log(`  Unzip and run ${PRODUCT}.exe to launch.`);
} else {
  console.warn("  Could not create zip (PowerShell error). The unpacked app is at:");
  console.warn(`  ${outDir}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\nDone! Files in dist/:");
try {
  fs.readdirSync(DIST).forEach((f) => console.log("  •", f));
} catch {}

console.log(`
To create an NSIS installer (.exe setup), run this as Administrator:
  npm run dist:win
`);
