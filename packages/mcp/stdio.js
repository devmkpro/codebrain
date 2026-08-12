"use strict";

/**
 * Thin stdio-to-HTTP MCP bridge.
 *
 * The stdio process is intentionally tiny. It discovers the shared headless
 * daemon and starts it on demand when VS Code/Claude connects, then forwards
 * JSON-RPC messages to the daemon's Streamable HTTP endpoint. This avoids
 * creating one full MCP bridge (and one PTY manager) per editor connection.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const runtimePaths = require("./runtime-paths.js");

const STARTUP_TIMEOUT_MS = 20_000;
const PROBE_TIMEOUT_MS = 350;

function log(...args) {
  // stdout is reserved for MCP JSON-RPC messages.
  console.error("[codebrain-mcp]", ...args);
}

function jsonRpcError(id, message, code = -32000) {
  return { jsonrpc: "2.0", error: { code, message }, id: id ?? null };
}

function writeMessage(message) {
  if (!message) return;
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function spawnDaemon(workspace) {
  const electronBin = runtimePaths.resolveElectronBinary();
  const daemonEntry = runtimePaths.resolveDaemonEntry();
  if (!electronBin || !daemonEntry) {
    return {
      error:
        "Não foi possível localizar o daemon do Codebrain. Recompile/reinstale o Codebrain ou defina CODEBRAIN_ELECTRON_BIN.",
    };
  }

  let logFd;
  try {
    runtimePaths.ensureCodebrainDir();
    const logPath = runtimePaths.DAEMON_LOG_FILE;
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    logFd = fs.openSync(logPath, "a");
  } catch {}

  try {
    const child = spawn(electronBin, [daemonEntry, "--workspace", workspace], {
      detached: true,
      stdio: logFd ? ["ignore", logFd, logFd] : "ignore",
      env: {
        ...process.env,
        CODEBRAIN_MANAGED_SIGNALS: "1",
        CODEBRAIN_DATA_DIR: runtimePaths.CODEBRAIN_DIR,
        CODEBRAIN_WORKSPACE: workspace,
        ELECTRON_RUN_AS_NODE: "1",
      },
    });
    child.unref();
    log(`daemon iniciado (pid ${child.pid || "?"})`);
    return { pid: child.pid };
  } catch (err) {
    try { if (logFd) fs.closeSync(logFd); } catch {}
    return { error: `Falha ao iniciar daemon: ${err.message || err}` };
  }
}

async function waitForEndpoint(workspace) {
  let endpoint = await runtimePaths.findRunningEndpoint({ timeoutMs: PROBE_TIMEOUT_MS });
  if (endpoint) return endpoint;

  const started = spawnDaemon(workspace);
  if (started.error) throw new Error(started.error);

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    endpoint = await runtimePaths.findRunningEndpoint({ timeoutMs: PROBE_TIMEOUT_MS });
    if (endpoint) return endpoint;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `Daemon MCP não respondeu em ${STARTUP_TIMEOUT_MS}ms. Veja ${runtimePaths.DAEMON_LOG_FILE}`
  );
}

function parseSse(text) {
  const messages = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const value = line.slice(5).trim();
    if (!value || value === "[DONE]") continue;
    try { messages.push(JSON.parse(value)); } catch {}
  }
  return messages;
}

async function main() {
  const workspace = process.env.CODEBRAIN_WORKSPACE
    ? path.resolve(process.env.CODEBRAIN_WORKSPACE)
    : process.cwd();
  const endpoint = await waitForEndpoint(workspace);
  const url = `http://127.0.0.1:${endpoint.port}/mcp`;
  let sessionId = null;

  log(`conectado ao daemon em ${url}`);

  async function forward(message) {
    const headers = {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;

    let response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
    });

    // A daemon restart invalidates the old streamable session. Let the MCP
    // client re-initialize instead of returning an opaque transport failure.
    if (response.status === 404 && sessionId) {
      sessionId = null;
      const retryHeaders = { ...headers };
      delete retryHeaders["mcp-session-id"];
      response = await fetch(url, {
        method: "POST",
        headers: retryHeaders,
        body: JSON.stringify(message),
      });
    }

    const newSessionId = response.headers.get("mcp-session-id");
    if (newSessionId) sessionId = newSessionId;

    const body = await response.text();
    if (!response.ok) {
      writeMessage(jsonRpcError(message.id, `Daemon MCP HTTP ${response.status}: ${body || response.statusText}`));
      return;
    }
    if (!body.trim()) return; // JSON-RPC notification / HTTP 202

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/event-stream")) {
      for (const item of parseSse(body)) writeMessage(item);
      return;
    }
    try {
      writeMessage(JSON.parse(body));
    } catch {
      writeMessage(jsonRpcError(message.id, "Resposta inválida do daemon MCP", -32603));
    }
  }

  let input = "";
  let queue = Promise.resolve();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    input += chunk;
    const lines = input.split(/\r?\n/);
    input = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch {
        writeMessage(jsonRpcError(null, "Mensagem JSON inválida", -32700));
        continue;
      }
      // Preserve request order during initialization/session negotiation while
      // still keeping the stdio stream asynchronous.
      queue = queue.then(() => forward(message)).catch((err) => {
        writeMessage(jsonRpcError(message.id, err instanceof Error ? err.message : String(err)));
      });
    }
  });
  process.stdin.on("end", () => {
    queue.finally(() => process.exit(0));
  });
}

main().catch((err) => {
  log("fatal:", err);
  process.exitCode = 1;
});
