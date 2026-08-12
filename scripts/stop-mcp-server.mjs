import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const runtimePaths = require("../packages/mcp/runtime-paths.js");
const state = runtimePaths.readDaemonState();

if (!state || !runtimePaths.isDaemonProcessAlive(state)) {
  runtimePaths.clearDaemonState();
  console.log("Codebrain MCP daemon is not running.");
  process.exit(0);
}

try {
  process.kill(state.pid, "SIGTERM");
  console.log(`Stopping Codebrain MCP daemon (pid ${state.pid})...`);
} catch (err) {
  console.error(`Could not stop MCP daemon (pid ${state.pid}): ${err.message || err}`);
  process.exitCode = 1;
}
