"use strict";

const http = require("http");
const { randomUUID } = require("node:crypto");
const { createCodebrainMCPServer, registerBrowserTools } = require("./index.js");
const { createMCPBridge } = require("./bridge.js");

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

  // Use CJS require (not ESM import) so it works inside Electron asar in production builds
  const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js");
  const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const { isInitializeRequest } = require("@modelcontextprotocol/sdk/types.js");

  const transports = {};

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
        } else if (!sessionId && req.method === "POST" && parsedBody && isInitializeRequest(parsedBody)) {
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid) => {
              transports[sid] = transport;
            },
          });
          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid && transports[sid]) delete transports[sid];
          };
          const sessionServer = createCodebrainMCPServer(bridge);
          registerBrowserTools(sessionServer, bridge);
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
      res.on("close", () => {
        delete transports[transport.sessionId];
      });
      res.on("error", (err) => {
        console.warn("[MCP] SSE response error (client disconnected):", err.code || err.message);
      });
      const sessionServer = createCodebrainMCPServer(bridge);
      registerBrowserTools(sessionServer, bridge);
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

    // ── GitLab Webhook: POST /api/webhooks/gitlab ──
    if (url.pathname === "/api/webhooks/gitlab" && req.method === "POST") {
      try {
        const rawBody = await readBody(req);
        const payload = JSON.parse(rawBody);

        // Validate webhook secret if configured
        const config = bridge.loadConfig?.() || {};
        if (config.webhook?.secret) {
          const token = req.headers["x-gitlab-token"];
          if (token !== config.webhook.secret) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid webhook token" }));
            return;
          }
        }

        // Only process merge_request events
        const eventType = req.headers["x-gitlab-event"];
        if (eventType !== "Merge Request Hook") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, skipped: true, reason: `Ignored event type: ${eventType}` }));
          return;
        }

        const attrs = payload.object_attributes || {};
        const mrId = attrs.iid;
        const projectId = String(payload.project?.id || "");
        const action = attrs.action; // open, update, reopen, close, merge
        const title = attrs.title || "";
        const isDraft = attrs.work_in_progress || title.toLowerCase().startsWith("draft:") || title.toLowerCase().startsWith("wip:");

        // Skip if not an actionable event
        const actionable = ["open", "reopen", "update"].includes(action);
        if (!actionable) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, skipped: true, reason: `Non-actionable action: ${action}` }));
          return;
        }

        // Skip drafts if any repo config says to
        const repoConfig = (config.repos || []).find((r) => String(r.projectId) === projectId);
        if (isDraft && repoConfig?.skipDraft) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, skipped: true, reason: "Draft MR skipped" }));
          return;
        }

        // Log the incoming MR event
        const event = {
          source: "webhook",
          projectId,
          mrId,
          action,
          title,
          author: payload.user?.name || payload.user?.username || "unknown",
          sourceBranch: attrs.source_branch,
          targetBranch: attrs.target_branch,
          isDraft,
          webUrl: attrs.url || "",
          timestamp: Date.now(),
        };

        console.log(`[MCP] Webhook: MR !${mrId} "${title}" (${action}) from ${event.author}`);

        // Store in memory for the review pipeline
        try {
          const store = opts.memoryStore;
          if (store) {
            store.write({
              type: "episodic",
              key: `mr-event-${projectId}-${mrId}-${Date.now()}`,
              content: JSON.stringify(event),
              tags: ["mr-event", "webhook", action],
              agent_id: "webhook",
              workspace: opts.getCurrentWorkspacePath?.() || process.cwd(),
            });
          }
        } catch {}

        // Fire hook for review pipeline
        try { opts.hooksManager?.fire?.("mr_webhook", event); } catch {}

        // Trigger review pipeline (fire-and-forget — doesn't block HTTP response)
        if (bridge.reviewRun) {
          bridge.reviewRun({ projectId, mrId, timeout: 600000 })
            .then((result) => {
              const d = result.data;
              const status = result.ok
                ? `completed (output=${d?.outputLength || 0} chars, fallback=${d?.fallbackPosted ? "yes" : "no"})`
                : result.error;
              console.log(`[MCP] Review MR !${mrId}: ${status}`);
            })
            .catch((err) => console.error(`[MCP] Review MR !${mrId} failed:`, err.message));
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, event }));
      } catch (err) {
        console.error("[MCP] Webhook error:", err.message);
        if (!res.headersSent) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      }
      return;
    }

    // ── Health check ──
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, tools: getToolNames(mcpServer) }));
      return;
    }

    res.writeHead(404).end("Not found");
  });

  const port = opts.port || 0;

  return new Promise((resolve, reject) => {
    let started = false;
    server.listen(port, "127.0.0.1", () => {
      started = true;
      const actualPort = server.address().port;
      const info = {
        port: actualPort,
        sseUrl: `http://127.0.0.1:${actualPort}/sse`,
        streamableHttpUrl: `http://127.0.0.1:${actualPort}/mcp`,
        close: () => {
          // Close all transports
          for (const sid in transports) {
            try { transports[sid].close(); } catch {}
            delete transports[sid];
          }
          server.close();
        },
      };
      console.log(`[MCP] CodeBrain MCP server listening on http://127.0.0.1:${actualPort}`);
      console.log(`[MCP]   SSE: ${info.sseUrl}`);
      console.log(`[MCP]   Streamable HTTP: ${info.streamableHttpUrl}`);
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
    // McpServer stores registered tools internally
    const tools = mcpServer._tools || mcpServer.tools || {};
    return Object.keys(tools);
  } catch {
    return [];
  }
}

module.exports = { startMCPServer };
