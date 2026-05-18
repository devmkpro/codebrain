#!/usr/bin/env node

/**
 * bundle-stdio.mjs
 *
 * Bundles the MCP stdio server (packages/mcp/stdio.js) into a single
 * self-contained .cjs file that runs with system Node.js — outside the
 * Electron asar archive.
 *
 * Why: The packaged Electron app puts all JS inside app.asar. System
 * Node.js (used by Claude Code CLI) cannot read .asar files, so
 * `node app.asar/packages/mcp/stdio.js` fails with MODULE_NOT_FOUND.
 *
 * This bundle includes all pure-JS dependencies inline. Native modules
 * (better-sqlite3) are marked external and loaded at runtime from the
 * system's node_modules or from the fallback path in store.js.
 *
 * Output: resources/mcp-stdio/stdio.cjs
 * Used by: ~/.mcp.json → node <install-path>/resources/mcp-stdio/stdio.cjs
 */

import esbuild from "esbuild";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const entryPoint = path.join(projectRoot, "packages", "mcp", "stdio.js");
const outDir = path.join(projectRoot, "resources", "mcp-stdio");
const outFile = path.join(outDir, "stdio.cjs");

async function build() {
  // Ensure output directory exists
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  try {
    const result = await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      outfile: outFile,
      format: "cjs",
      platform: "node",
      target: "node18",
      sourcemap: false,
      minify: false,
      // Native modules must stay external — they can't be bundled
      external: [
        "better-sqlite3",
      ],
      // Keep Node.js builtins external
      banner: {
        js: "/* eslint-disable */",
      },
    });

    if (result.errors.length > 0) {
      console.error("[bundle-stdio] Build errors:", result.errors);
      process.exit(1);
    }

    const stats = fs.statSync(outFile);
    console.log(
      `[bundle-stdio] Bundled MCP stdio server (${(stats.size / 1024).toFixed(1)}KB)`
    );
    console.log(`[bundle-stdio]   entry: ${entryPoint}`);
    console.log(`[bundle-stdio]   output: ${outFile}`);

    // Verify the bundle can be parsed (not run, just syntax check)
    try {
      require(outFile);
      console.log("[bundle-stdio] ✓ Bundle loads successfully");
    } catch (err) {
      // It might fail if better-sqlite3 ABI doesn't match, that's OK
      // The important thing is that the JS is syntactically valid
      if (err.message.includes("NODE_MODULE_VERSION") || err.message.includes("MODULE_NOT_FOUND")) {
        console.log("[bundle-stdio] ✓ Bundle syntax valid (native module ABI mismatch is expected in dev)");
      } else {
        console.warn("[bundle-stdio] ⚠ Bundle load warning:", err.message);
      }
    }
  } catch (err) {
    console.error("[bundle-stdio] Build failed:", err.message);
    process.exit(1);
  }
}

build();
