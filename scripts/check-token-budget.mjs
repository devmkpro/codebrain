/**
 * Token budget guard.
 *
 * Two modes:
 *   node scripts/check-token-budget.mjs            static checks only (free, CI)
 *   node scripts/check-token-budget.mjs --measure  also spends real API calls
 *
 * The static mode guards the inputs that decide context size: prompt bytes, the
 * MCP core tool set and the native tool allowlists. The measured mode runs the
 * real CLI and asserts the end-to-end number, so a regression in something we
 * forgot to model still fails.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const promptDir = path.join(root, "prompts");
const measure = process.argv.includes("--measure");

/** Recorded on 2026-09-08 against the refactored default config. */
const MEASURED_BASELINE_INPUT_TOKENS = 16020;
/** Ceiling for the end-to-end "olá" turn. Above this the refactor has regressed. */
const MEASURED_INPUT_BUDGET = 20000;
/** A greeting must not trigger tool calls; extra turns re-send the whole context. */
const MEASURED_TURN_BUDGET = 1;
/** Core MCP tools advertised on every turn. Each one costs ~210 tokens per request. */
const CORE_TOOL_BUDGET = 15;

const promptBudgets = {
  "codebrain-system.md": 3000,
  "squad-worker.md": 2200,
  "squad-orchestrator.md": 2200,
  "squad-worker-gemini.md": 1400,
  "squad-ui-tester.md": 1400,
};

let failed = false;
const fail = (msg) => {
  console.error(`  FAIL ${msg}`);
  failed = true;
};

// ── 1. Prompt size ──────────────────────────────────────────────────────────
console.log("prompt budgets:");
for (const [name, budget] of Object.entries(promptBudgets)) {
  const bytes = Buffer.byteLength(fs.readFileSync(path.join(promptDir, name), "utf8"), "utf8");
  console.log(`  ${name}: ${bytes} / ${budget} bytes`);
  if (bytes > budget) fail(`${name} is ${bytes - budget} bytes over budget`);
}

const allPrompts = Object.keys(promptBudgets)
  .map((name) => fs.readFileSync(path.join(promptDir, name), "utf8"))
  .join("\n");

// ── 2. Prompt content contracts ─────────────────────────────────────────────
for (const forbidden of ["mcp__codebrain__mcp__codebrain__", "FORBIDDEN TOOLS — NEVER USE THESE"]) {
  if (allPrompts.includes(forbidden)) fail(`forbidden prompt content present: ${forbidden}`);
}
if (!allPrompts.includes("OK|PART|FAIL|BLOCK")) {
  fail("compact worker return contract is missing from the prompts");
}

// ── 3. MCP default surface ──────────────────────────────────────────────────
// The core set is what every request pays for. Guard its size, not just its
// contents: re-promoting tools into the core is how the budget silently grows.
const mcpSource = fs.readFileSync(path.join(root, "packages", "mcp", "index.js"), "utf8");
const coreBlock = mcpSource.match(/const coreToolNames = new Set\(\[([\s\S]*?)\]\)/);
if (!coreBlock) {
  fail("could not find coreToolNames in packages/mcp/index.js");
} else {
  const coreTools = [...coreBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  console.log(`mcp core surface: ${coreTools.length} / ${CORE_TOOL_BUDGET} tools`);
  if (coreTools.length > CORE_TOOL_BUDGET) {
    fail(`core MCP surface grew to ${coreTools.length} tools (budget ${CORE_TOOL_BUDGET})`);
  }
  for (const required of ["pane_spawn", "memory_search", "enable_tool_group"]) {
    if (!coreTools.includes(required)) fail(`core MCP surface is missing ${required}`);
  }
  // Registration names must NOT carry the server prefix — the MCP client adds
  // its own, producing mcp__codebrain__mcp__codebrain__* and breaking both
  // permission rules and the loop-detection allowlist in bridge.js.
  const doublePrefixed = [...mcpSource.matchAll(/server\.tool\(\s*"mcp__codebrain__/g)];
  if (doublePrefixed.length > 0) {
    fail(`${doublePrefixed.length} MCP tools are registered with a redundant mcp__codebrain__ prefix`);
  }
}

// ── 4. Native tool allowlists ───────────────────────────────────────────────
const policySource = fs.readFileSync(
  path.join(root, "electron", "main", "services", "spawn", "native-tools.ts"),
  "utf8"
);
const spawnSource = fs.readFileSync(
  path.join(root, "electron", "main", "services", "pane-spawn.ts"),
  "utf8"
);
for (const role of ["orchestrator", "worker", "ui-tester"]) {
  if (!new RegExp(`["']?${role}["']?\\s*:`).test(policySource)) {
    fail(`native tool allowlist is missing the ${role} role`);
  }
}
// The orchestrator delegates; giving it writers costs schema tokens and removes
// the structural guarantee that replaced the prose prohibition.
const orchestratorList = policySource.match(/orchestrator:\s*Object\.freeze\(\[([^\]]*)\]/);
if (orchestratorList) {
  for (const writer of ["Edit", "Write", "Bash"]) {
    if (orchestratorList[1].includes(`"${writer}"`)) {
      fail(`orchestrator allowlist must not include ${writer}`);
    }
  }
}

const providerContracts = [
  ["Claude/OpenClaude", ["withNativeToolAllowlist", "--system-prompt-file"]],
  ["Codex CLI", ["withCodexDeveloperInstructions", "developer_instructions="]],
  ["Gemini CLI", ["context.fileName", "--allowed-mcp-server-names"]],
];
for (const [provider, markers] of providerContracts) {
  const source = `${spawnSource}\n${policySource}`;
  for (const marker of markers) {
    if (!source.includes(marker)) fail(`${provider}: missing provider contract ${marker}`);
  }
}

// ── 5. Measured end-to-end turn (opt-in: spends real tokens) ────────────────
if (measure) {
  console.log("\nmeasured turn (real API call):");
  const testPrompts = JSON.parse(
    fs.readFileSync(path.join(root, "scripts", "token-budget-prompts.json"), "utf8")
  );
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cb-token-budget-"));
  const promptFile = path.join(tmp, "system-prompt.txt");
  fs.writeFileSync(
    promptFile,
    [
      fs.readFileSync(path.join(promptDir, "codebrain-system.md"), "utf8"),
      fs.readFileSync(path.join(promptDir, "squad-worker.md"), "utf8"),
    ].join("\n\n---\n\n"),
    "utf8"
  );
  const mcpConfig = path.join(tmp, "mcp.json");
  const mcpPort = process.env.CODEBRAIN_MCP_PORT;
  fs.writeFileSync(
    mcpConfig,
    JSON.stringify(
      mcpPort
        ? { mcpServers: { codebrain: { type: "http", url: `http://127.0.0.1:${mcpPort}/mcp` } } }
        : { mcpServers: {} }
    ),
    "utf8"
  );
  if (!mcpPort) {
    console.log("  note: CODEBRAIN_MCP_PORT unset — measuring without the MCP surface");
  }

  const nativeTools = (policySource.match(/worker:\s*Object\.freeze\(\[([^\]]*)\]/)?.[1] ?? "")
    .match(/"([^"]+)"/g)
    ?.map((s) => s.replaceAll('"', ""))
    .join(",");

  for (const { name, prompt } of testPrompts) {
    let usage;
    try {
      const out = execFileSync(
        "claude",
        [
          "-p", prompt,
          "--output-format", "json",
          "--system-prompt-file", promptFile,
          "--tools", nativeTools ?? "Read,Edit,Write,Grep,Glob,Bash,TodoWrite",
          "--strict-mcp-config", "--mcp-config", mcpConfig,
        ],
        { cwd: tmp, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
      );
      usage = JSON.parse(out.trim().split("\n").pop());
    } catch (err) {
      fail(`could not run the measured turn for "${name}": ${err.message.split("\n")[0]}`);
      continue;
    }
    const u = usage.usage ?? {};
    const total =
      (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    const drift = total - MEASURED_BASELINE_INPUT_TOKENS;
    console.log(
      `  ${name}: ${total} in / ${u.output_tokens ?? 0} out / ${usage.num_turns} turns` +
        ` (baseline ${MEASURED_BASELINE_INPUT_TOKENS}, drift ${drift >= 0 ? "+" : ""}${drift})`
    );
    if (total > MEASURED_INPUT_BUDGET) {
      fail(`"${name}" used ${total} input tokens (budget ${MEASURED_INPUT_BUDGET})`);
    }
    if (usage.num_turns > MEASURED_TURN_BUDGET) {
      fail(
        `"${name}" took ${usage.num_turns} turns (budget ${MEASURED_TURN_BUDGET}) —` +
          " a forced bootstrap re-sends the whole context"
      );
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
} else {
  console.log("\nmeasured turn: skipped (pass --measure to spend real API calls)");
}

console.log(failed ? "\ntoken budget: FAIL" : "\ntoken budget: PASS");
process.exitCode = failed ? 1 : 0;
