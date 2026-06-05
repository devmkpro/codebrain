"use strict";

/**
 * Chrome DevTools Protocol (CDP) Client
 *
 * Connects to Chrome's debugging port for native browser control.
 * Supports auto-detection, reconnection, and event buffering.
 *
 * Portado do mcp-browser-bridge com melhorias:
 * - Multi-port detection (9222, 9223, 9224)
 * - Reconnection com exponential backoff
 * - Event buffer para console/network
 */

const http = require("http");
const WebSocket = require("ws");

class CDPClient {
  constructor({ log, debug }) {
    this.log = log || (() => {});
    this.debug = debug || false;
    this.ws = null;
    this.callbacks = new Map();
    this.msgId = 0;
    this.connected = false;
    this.browserWsUrl = null;
    this.activePort = null;
    this._events = [];
    this._captureEnabled = false;
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 5;
    this._reconnectTimer = null;
  }

  /**
   * Discover Chrome debugging targets on a given port.
   */
  async discoverTargets(port) {
    port = port || this.activePort || 9222;
    return new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}/json`, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const targets = JSON.parse(data);
            resolve(targets);
          } catch (e) {
            reject(new Error("Failed to parse Chrome targets"));
          }
        });
      });
      req.on("error", (e) => {
        reject(
          new Error(
            `Chrome not found on port ${port}. Start Chrome with --remote-debugging-port=${port}`
          )
        );
      });
      req.setTimeout(3000, () => {
        req.destroy();
        reject(new Error(`Chrome discovery timeout on port ${port}`));
      });
    });
  }

  /**
   * Check if Chrome is available on any debug port.
   * Returns { available, port, targets } or { available: false }.
   */
  async detect() {
    const envPort = process.env.CHROME_DEBUG_PORT
      ? parseInt(process.env.CHROME_DEBUG_PORT, 10)
      : null;
    const ports = envPort ? [envPort] : [9222, 9223, 9224];

    for (const port of ports) {
      try {
        const targets = await this.discoverTargets(port);
        return { available: true, port, targets };
      } catch {
        // try next port
      }
    }
    return { available: false, port: null, targets: null };
  }

  /**
   * Connect to a specific Chrome page target via WebSocket.
   */
  async connect(port) {
    if (this.connected) return;

    port = port || this.activePort || 9222;
    const targets = await this.discoverTargets(port);

    // Find the first page target
    const pageTarget = targets.find(
      (t) => t.type === "page" && t.webSocketDebuggerUrl
    );
    if (!pageTarget) {
      throw new Error(
        "No Chrome page target found. Open a tab in Chrome first."
      );
    }

    this.browserWsUrl = pageTarget.webSocketDebuggerUrl;
    this.activePort = port;
    this.log(
      `[CDP] Connecting to Chrome: ${pageTarget.title} (${pageTarget.url}) on port ${port}`
    );

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.browserWsUrl);

      this.ws.on("open", () => {
        this.connected = true;
        this._reconnectAttempts = 0;
        this.log("[CDP] Connected to Chrome via DevTools Protocol");
        // Enable DOM + Network + Runtime for event capture
        this._enableCapture().catch(() => {});
        resolve();
      });

      this.ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this._handleMessage(msg);
        } catch (e) {
          if (this.debug) this.log("[CDP] Failed to parse message:", e.message);
        }
      });

      this.ws.on("close", () => {
        this.connected = false;
        this.log("[CDP] Connection closed");
        this._attemptReconnect();
      });

      this.ws.on("error", (err) => {
        if (!this.connected) {
          reject(new Error(`CDP connection error: ${err.message}`));
        }
        this.connected = false;
      });
    });
  }

  /**
   * Ensure connected, auto-connect if needed.
   */
  async ensureConnected() {
    if (!this.connected) {
      if (!this.activePort) {
        const det = await this.detect();
        if (!det.available) {
          throw new Error(
            "Chrome not found. Start Chrome with --remote-debugging-port=9222"
          );
        }
        this.activePort = det.port;
      }
      await this.connect(this.activePort);
    }
  }

  /**
   * Send a CDP command and wait for response.
   */
  async send(method, params) {
    params = params || {};
    await this.ensureConnected();

    const id = ++this.msgId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.callbacks.delete(id);
        reject(new Error(`CDP timeout for ${method}`));
      }, 30000);

      this.callbacks.set(id, { resolve, reject, timeout });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        clearTimeout(timeout);
        this.callbacks.delete(id);
        reject(new Error(`CDP send error: ${err.message}`));
      }
    });
  }

  /**
   * Enable Runtime/Network/DOM capture for event buffering.
   */
  async _enableCapture() {
    if (this._captureEnabled) return;
    try {
      await this.send("Runtime.enable");
      await this.send("Network.enable");
      await this.send("DOM.enable");
      this._captureEnabled = true;
    } catch (e) {
      this.log("[CDP] Event capture warning:", e.message);
    }
  }

  /**
   * Handle incoming CDP message.
   */
  _handleMessage(msg) {
    if (msg.id && this.callbacks.has(msg.id)) {
      const { resolve, reject, timeout } = this.callbacks.get(msg.id);
      clearTimeout(timeout);
      this.callbacks.delete(msg.id);

      if (msg.error) {
        reject(new Error(`CDP error: ${msg.error.message}`));
      } else {
        resolve(msg.result);
      }
    } else if (msg.method) {
      // CDP event — store for console/network tools
      this._handleEvent(msg);
    }
  }

  /**
   * Handle CDP events — buffer for console/network tools.
   */
  _handleEvent(msg) {
    // Only buffer known event types
    const buffered = msg.method === "Runtime.consoleAPICalled"
      || msg.method === "Runtime.exceptionThrown"
      || msg.method === "Network.requestWillBeSent"
      || msg.method === "Network.responseReceived"
      || msg.method === "Network.loadingFinished"
      || msg.method === "Network.loadingFailed";

    if (buffered) {
      this._events.push({
        method: msg.method,
        params: msg.params,
        timestamp: Date.now(),
      });
      // Keep only last 1000 events
      if (this._events.length > 1000) {
        this._events = this._events.slice(-1000);
      }
    }
  }

  /**
   * Get stored events, optionally filtered by CDP method.
   */
  getEvents(filter) {
    if (!filter) return [...this._events];
    return this._events.filter((e) => e.method === filter);
  }

  /**
   * Clear stored events.
   */
  clearEvents() {
    this._events = [];
  }

  /**
   * Get console messages from buffered events.
   */
  getConsoleMessages(opts) {
    opts = opts || {};
    let msgs = this._events
      .filter((e) => e.method === "Runtime.consoleAPICalled")
      .map((e) => ({
        type: e.params.type,
        text: (e.params.args || [])
          .map((a) => a.value || a.description || "")
          .join(" "),
        timestamp: e.params.timestamp,
        url: e.params.executionContextId,
      }));

    if (opts.level) msgs = msgs.filter((m) => m.type === opts.level);
    if (opts.limit) msgs = msgs.slice(-opts.limit);
    return msgs;
  }

  /**
   * Get network requests from buffered events.
   */
  getNetworkRequests(opts) {
    opts = opts || {};
    let reqs = this._events
      .filter((e) => e.method === "Network.requestWillBeSent")
      .map((e) => ({
        method: e.params.request.method,
        url: e.params.request.url,
        type: e.params.type,
        timestamp: e.params.timestamp,
        id: e.params.requestId,
      }));

    if (opts.method) reqs = reqs.filter((r) => r.method === opts.method);
    if (opts.url_pattern)
      reqs = reqs.filter((r) => r.url.includes(opts.url_pattern));
    if (opts.limit) reqs = reqs.slice(-opts.limit);
    return reqs;
  }

  /**
   * Attempt reconnection with exponential backoff.
   */
  _attemptReconnect() {
    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      this.log("[CDP] Max reconnection attempts reached");
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts), 16000);
    this._reconnectAttempts++;
    this.log(
      `[CDP] Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts})`
    );
    this._reconnectTimer = setTimeout(async () => {
      try {
        await this.connect(this.activePort);
      } catch {
        // will retry on next attempt
      }
    }, delay);
  }

  /**
   * Disconnect from Chrome.
   */
  async disconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this._captureEnabled = false;
    this.callbacks.clear();
  }

  /**
   * Check if connected.
   */
  isConnected() {
    return this.connected;
  }

  /**
   * Get current browser info (URL, title).
   */
  async getCurrentUrl() {
    try {
      const result = await this.send("Runtime.evaluate", {
        expression:
          "JSON.stringify({url: location.href, title: document.title})",
        returnByValue: true,
      });
      return JSON.parse(result.result.value);
    } catch {
      return { url: null, title: null };
    }
  }
}

module.exports = { CDPClient };
