"use strict";

/**
 * Remote Bridge Handlers — WSS server for thin-client (iPhone) control.
 *
 * Bridges Codebrain panes/PTY/missions to a remote display+input client.
 * Agents and CLIs stay on the host machine; the remote side is display + input only.
 *
 * Protocol: JSON frames over WSS (self-signed TLS cert).
 *
 * TLS:  Self-signed cert generated on first run, stored in <userData>/remote-bridge/tls.json
 * AUTH: 6-digit pairing code (rotates every 5 min) → opaque 32-byte hex token.
 *       Token hash (SHA-256) + issuedAt persisted in <userData>/remote-bridge/tokens.json.
 *       Tokens expire after 30 days.
 *
 * Ported from Overclock sidecar: remoteBridge.js
 * Adapted to Codebrain's Electron + MCP bridge architecture.
 */

const { createServer: createHttpsServer } = require("node:https");
const { randomBytes, createHash, timingSafeEqual } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const AUTH_RATE_LIMIT = 5;
const AUTH_RATE_WINDOW_MS = 60_000;
const IP_RATE_LIMIT = 20;
const IP_RATE_WINDOW_MS = 60_000;
const MAX_CONNECTIONS = 50;
const PAIR_CODE_EXPIRY_MS = 5 * 60_000;
const SCROLLBACK_MAX_BYTES = 128 * 1024;
const PANE_INPUT_MAX_BYTES = 8192;
const MAX_PAYLOAD_BYTES = 256 * 1024;

function sha256hex(input) {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

function isRateLimited(state) {
  const now = Date.now();
  if (now - state.attemptWindowStart > AUTH_RATE_WINDOW_MS) {
    state.failedAttempts = 0;
    state.attemptWindowStart = now;
  }
  return state.failedAttempts >= AUTH_RATE_LIMIT;
}

function recordFailedAttempt(state) {
  const now = Date.now();
  if (now - state.attemptWindowStart > AUTH_RATE_WINDOW_MS) {
    state.failedAttempts = 0;
    state.attemptWindowStart = now;
  }
  state.failedAttempts++;
}

// ─── TLS Helpers ────────────────────────────────────────────────────────────

async function loadOrCreateTls(dir) {
  const tlsPath = path.join(dir, "tls.json");
  if (fs.existsSync(tlsPath)) {
    try {
      const raw = fs.readFileSync(tlsPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (typeof parsed.key === "string" && typeof parsed.cert === "string") return parsed;
    } catch { /* regenerate */ }
  }

  let selfsigned;
  try {
    selfsigned = require("selfsigned");
  } catch {
    throw new Error("selfsigned package not installed. Run: npm install selfsigned");
  }

  const attrs = [{ name: "commonName", value: "codebrain-remote-bridge" }];
  const tenYears = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);
  const pems = await selfsigned.generate(attrs, {
    keySize: 2048,
    algorithm: "sha256",
    notAfterDate: tenYears,
  });

  const store = { key: pems.private, cert: pems.cert };
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tlsPath, JSON.stringify(store, null, 2), { encoding: "utf-8", mode: 0o600 });
  try { fs.chmodSync(tlsPath, 0o600); } catch {}
  return store;
}

// ─── Token Store ────────────────────────────────────────────────────────────

async function loadTokenStore(dir) {
  const tokPath = path.join(dir, "tokens.json");
  try {
    const raw = fs.readFileSync(tokPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.tokens)) {
      return parsed.tokens.filter(
        (t) => typeof t === "object" && t !== null && typeof t.hash === "string" && typeof t.issuedAt === "number"
      );
    }
    // Legacy format migration
    if (Array.isArray(parsed.hashes)) {
      const now = Date.now();
      return parsed.hashes.filter((h) => typeof h === "string").map((hash) => ({ hash, issuedAt: now }));
    }
  } catch {}
  return [];
}

async function persistTokenStore(dir, store) {
  const file = { tokens: store };
  const tokPath = path.join(dir, "tokens.json");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tokPath, JSON.stringify(file, null, 2), { encoding: "utf-8", mode: 0o600 });
  try { fs.chmodSync(tokPath, 0o600); } catch {}
}

// ─── RemoteBridge Class ─────────────────────────────────────────────────────

class RemoteBridge extends EventEmitter {
  constructor(deps) {
    super();
    this.deps = deps;
    this.bridgeDir = path.join(deps.dataDir, "remote-bridge");
    this.port = deps.port || parseInt(process.env.CODEBRAIN_REMOTE_PORT || "8789", 10);
    this.bindAddr = process.env.CODEBRAIN_REMOTE_BIND || "0.0.0.0";

    this.httpsServer = null;
    this.wss = null;
    this.clients = new Map();
    this.tokenStore = [];
    this.pairCode = null;
    this.pairCodeExpiresAt = 0;
    this.ipRateLimit = new Map();
    this.running = false;

    this.rotatePairCode();
    setInterval(() => { this.rotatePairCode(); }, PAIR_CODE_EXPIRY_MS).unref?.();
  }

  // ── IP rate limiter (global, across connections) ─────────────────────────
  isIpRateLimited(ip) {
    const now = Date.now();
    const entry = this.ipRateLimit.get(ip);
    if (!entry || now - entry.windowStart > IP_RATE_WINDOW_MS) return false;
    return entry.count >= IP_RATE_LIMIT;
  }

  recordIpFailure(ip) {
    const now = Date.now();
    const entry = this.ipRateLimit.get(ip);
    if (!entry || now - entry.windowStart > IP_RATE_WINDOW_MS) {
      this.ipRateLimit.set(ip, { count: 1, windowStart: now });
    } else {
      entry.count++;
    }
  }

  // ── Pairing code ────────────────────────────────────────────────────────
  rotatePairCode() {
    const n = randomBytes(3).readUIntBE(0, 3) % 1_000_000;
    this.pairCode = String(n).padStart(6, "0");
    this.pairCodeExpiresAt = Date.now() + PAIR_CODE_EXPIRY_MS;
    this.emit("pairCode", this.pairCode);
  }

  getPairCode() {
    return { code: this.pairCode || "------", expiresAt: this.pairCodeExpiresAt };
  }

  revokeAllTokens() {
    this.tokenStore = [];
    void persistTokenStore(this.bridgeDir, this.tokenStore);
  }

  // ── Startup ─────────────────────────────────────────────────────────────
  async start() {
    if (this.running) return { ok: true, data: { port: this.port, alreadyRunning: true } };

    try {
      if (!fs.existsSync(this.bridgeDir)) fs.mkdirSync(this.bridgeDir, { recursive: true });
      this.tokenStore = await loadTokenStore(this.bridgeDir);
      const tls = await loadOrCreateTls(this.bridgeDir);

      // Dynamic import of ws (ESM/CJS interop)
      let WebSocketServer;
      try {
        const ws = require("ws");
        WebSocketServer = ws.WebSocketServer;
      } catch {
        return { ok: false, error: "ws package not installed. Run: npm install ws" };
      }

      this.httpsServer = createHttpsServer({ key: tls.key, cert: tls.cert });
      this.wss = new WebSocketServer({ server: this.httpsServer, maxPayload: MAX_PAYLOAD_BYTES });

      this.wss.on("connection", (ws, req) => { this.handleConnection(ws, req); });
      this.wss.on("error", (err) => {
        console.error(`[remote-bridge] wss error: ${err.message}`);
      });

      const bound = await new Promise((resolve) => {
        const onErr = (err) => {
          console.error(`[remote-bridge] bind failed (${err.code || err.message}) — remote control disabled`);
          resolve(false);
        };
        this.httpsServer.once("error", onErr);
        this.httpsServer.listen(this.port, this.bindAddr, () => {
          this.httpsServer.removeListener("error", onErr);
          this.httpsServer.on("error", (e) => console.error(`[remote-bridge] server error: ${e.message}`));
          resolve(true);
        });
      });

      if (!bound) {
        try { this.httpsServer.close(); } catch {}
        this.httpsServer = null;
        this.wss = null;
        return { ok: false, error: `Failed to bind to ${this.bindAddr}:${this.port}` };
      }

      if (this.bindAddr === "0.0.0.0") {
        console.warn(`[remote-bridge] Listening on all interfaces (0.0.0.0:${this.port}). Set CODEBRAIN_REMOTE_BIND to restrict.`);
      }

      this.running = true;
      console.log(`[remote-bridge] Listening on wss://${this.bindAddr}:${this.port}`);
      return { ok: true, data: { port: this.port, bindAddr: this.bindAddr } };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async stop() {
    if (!this.running) return { ok: true };
    this.wss?.close();
    await new Promise((resolve) => {
      if (!this.httpsServer) { resolve(); return; }
      this.httpsServer.close(() => resolve());
    });
    this.httpsServer = null;
    this.wss = null;
    this.running = false;
    return { ok: true };
  }

  // ── PTY data fan-out ────────────────────────────────────────────────────
  onPtyData(paneId, data) {
    if (!data || !this.running) return;
    const frame = JSON.stringify({ type: "pane.output", paneId, data });
    for (const [ws, state] of this.clients) {
      if (state.authed && state.subscriptions.has(paneId) && ws.readyState === 1 /* OPEN */) {
        try { ws.send(frame); } catch {}
      }
    }
  }

  broadcastPanes() {
    if (!this.running) return;
    const panes = this.serializePanes();
    const frame = JSON.stringify({ type: "panes", panes });
    for (const [ws, state] of this.clients) {
      if (state.authed && ws.readyState === 1) {
        try { ws.send(frame); } catch {}
      }
    }
  }

  broadcastMissions() {
    if (!this.running) return;
    const missions = this.serializeMissions();
    const frame = JSON.stringify({ type: "missions", missions });
    for (const [ws, state] of this.clients) {
      if (state.authed && ws.readyState === 1) {
        try { ws.send(frame); } catch {}
      }
    }
  }

  // ── Connection handling ─────────────────────────────────────────────────
  handleConnection(ws, req) {
    if (this.clients.size >= MAX_CONNECTIONS) {
      try { ws.close(1013, "try again later"); } catch {}
      return;
    }

    const ip = req.socket.remoteAddress || "unknown";
    if (this.isIpRateLimited(ip)) {
      try { ws.close(1008, "too many failed attempts"); } catch {}
      return;
    }

    const state = {
      authed: false,
      failedAttempts: 0,
      attemptWindowStart: Date.now(),
      subscriptions: new Set(),
    };
    this.clients.set(ws, state);

    ws.on("message", (raw) => { this.handleMessage(ws, state, raw, ip); });
    ws.on("close", () => { this.clients.delete(ws); });
    ws.on("error", () => { this.clients.delete(ws); try { ws.terminate(); } catch {} });
  }

  handleMessage(ws, state, raw, ip) {
    let frame;
    try { frame = JSON.parse(raw.toString("utf-8")); } catch {
      this.send(ws, { type: "error", message: "invalid JSON" });
      return;
    }

    // Always allow pair + auth + ping
    if (frame.type === "ping") { this.send(ws, { type: "pong" }); return; }
    if (frame.type === "pair") { this.handlePair(ws, state, frame.code, ip); return; }
    if (frame.type === "auth") { this.handleAuth(ws, state, frame.token, ip); return; }

    if (!state.authed) {
      this.send(ws, { type: "auth_error", message: "not authenticated" });
      return;
    }

    switch (frame.type) {
      case "panes.list": this.handlePanesList(ws); break;
      case "missions.list": this.handleMissionsList(ws); break;
      case "pane.subscribe": this.handlePaneSubscribe(ws, state, frame.paneId); break;
      case "pane.unsubscribe": state.subscriptions.delete(frame.paneId); break;
      case "pane.input": this.handlePaneInput(ws, frame.paneId, frame.data); break;
      case "pane.resize": this.handlePaneResize(ws, frame.paneId, frame.cols, frame.rows); break;
      case "squad.status": this.handleSquadStatus(ws); break;
      default: this.send(ws, { type: "error", message: "unknown frame type" });
    }
  }

  // ── Auth handlers ───────────────────────────────────────────────────────
  handlePair(ws, state, code, ip) {
    if (this.isIpRateLimited(ip) || isRateLimited(state)) {
      this.send(ws, { type: "auth_error", message: "too many attempts — try again later" });
      return;
    }

    const now = Date.now();
    const validCode = this.pairCode;
    const codeExpired = now > this.pairCodeExpiresAt;
    const codeBytes = Buffer.from(typeof code === "string" ? code : "", "utf-8");
    const expectedBytes = Buffer.from(typeof validCode === "string" ? validCode : "\x00", "utf-8");
    const same = codeBytes.length === expectedBytes.length && timingSafeEqual(codeBytes, expectedBytes);

    if (!same || codeExpired || typeof code !== "string") {
      recordFailedAttempt(state);
      this.recordIpFailure(ip);
      this.send(ws, { type: "auth_error", message: "invalid or expired pairing code" });
      return;
    }

    const token = randomBytes(32).toString("hex");
    const hash = sha256hex(token);
    this.tokenStore.push({ hash, issuedAt: now });
    void persistTokenStore(this.bridgeDir, this.tokenStore);

    state.authed = true;
    state.failedAttempts = 0;
    this.send(ws, { type: "paired", token });
    this.rotatePairCode();
  }

  handleAuth(ws, state, token, ip) {
    if (this.isIpRateLimited(ip) || isRateLimited(state)) {
      this.send(ws, { type: "auth_error", message: "too many attempts — try again later" });
      return;
    }

    if (typeof token !== "string" || token.length !== 64) {
      recordFailedAttempt(state);
      this.recordIpFailure(ip);
      this.send(ws, { type: "auth_error", message: "invalid token format" });
      return;
    }

    const hash = sha256hex(token);
    const now = Date.now();
    let matched = false;
    for (const entry of this.tokenStore) {
      const storedBuf = Buffer.from(entry.hash, "hex");
      const hashBuf = Buffer.from(hash, "hex");
      if (storedBuf.length === hashBuf.length && timingSafeEqual(storedBuf, hashBuf)) {
        if (now - entry.issuedAt > TOKEN_TTL_MS) break; // expired
        matched = true;
        break;
      }
    }

    if (!matched) {
      recordFailedAttempt(state);
      this.recordIpFailure(ip);
      this.send(ws, { type: "auth_error", message: "invalid token" });
      return;
    }

    state.authed = true;
    state.failedAttempts = 0;
    this.send(ws, { type: "authed" });
  }

  // ── Pane handlers ───────────────────────────────────────────────────────
  handlePanesList(ws) {
    this.send(ws, { type: "panes", panes: this.serializePanes() });
  }

  handlePaneSubscribe(ws, state, paneId) {
    if (typeof paneId !== "string" || !paneId) return;
    state.subscriptions.add(paneId);

    // Send scrollback
    if (this.deps.hasPane(paneId)) {
      try {
        const buf = this.deps.getPaneBuffer(paneId);
        let scrollback = typeof buf === "string" ? buf : (buf?.readRawText?.() || "");
        if (scrollback.length > SCROLLBACK_MAX_BYTES) {
          scrollback = scrollback.slice(scrollback.length - SCROLLBACK_MAX_BYTES);
        }
        if (scrollback.length > 0) {
          this.send(ws, { type: "pane.output", paneId, data: scrollback });
        }
      } catch {}
    }
  }

  handlePaneInput(ws, paneId, data) {
    if (typeof paneId !== "string" || !paneId || typeof data !== "string") {
      this.send(ws, { type: "error", message: "invalid pane.input frame" });
      return;
    }
    if (data.length > PANE_INPUT_MAX_BYTES) {
      this.send(ws, { type: "error", message: "pane.input data too large" });
      return;
    }
    if (!this.deps.hasPane(paneId)) {
      this.send(ws, { type: "error", message: `pane not found: ${paneId}` });
      return;
    }
    try {
      this.deps.writePaneInput(paneId, data);
    } catch (err) {
      this.send(ws, { type: "error", message: `write failed: ${err.message}` });
    }
  }

  handlePaneResize(ws, paneId, cols, rows) {
    if (typeof paneId !== "string" || !paneId) {
      this.send(ws, { type: "error", message: "invalid pane.resize frame" });
      return;
    }
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0 || cols > 1000 || rows > 1000) {
      this.send(ws, { type: "error", message: "invalid pane.resize dimensions" });
      return;
    }
    if (!this.deps.hasPane(paneId)) {
      this.send(ws, { type: "error", message: `pane not found: ${paneId}` });
      return;
    }
    try {
      this.deps.resizePane(paneId, cols, rows);
    } catch (err) {
      this.send(ws, { type: "error", message: `resize failed: ${err.message}` });
    }
  }

  handleMissionsList(ws) {
    try {
      const missions = this.serializeMissions();
      this.send(ws, { type: "missions", missions });
    } catch {
      this.send(ws, { type: "missions", missions: [] });
    }
  }

  handleSquadStatus(ws) {
    const panes = this.serializePanes();
    const missions = this.serializeMissions();
    this.send(ws, { type: "squad", panes, missions });
  }

  // ── Serialization ───────────────────────────────────────────────────────
  serializePanes() {
    const panes = this.deps.listPanes() || [];
    return panes.map((p) => ({
      id: p.paneId || p.id,
      title: p.label || p.agent,
      status: p.status,
      cwd: p.cwd || p.workspacePath,
      agent: p.agent,
      model: p.model,
      missionId: p.missionId,
    }));
  }

  serializeMissions() {
    const missions = this.deps.listMissions() || [];
    return missions.map((m) => ({
      id: m.id,
      title: m.title,
      status: m.status,
      workspaceId: m.workspace,
      summary: m.summary,
      createdAt: m.created_at,
      updatedAt: m.updated_at,
    }));
  }

  send(ws, payload) {
    try {
      if (ws.readyState === 1) ws.send(JSON.stringify(payload));
    } catch {}
  }

  getStatus() {
    return {
      running: this.running,
      port: this.port,
      bindAddr: this.bindAddr,
      connectedClients: this.clients.size,
      authenticatedClients: [...this.clients.values()].filter((s) => s.authed).length,
      pairCode: this.getPairCode(),
      tokenCount: this.tokenStore.length,
    };
  }
}

// ─── Bridge Handlers ────────────────────────────────────────────────────────

/**
 * Creates remote bridge handlers for the MCP bridge.
 *
 * @param {Object} opts
 * @param {Object} opts.ptyManager - PtyManager instance
 * @param {Object} opts.memoryStore - Memory store (for missions)
 * @param {Object} [opts.hooksManager] - Hooks manager for events
 * @param {Function} [opts.getCurrentWorkspacePath] - () => string
 * @param {string} [opts.dataDir] - Data directory for TLS/tokens
 */
function createRemoteBridgeHandlers(opts) {
  const { ptyManager, memoryStore, hooksManager } = opts;
  const dataDir = opts.dataDir || path.join(require("node:os").homedir(), ".codebrain");

  let bridge = null;

  function getOrCreateBridge() {
    if (bridge) return bridge;

    bridge = new RemoteBridge({
      dataDir,
      port: opts.port || undefined,
      hasPane: (paneId) => ptyManager?.hasPane?.(paneId) || false,
      getPaneBuffer: (paneId) => ptyManager?.getBuffer?.(paneId) || "",
      writePaneInput: (paneId, data) => ptyManager?.write?.(paneId, data, false),
      resizePane: (paneId, cols, rows) => ptyManager?.resize?.(paneId, cols, rows),
      listPanes: () => ptyManager?.list?.() || [],
      listMissions: () => {
        if (!memoryStore) return [];
        try {
          const result = memoryStore.listMissions({ limit: 100 });
          return result.ok ? (result.missions || []) : [];
        } catch { return []; }
      },
    });

    // Wire PTY data forwarding
    if (ptyManager) {
      ptyManager.on?.("data", ({ paneId, data }) => {
        bridge.onPtyData(paneId, data);
      });

      // Broadcast pane list changes
      ptyManager.on?.("spawn", () => { bridge.broadcastPanes(); });
      ptyManager.on?.("exit", () => { bridge.broadcastPanes(); });
    }

    // Fire hooks
    bridge.on("pairCode", (code) => {
      if (hooksManager) {
        try { hooksManager.fire("remote_pair_code", { code }); } catch {}
      }
    });

    return bridge;
  }

  return {
    /**
     * Start the remote bridge WSS server.
     */
    async remoteBridgeStart({ port } = {}) {
      const b = getOrCreateBridge();
      if (port) b.port = port;
      const result = await b.start();
      return result;
    },

    /**
     * Stop the remote bridge WSS server.
     */
    async remoteBridgeStop() {
      if (!bridge) return { ok: true };
      return bridge.stop();
    },

    /**
     * Get remote bridge status: running, port, clients, pairing code.
     */
    async remoteBridgeStatus() {
      if (!bridge) {
        return {
          ok: true,
          data: {
            running: false,
            port: parseInt(process.env.CODEBRAIN_REMOTE_PORT || "8789", 10),
            connectedClients: 0,
            authenticatedClients: 0,
            pairCode: { code: "------", expiresAt: 0 },
            tokenCount: 0,
          },
        };
      }
      return { ok: true, data: bridge.getStatus() };
    },

    /**
     * Get the current pairing code (for display in UI).
     */
    async remoteBridgePairCode() {
      if (!bridge) return { ok: false, error: "bridge not started" };
      return { ok: true, data: bridge.getPairCode() };
    },

    /**
     * Revoke all issued tokens (force re-pairing on all devices).
     */
    async remoteBridgeRevokeTokens() {
      if (!bridge) return { ok: false, error: "bridge not started" };
      bridge.revokeAllTokens();
      return { ok: true };
    },
  };
}

module.exports = { createRemoteBridgeHandlers, RemoteBridge };
