#!/usr/bin/env node

/**
 * prebuild-native.mjs
 *
 * Copies the system Node.js-compiled better-sqlite3 native binary to
 * resources/native/ so it survives the electron-builder rebuild.
 *
 * Problem: electron-builder rebuilds better-sqlite3 for Electron's ABI,
 * overwriting the system Node.js binary. The MCP stdio server runs with
 * system Node.js and needs the system ABI binary.
 *
 * Solution: Copy the working binary BEFORE electron-builder runs.
 * Then store.js falls back to this binary when the default one fails.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const srcBinary = path.join(
  projectRoot,
  "node_modules",
  "better-sqlite3",
  "build",
  "Release",
  "better_sqlite3.node"
);

const destDir = path.join(projectRoot, "resources", "native");
const destBinary = path.join(destDir, "better_sqlite3.node");

try {
  if (!fs.existsSync(srcBinary)) {
    console.error(
      "[prebuild-native] Source binary not found:",
      srcBinary
    );
    console.error(
      "[prebuild-native] Run 'npm install' first to compile better-sqlite3."
    );
    process.exit(1);
  }

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  fs.copyFileSync(srcBinary, destBinary);

  const stats = fs.statSync(destBinary);
  console.log(
    `[prebuild-native] Copied better-sqlite3 binary (${(stats.size / 1024).toFixed(1)}KB)`
  );
  console.log(`[prebuild-native]   from: ${srcBinary}`);
  console.log(`[prebuild-native]   to:   ${destBinary}`);
} catch (err) {
  console.error("[prebuild-native] Failed:", err.message);
  process.exit(1);
}
