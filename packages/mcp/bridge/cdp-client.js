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
 * - Auto-launch Chrome if not running
 */

const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const os = require("os");
const { spawn, execSync } = require("child_process");
const fs = require("fs");

// Portable Chromium bundled with Codebrain — resolved relative to this file
// Path: <codebrain-root>/local/chromium/chrome-win/chrome.exe
const CODEBRAIN_ROOT = path.resolve(__dirname, "..", "..", "..");
const PORTABLE_CHROMIUM_WIN = path.join(CODEBRAIN_ROOT, "local", "chromium", "chrome-win", "chrome.exe");
const PORTABLE_CHROMIUM_UNIX = path.join(CODEBRAIN_ROOT, "local", "chromium", "chrome-linux", "chrome");
const PORTABLE_CHROMIUM_MAC = path.join(CODEBRAIN_ROOT, "local", "chromium", "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium");

// Also support packaged app (asar): resources/chromium/...
const PACKAGED_CHROMIUM_WIN = path.join(process.resourcesPath || "", "chromium", "chrome-win", "chrome.exe");
const PACKAGED_CHROMIUM_UNIX = path.join(process.resourcesPath || "", "chromium", "chrome-linux", "chrome");

const CHROME_PATHS_WIN = [
  // 1. Portable Chromium bundled with Codebrain (always preferred)
  PORTABLE_CHROMIUM_WIN,
  PACKAGED_CHROMIUM_WIN,
  // 2. System Chrome/Chromium (fallback only)
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  path.join(os.homedir(), "AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"),
  "C:\\Program Files\\Chromium\\Application\\chromium.exe",
  // NOTE: Brave is intentionally excluded — it uses port 9222 internally
  // and returns 404 on CDP endpoints, causing false detection.
];

const CHROME_PATHS_UNIX = [
  // 1. Portable Chromium bundled with Codebrain
  PORTABLE_CHROMIUM_UNIX,
  PACKAGED_CHROMIUM_UNIX,
  // 2. System Chrome/Chromium
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

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
   * Validates that the response is actually a CDP endpoint (not some other service).
   */
  async discoverTargets(port) {
    port = port || this.activePort || 9222;
    return new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}/json`, (res) => {
        // A non-200 status means the port is occupied by a non-CDP service
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Port ${port} returned HTTP ${res.statusCode} — not a CDP endpoint`));
          return;
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            // Must be an array (list of targets)
            if (!Array.isArray(parsed)) {
              reject(new Error(`Port ${port} is not a Chrome CDP endpoint (unexpected response shape)`));
              return;
            }
            resolve(parsed);
          } catch (e) {
            reject(new Error(`Failed to parse Chrome targets on port ${port}`));
          }
        });
      });
      req.on("error", (e) => {
        reject(new Error(`Chrome not found on port ${port}: ${e.message}`));
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
  async connect(port, directWsUrl) {
    // If already connected via WebSocket that's still open, skip
    if (this.connected && this.ws && this.ws.readyState === 1 /* OPEN */ && !directWsUrl) return;
    // Otherwise reset stale state
    if (this.ws) {
      try { this.ws.terminate(); } catch {}
      this.ws = null;
      this.connected = false;
    }

    port = port || this.activePort || 9222;

    // If a direct WebSocket URL is provided, use it (for tab switching)
    if (directWsUrl) {
      this.browserWsUrl = directWsUrl;
      this.activePort = port;
    } else {
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
    }
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
   * Find the Chrome/Chromium executable on this system.
   */
  _findChromeExecutable() {
    const isWin = process.platform === "win32";
    const paths = isWin ? CHROME_PATHS_WIN : CHROME_PATHS_UNIX;

    for (const p of paths) {
      if (fs.existsSync(p)) return p;
    }

    // Try `where chrome` (Windows) or `which google-chrome` (Unix)
    try {
      const cmd = isWin ? "where chrome" : "which google-chrome || which chromium-browser || which chromium";
      const result = execSync(cmd, { timeout: 3000, encoding: "utf-8" }).trim().split("\n")[0].trim();
      if (result && fs.existsSync(result)) return result;
    } catch {
      // not found via PATH
    }

    return null;
  }

  /**
   * Wait for Chrome debugging port to become available.
   * Uses a fast HTTP probe (no WebSocket) to check quickly.
   */
  async _waitForPort(port, timeoutMs) {
    timeoutMs = timeoutMs || 30000;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        await new Promise((resolve, reject) => {
          const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
            res.resume(); // drain
            resolve(true);
          });
          req.setTimeout(1000, () => { req.destroy(); reject(new Error("timeout")); });
          req.on("error", reject);
        });
        return true;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    return false;
  }

  /**
   * Download portable Chromium into local/chromium/ if not already present.
   * Uses the official Chromium snapshot CDN (commondatastorage.googleapis.com).
   * Returns { ok, exe, downloaded } or { ok: false, error }.
   */
  async _downloadChromium() {
    const isWin = process.platform === "win32";
    const isMac = process.platform === "darwin";

    const targetExe = isWin ? PORTABLE_CHROMIUM_WIN
      : isMac ? PORTABLE_CHROMIUM_MAC
      : PORTABLE_CHROMIUM_UNIX;

    // Already exists — nothing to do
    if (fs.existsSync(targetExe)) return { ok: true, exe: targetExe, downloaded: false };

    const platform = isWin ? "Win_x64" : isMac ? "Mac" : "Linux_x64";
    const zipName = isWin ? "chrome-win.zip" : isMac ? "chrome-mac.zip" : "chrome-linux.zip";
    const destDir = path.join(CODEBRAIN_ROOT, "local", "chromium");
    const zipPath = path.join(destDir, "chromium-download.zip");

    try {
      fs.mkdirSync(destDir, { recursive: true });
    } catch {}

    this.log(`[CDP] Portable Chromium not found — downloading...`);

    // 1. Get latest build number
    let buildNum;
    try {
      buildNum = await new Promise((resolve, reject) => {
        const req = http.get(
          `https://commondatastorage.googleapis.com/chromium-browser-snapshots/${platform}/LAST_CHANGE`,
          (res) => {
            let d = "";
            res.on("data", c => d += c);
            res.on("end", () => resolve(d.trim()));
          }
        );
        req.on("error", reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error("timeout")); });
      });
    } catch (err) {
      return { ok: false, error: `Failed to fetch Chromium build number: ${err.message}` };
    }

    this.log(`[CDP] Downloading Chromium build ${buildNum}...`);

    // 2. Download zip via HTTPS redirect
    const downloadUrl = `https://commondatastorage.googleapis.com/chromium-browser-snapshots/${platform}/${buildNum}/${zipName}`;

    try {
      await new Promise((resolve, reject) => {
        const https = require("https");

        function get(url, redirects) {
          redirects = redirects || 0;
          if (redirects > 5) return reject(new Error("Too many redirects"));
          https.get(url, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
              return get(res.headers.location, redirects + 1);
            }
            if (res.statusCode !== 200) {
              return reject(new Error(`HTTP ${res.statusCode} downloading Chromium`));
            }
            const total = parseInt(res.headers["content-length"] || "0", 10);
            let received = 0;
            const out = fs.createWriteStream(zipPath);
            res.on("data", chunk => {
              received += chunk.length;
              if (total > 0) {
                const pct = Math.round(received / total * 100);
                if (pct % 10 === 0) this.log(`[CDP] Downloading Chromium... ${pct}% (${Math.round(received/1024/1024)}MB)`);
              }
            });
            res.pipe(out);
            out.on("finish", resolve);
            out.on("error", reject);
          }).on("error", reject);
        }

        get(downloadUrl);
      });
    } catch (err) {
      try { fs.unlinkSync(zipPath); } catch {}
      return { ok: false, error: `Download failed: ${err.message}` };
    }

    // 3. Extract zip using Node's built-in (requires Node 18.3+) or PowerShell/unzip
    this.log(`[CDP] Extracting Chromium...`);
    try {
      if (isWin) {
        // Use PowerShell Expand-Archive
        const { execSync: exec } = require("child_process");
        exec(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`, {
          timeout: 120000,
          windowsHide: true,
        });
      } else {
        const { execSync: exec } = require("child_process");
        exec(`unzip -o "${zipPath}" -d "${destDir}"`, { timeout: 120000 });
      }
    } catch (err) {
      try { fs.unlinkSync(zipPath); } catch {}
      return { ok: false, error: `Extraction failed: ${err.message}` };
    }

    // 4. Cleanup zip
    try { fs.unlinkSync(zipPath); } catch {}

    // 5. Set executable bit on Linux/Mac
    if (!isWin && fs.existsSync(targetExe)) {
      try { fs.chmodSync(targetExe, 0o755); } catch {}
    }

    if (!fs.existsSync(targetExe)) {
      return { ok: false, error: `Extraction complete but executable not found at: ${targetExe}` };
    }

    this.log(`[CDP] Chromium downloaded and ready: ${targetExe}`);
    return { ok: true, exe: targetExe, downloaded: true };
  }

  /**
   * Launch Chrome/Chromium with remote debugging enabled.
   * If Chrome is already running on the target port, connects to it instead.
   * Auto-downloads portable Chromium if not present.
   * Returns { ok, pid, port, launched } where launched=false means we connected to existing instance.
   */
  async launch(opts) {
    opts = opts || {};
    const port = opts.port || 9223;

    // 1. Check if Chrome is already running on any debug port
    try {
      const det = await this.detect();
      if (det.available) {
        await this.connect(det.port);
        this.log(`[CDP] Connected to existing Chrome on port ${det.port}`);
        return { ok: true, pid: null, port: det.port, launched: false };
      }
    } catch {
      // not running, proceed to launch
    }

    // 2. Auto-download portable Chromium if not present
    const dlResult = await this._downloadChromium();
    if (!dlResult.ok) {
      this.log(`[CDP] Chromium download failed: ${dlResult.error} — falling back to system Chrome`);
    }

    // 3. Find executable (portable first, then system)
    const exe = this._findChromeExecutable();
    if (!exe) {
      return {
        ok: false,
        error: "Chrome/Chromium not found and auto-download failed. Install Google Chrome.",
        searchedPaths: process.platform === "win32" ? CHROME_PATHS_WIN : CHROME_PATHS_UNIX,
      };
    }

    // 3. Prepare user data dir
    const userDataDir = path.join(os.homedir(), ".codebrain", "chrome-profile");
    try {
      fs.mkdirSync(userDataDir, { recursive: true });
    } catch {}

    // 4. Launch Chrome as a detached subprocess
    const args = [
      `--remote-debugging-port=${port}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-sync",
      "--disable-extensions",
      "--no-default-browser-check",
      "--disable-client-side-phishing-detection",
      "--disable-component-update",
      "--disable-default-apps",
      `--user-data-dir=${userDataDir}`,
      "--window-size=1280,800",
    ];

    this.log(`[CDP] Launching Chrome: ${exe} ${args.join(" ")}`);
    const child = spawn(exe, args, {
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    this._launchedPid = child.pid;

    // 5. Wait for port (up to 30s — Chrome can be slow on first launch)
    this.log(`[CDP] Waiting for Chrome to start on port ${port}...`);
    const ready = await this._waitForPort(port, 30000);
    if (!ready) {
      return {
        ok: false,
        error: `Chrome launched (pid ${child.pid}) but port ${port} did not become available within 30s. Try running Chrome manually: "${exe}" --remote-debugging-port=${port}`,
        pid: child.pid,
        exe,
        hint: `Check if another Chrome instance is already running without --remote-debugging-port. If so, close it and try again, or use port ${port + 1}.`,
      };
    }

    // 6. Connect
    await this.connect(port);
    this.log(`[CDP] Chrome launched and connected (pid ${child.pid}, port ${port})`);
    return { ok: true, pid: child.pid, port, launched: true, exe };
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
