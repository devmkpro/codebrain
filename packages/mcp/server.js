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
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32000, message: "Session uses different transport" },
              id: null,
            }));
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
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Bad Request" },
            id: null,
          }));
          return;
        }

        await transport.handleRequest(req, res, parsedBody);
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
      const sessionServer = createCodebrainMCPServer(bridge);
      registerBrowserTools(sessionServer, bridge);
      await sessionServer.connect(transport);
      return;
    }

    // ── SSE message endpoint: /messages ──
    if (url.pathname === "/messages" && req.method === "POST") {
      const sessionId = url.searchParams.get("sessionId");
      const transport = transports[sessionId];
      if (transport instanceof SSEServerTransport) {
        const body = JSON.parse(await readBody(req));
        await transport.handlePostMessage(req, res, body);
      } else {
        res.writeHead(400).end("No SSE transport for sessionId");
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
    server.listen(port, "127.0.0.1", () => {
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
    server.on("error", reject);
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
