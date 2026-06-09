"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { randomUUID } = require("node:crypto");
const { createCodebrainMCPServer, registerBrowserTools, registerFetchTools } = require("./index.js");
const { createMCPBridge } = require("./bridge.js");

// ── Session tracking with activity timestamps ──
// Prevents stale sessions from accumulating and enables health monitoring.
const SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_CLEANUP_INTERVAL_MS = 30 * 1000;   // 30 seconds

/**
 * Persist the active MCP port to ~/.codebrain/mcp-port so CLIs can
 * discover the correct URL even when the port falls back to a random one.
 */
function saveMcpPort(port) {
  try {
    const dir = path.join(os.homedir(), ".codebrain");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "mcp-port"), String(port), "utf-8");
  } catch {}
}

/**
 * Starts the CodeBrain MCP server on a local HTTP port.
 * Supports both SSE (deprecated) and Streamable HTTP transports.
 *
 * @param {Object} ptyManager - PtyManager instance
 * @param {Object} opts
 * @param {number} [opts.port=0] - Port to listen on (0 = random available port)
 * @param {function} opts.onPaneCreated - callback when MCP spawns a pane
 * @returns {Promise<{ port: number, sseUrl: string, streamableHttpUrl: string, close: function }>}
 */
async function startMCPServer(ptyManager, opts = {}) {
  const bridge = createMCPBridge(ptyManager, opts);
  const mcpServer = createCodebrainMCPServer(bridge);
  registerBrowserTools(mcpServer, bridge);
  registerFetchTools(mcpServer, bridge);

  // Use CJS require (not ESM import) so it works inside Electron asar in production builds
  const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js");
  const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const { isInitializeRequest } = require("@modelcontextprotocol/sdk/types.js");

  // ── Tracked session registry (activity timestamps for stale cleanup) ──
  const transports = {};
  const sessionActivity = {}; // sid → last activity Date.now()

  function touchSession(sid) {
    if (sid) sessionActivity[sid] = Date.now();
  }

  function removeSession(sid) {
    if (sid) {
      delete transports[sid];
      delete sessionActivity[sid];
    }
  }

  // Periodic cleanup: evict sessions idle for > SESSION_IDLE_TIMEOUT_MS
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const sid in sessionActivity) {
      if (now - sessionActivity[sid] > SESSION_IDLE_TIMEOUT_MS) {
        try { transports[sid]?.close(); } catch {}
        removeSession(sid);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`[MCP] Session cleanup: evicted ${cleaned} idle sessions. Active: ${Object.keys(transports).length}`);
    }
  }, SESSION_CLEANUP_INTERVAL_MS);

  // Ensure cleanup timer doesn't prevent process exit
  if (cleanupTimer.unref) cleanupTimer.unref();

  const serverStartTime = Date.now();

  // Create HTTP server
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost`);

    // ── Streamable HTTP endpoint: /mcp ──
    if (url.pathname === "/mcp") {
      try {
        const sessionId = req.headers["mcp-session-id"];
        let transport;
        let parsedBody = undefined;

        // Read body once for POST requests
        if (req.method === "POST") {
          const rawBody = await readBody(req);
          try { parsedBody = JSON.parse(rawBody); } catch { parsedBody = null; }
        }

        if (sessionId && transports[sessionId]) {
          transport = transports[sessionId];
          touchSession(sessionId);
          if (!(transport instanceof StreamableHTTPServerTransport)) {
            if (!res.headersSent) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32000, message: "Session uses different transport" },
                id: null,
              }));
            }
            return;
          }
        } else if (sessionId && !transports[sessionId]) {
          // ── Session ID provided but not found (stale session from old server) ──
          // Return 404 with a hint so the client can re-initialize.
          console.warn(`[MCP] Stale session ${sessionId} — client should re-initialize`);
          if (!res.headersSent) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32001, message: "Session not found — server restarted. Re-initialize." },
              id: null,
            }));
          }
          return;
        } else if (!sessionId && req.method === "POST" && parsedBody && isInitializeRequest(parsedBody)) {
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid) => {
              transports[sid] = transport;
              touchSession(sid);
              console.log(`[MCP] New session initialized: ${sid}. Active: ${Object.keys(transports).length}`);
            },
          });
          transport.onclose = () => {
            const sid = transport.sessionId;
            removeSession(sid);
            console.log(`[MCP] Session closed: ${sid}. Active: ${Object.keys(transports).length}`);
          };
          const sessionServer = createCodebrainMCPServer(bridge);
          registerBrowserTools(sessionServer, bridge);
          registerFetchTools(sessionServer, bridge);
          await sessionServer.connect(transport);
        } else {
          if (!res.headersSent) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32000, message: "Bad Request" },
              id: null,
            }));
          }
          return;
        }

        // Touch session on every successful request routing
        touchSession(transport.sessionId);

        if (!res.headersSent) {
          await transport.handleRequest(req, res, parsedBody);
        }
      } catch (err) {
        console.error("[MCP] Error handling /mcp:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          }));
        }
      }
      return;
    }

    // ── SSE endpoint: /sse (deprecated, for backwards compat) ──
    if (url.pathname === "/sse" && req.method === "GET") {
      const transport = new SSEServerTransport("/messages", res);
      transports[transport.sessionId] = transport;
      touchSession(transport.sessionId);
      console.log(`[MCP] New SSE session: ${transport.sessionId}. Active: ${Object.keys(transports).length}`);
      res.on("close", () => {
        removeSession(transport.sessionId);
      });
      res.on("error", (err) => {
        console.warn("[MCP] SSE response error (client disconnected):", err.code || err.message);
      });
      const sessionServer = createCodebrainMCPServer(bridge);
      registerBrowserTools(sessionServer, bridge);
      registerFetchTools(sessionServer, bridge);
      try {
        await sessionServer.connect(transport);
      } catch (err) {
        console.warn("[MCP] SSE connect error:", err.message);
      }
      return;
    }

    // ── SSE message endpoint: /messages ──
    if (url.pathname === "/messages" && req.method === "POST") {
      const sessionId = url.searchParams.get("sessionId");
      const transport = transports[sessionId];
      if (transport instanceof SSEServerTransport) {
        try {
          const body = JSON.parse(await readBody(req));
          await transport.handlePostMessage(req, res, body);
        } catch (err) {
          console.warn("[MCP] SSE message error:", err.message);
          if (!res.headersSent) res.writeHead(500).end("Internal error");
        }
      } else {
        if (!res.headersSent) res.writeHead(400).end("No SSE transport for sessionId");
      }
      return;
    }

    // ── Health check (with active session info) ──
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        tools: getToolNames(mcpServer),
        activeSessions: Object.keys(transports).length,
        uptime: Math.floor((Date.now() - serverStartTime) / 1000),
      }));
      return;
    }

    res.writeHead(404).end("Not found");
  });

  const preferredPort = opts.port ?? (process.env.CODEBRAIN_MCP_PORT ? parseInt(process.env.CODEBRAIN_MCP_PORT, 10) : 61010);

  function doListen(port) {
    return new Promise((resolve, reject) => {
      let started = false;
      server.listen(port, "127.0.0.1", () => {
        started = true;
        const actualPort = server.address().port;
        const info = {
          port: actualPort,
          sseUrl: `http://127.0.0.1:${actualPort}/sse`,
          streamableHttpUrl: `http://127.0.0.1:${actualPort}/mcp`,
          activeSessions: () => Object.keys(transports).length,
          close: () => {
            clearInterval(cleanupTimer);
            // Close all tracked transports
            const allSids = Object.keys(transports);
            for (const sid of allSids) {
              try { transports[sid]?.close(); } catch {}
            }
            allSids.forEach(removeSession);
            server.close();
          },
        };
        console.log(`[MCP] CodeBrain MCP server listening on http://127.0.0.1:${actualPort}`);
        console.log(`[MCP]   SSE: ${info.sseUrl}`);
        console.log(`[MCP]   Streamable HTTP: ${info.streamableHttpUrl}`);
        console.log(`[MCP]   Session idle timeout: ${SESSION_IDLE_TIMEOUT_MS / 60000}min`);
        saveMcpPort(actualPort);
        resolve(info);
      });
      server.on("error", (err) => {
        // Non-fatal socket errors (client disconnect, headers already sent) — just log
        if (err.code === "ECONNRESET" || err.code === "ERR_HTTP_HEADERS_SENT" || err.code === "EPIPE") {
          console.warn("[MCP] Non-fatal server error (client disconnect):", err.code);
          return;
        }
        // Fatal only during startup
        if (!started) reject(err);
        else console.error("[MCP] Server error:", err);
      });
    });
  }

  // Try preferred fixed port first; if busy (dev hot-reload), retry before falling back.
  // Retrying the same port prevents .mcp.json from becoming stale for running agents.
  return doListen(preferredPort).catch(async (err) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`[MCP] Port ${preferredPort} in use — retrying in 1s (old server may be shutting down)...`);
      server.removeAllListeners("error");
      await new Promise(r => setTimeout(r, 1000));
      try {
        return await doListen(preferredPort);
      } catch (retryErr) {
        if (retryErr.code === "EADDRINUSE") {
          console.warn(`[MCP] Port ${preferredPort} still in use after retry — falling back to random port`);
          server.removeAllListeners("error");
          return doListen(0);
        }
        throw retryErr;
      }
    }
    throw err;
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function getToolNames(mcpServer) {
  try {
    // McpServer stores registered tools in _registeredTools (MCP SDK v1.x)
    const tools = mcpServer._registeredTools || mcpServer._tools || mcpServer.tools || {};
    return Object.keys(tools);
  } catch {
    return [];
  }
}

module.exports = { startMCPServer };
