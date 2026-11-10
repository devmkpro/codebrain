"use strict";

// UC browser sessions live in isolated Python processes.  The MCP process only
// owns lifecycle, request correlation, response limits, and cleanup.

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { CDPClient } = require("./cdp-client.js");
const { createNativeChromeHandlers, screenshotArtifact } = require("./native-chrome-handlers.js");

const DEFAULT_CALL_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_CHARS = 2_000_000;
const MAX_SESSIONS = 3;
const SESSION_IDLE_TIMEOUT_MS = 20 * 60 * 1000;

function resolveWorkerPath(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.CODEBRAIN_UC_WORKER,
    process.resourcesPath && path.join(process.resourcesPath, "scraping", "uc_worker.py"),
    path.resolve(__dirname, "../../../resources/scraping/uc_worker.py"),
    path.resolve(process.cwd(), "resources/scraping/uc_worker.py"),
  ].filter(Boolean);

  const workerPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!workerPath) {
    throw new Error(
      `UC worker not found. Checked: ${candidates.join(", ")}. ` +
        "Set CODEBRAIN_UC_WORKER to the absolute path of uc_worker.py."
    );
  }
  return workerPath;
}

function pythonCandidates(explicitPython) {
  if (explicitPython) return [{ command: explicitPython, args: [] }];
  if (process.env.CODEBRAIN_PYTHON) {
    return [{ command: process.env.CODEBRAIN_PYTHON, args: [] }];
  }
  if (process.platform === "win32") {
    return [
      { command: "py", args: ["-3"] },
      { command: "python", args: [] },
      { command: "python3", args: [] },
    ];
  }
  return [
    { command: "python3", args: [] },
    { command: "python", args: [] },
  ];
}

function normalizeStartArgs(args = {}) {
  return {
    headless: args.headless === true,
    profile_path: args.profile_path || null,
    profile_directory: args.profile_directory || null,
    browser_binary: args.browser_binary || null,
    version_main: Number.isInteger(args.version_main) ? args.version_main : null,
    window_width: Math.max(320, Math.min(7680, Math.trunc(Number(args.window_width)) || 1920)),
    window_height: Math.max(320, Math.min(4320, Math.trunc(Number(args.window_height)) || 1080)),
    page_load_timeout_ms: Math.max(
      5_000,
      Math.min(300_000, Number(args.page_load_timeout_ms) || 90_000)
    ),
    block_images: args.block_images === true,
  };
}

function parseDebuggerAddress(address) {
  const match = /^(?:127\.0\.0\.1|localhost):(\d{1,5})$/.exec(address || "");
  if (!match) throw new Error(`Invalid UC debugger address: ${address || "missing"}`);
  const port = Number(match[1]);
  if (port < 1 || port > 65535) throw new Error(`Invalid UC debugger port: ${match[1]}`);
  return port;
}

async function attachCdp(debuggerAddress, context = {}) {
  const port = parseDebuggerAddress(debuggerAddress);
  const cdp = new CDPClient({ log: () => {} });
  await cdp.connect(port);
  return { cdp, intercept: createNativeChromeHandlers(cdp, context) };
}

class UcWorkerProcess {
  constructor(child, label) {
    this.child = child;
    this.label = label;
    this.pending = new Map();
    this.stderr = "";
    this.closed = false;
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    const stdout = readline.createInterface({ input: child.stdout });
    stdout.on("line", (line) => this.onLine(line));
    child.stderr.on("data", (chunk) => {
      this.stderr = (this.stderr + chunk.toString("utf8")).slice(-16_000);
    });
    child.on("error", (error) => this.failAll(error));
    child.on("exit", (code, signal) => {
      const detail = this.stderr.trim();
      this.failAll(
        new Error(`UC worker exited (${code ?? signal ?? "unknown"})${detail ? `: ${detail}` : ""}`)
      );
    });
  }

  onLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.stderr = (this.stderr + `\n${line}`).slice(-16_000);
      return;
    }

    if (message.event === "ready") {
      this.resolveReady(message);
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.ok === false) {
      const error = new Error(message.error || "UC worker request failed");
      error.code = message.code;
      error.details = message.details;
      pending.reject(error);
      return;
    }
    pending.resolve(message.result);
  }

  failAll(error) {
    if (this.closed) return;
    this.closed = true;
    this.rejectReady(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  async call(command, args = {}, timeoutMs = DEFAULT_CALL_TIMEOUT_MS) {
    if (this.closed || !this.child.stdin.writable) {
      throw new Error("UC worker is not running");
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`UC worker command '${command}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, command, args })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  async stop() {
    if (this.closed) return;
    try {
      await this.call("stop", {}, 10_000);
    } catch {}
    this.closed = true;
    try {
      this.child.stdin.end();
    } catch {}
    const killTimer = setTimeout(() => {
      try {
        this.child.kill();
      } catch {}
    }, 2_000);
    if (killTimer.unref) killTimer.unref();
  }
}

async function spawnWorker({ workerPath, python, startupTimeoutMs = 15_000 }) {
  const child = spawn(python.command, [...python.args, "-u", workerPath], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  const worker = new UcWorkerProcess(child, `${python.command} ${python.args.join(" ")}`.trim());
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(
      () => reject(new Error("UC worker startup timed out")),
      startupTimeoutMs
    );
    if (timer.unref) timer.unref();
  });
  await Promise.race([worker.ready, timeout]);
  return worker;
}

function truncateResult(result) {
  const raw = JSON.stringify(result);
  if (raw.length <= MAX_RESPONSE_CHARS) return result;
  return {
    ok: false,
    error: `UC response exceeded ${MAX_RESPONSE_CHARS} characters`,
    code: "response_too_large",
    response_chars: raw.length,
  };
}

class ScrapingSessionManager {
  constructor(opts = {}) {
    this.opts = opts;
    this.sessions = new Map();
    this.cleanupTimer = setInterval(() => this.cleanupIdle(), 60_000);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  async start(args = {}) {
    if (this.sessions.size >= (this.opts.maxSessions || MAX_SESSIONS)) {
      return {
        ok: false,
        error: `Maximum of ${this.opts.maxSessions || MAX_SESSIONS} UC sessions reached`,
        code: "session_limit",
      };
    }

    const workerPath = resolveWorkerPath(this.opts.workerPath);
    const failures = [];
    for (const python of pythonCandidates(this.opts.python)) {
      let worker;
      try {
        worker = await spawnWorker({ workerPath, python });
        const result = await worker.call("start", normalizeStartArgs(args), 180_000);
        const sessionId = randomUUID();
        let cdp = null;
        let intercept = null;
        let cdpError = null;
        try {
          ({ cdp, intercept } = await attachCdp(result.debugger_address, this.opts));
        } catch (error) {
          cdpError = error.message;
        }
        this.sessions.set(sessionId, {
          worker,
          cdp,
          intercept,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
        });
        return {
          ok: true,
          session_id: sessionId,
          python: worker.label,
          network_capture: Boolean(cdp),
          ...(cdpError ? { network_capture_error: cdpError } : {}),
          ...result,
        };
      } catch (error) {
        failures.push(`${python.command}: ${error.message}`);
        if (worker) await worker.stop();
      }
    }

    return {
      ok: false,
      error: "Could not start an undetected-chromedriver session",
      code: "uc_start_failed",
      details: failures,
      install:
        "Install Python dependencies with: python -m pip install undetected-chromedriver selenium",
    };
  }

  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      const error = new Error(`Unknown UC session: ${sessionId}`);
      error.code = "session_not_found";
      throw error;
    }
    session.lastUsedAt = Date.now();
    return session;
  }

  async call(sessionId, command, args = {}, timeoutMs) {
    const session = this.getSession(sessionId);
    return truncateResult(await session.worker.call(command, args, timeoutMs));
  }

  async stop(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: true, stopped: false, session_id: sessionId };
    this.sessions.delete(sessionId);
    if (session.cdp) await session.cdp.disconnect().catch(() => {});
    await session.worker.stop();
    return { ok: true, stopped: true, session_id: sessionId };
  }

  async cleanupIdle() {
    const now = Date.now();
    const timeout = this.opts.idleTimeoutMs || SESSION_IDLE_TIMEOUT_MS;
    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastUsedAt > timeout) await this.stop(sessionId);
    }
  }

  list() {
    const now = Date.now();
    return [...this.sessions.entries()].map(([sessionId, session]) => ({
      session_id: sessionId,
      age_ms: now - session.createdAt,
      idle_ms: now - session.lastUsedAt,
      running: !session.worker.closed,
      network_capture: Boolean(session.cdp),
    }));
  }

  getCdpSession(sessionId) {
    const session = this.getSession(sessionId);
    if (!session.cdp || !session.intercept) {
      throw new Error("Network capture is unavailable for this UC session");
    }
    return session;
  }
}

function createScrapingHandlers(opts = {}) {
  const manager = opts.scrapingSessionManager || new ScrapingSessionManager({ ...opts.scraping, getCurrentWorkspacePath: opts.getCurrentWorkspacePath });

  return {
    async scrapingSessionStart(args) {
      const normalized = normalizeStartArgs(args);
      const result = await manager.start(normalized);
      if (!result?.ok || !result.session_id) return result;
      const requested_viewport = { width: normalized.window_width, height: normalized.window_height };
      try {
        const { intercept } = manager.getCdpSession(result.session_id);
        const viewport = await intercept.resizeWindow(requested_viewport);
        return { ...result, requested_viewport, viewport, viewport_applied: viewport.ok === true };
      } catch (error) {
        return { ...result, requested_viewport, viewport_applied: false, viewport_error: error.message };
      }
    },
    async scrapingSessionStop({ session_id }) {
      return manager.stop(session_id);
    },
    async scrapingStatus({ session_id } = {}) {
      if (!session_id) return { ok: true, sessions: manager.list() };
      return { ok: true, session_id, ...(await manager.call(session_id, "status")) };
    },
    async scrapingNavigate(args) {
      const { session_id, ...payload } = args;
      return manager.call(session_id, "navigate", payload, (payload.timeout_ms || 90_000) + 20_000);
    },
    async scrapingWait(args) {
      const { session_id, ...payload } = args;
      return manager.call(session_id, "wait", payload, (payload.timeout_ms || 30_000) + 10_000);
    },
    async scrapingEvaluate(args) {
      const { session_id, ...payload } = args;
      return manager.call(session_id, "evaluate", payload, (payload.timeout_ms || 30_000) + 10_000);
    },
    async scrapingCapabilities({ session_id }) {
      try {
        const session = manager.getSession(session_id); // Existing session only.
        if (session.worker?.closed) throw new Error("UC session is no longer running");
        let screenshot = false;
        try {
          const attached = manager.getCdpSession(session_id);
          screenshot = attached.cdp?.isConnected?.() === true && typeof attached.intercept?.screenshot === "function";
        } catch {}
        return { ok: true, session_id, capabilities: { navigate: true, evaluate: true, screenshot } };
      } catch (error) {
        return { ok: false, code: "capability_unavailable", error: error.message };
      }
    },
    async scrapingScreenshot({ session_id, full_page = false, selector, inline = false, return_base64 = false, format = "png" }) {
      let session;
      try { session = manager.getCdpSession(session_id); }
      catch (error) { return { ok: false, code: "capability_unavailable", error: error.message }; }
      const capture = selector ? session.intercept?.screenshotElement : session.intercept?.screenshot;
      if (typeof capture !== "function") return { ok: false, code: "capability_unavailable", error: "UC screenshot requires an attached CDP screenshot capability" };
      const options = { inline, return_base64, format };
      const shot = await capture.call(session.intercept, selector || full_page, options);
      return { ...screenshotArtifact(shot, options, opts), session_id };
    },
    async scrapingExtract(args) {
      const { session_id, ...payload } = args;
      return manager.call(session_id, "extract", payload, 60_000);
    },
    async scrapingFetchBatch(args) {
      const { session_id, ...payload } = args;
      const urlCount = Math.max(1, payload.urls?.length || 1);
      payload.max_chars_per_item = Math.min(
        payload.max_chars_per_item || 50_000,
        Math.max(100, Math.floor(1_500_000 / urlCount))
      );
      const batches = Math.ceil(
        (payload.urls?.length || 1) / Math.max(1, payload.concurrency || 8)
      );
      const timeout = Math.min(
        360_000,
        batches * (payload.timeout_ms || 30_000) * ((payload.retries || 0) + 1) + 20_000
      );
      return manager.call(session_id, "fetch_batch", payload, timeout);
    },
    async scrapingNetworkLog({ session_id, ...opts }) {
      return manager.getCdpSession(session_id).cdp.getNetworkRequests(opts);
    },
    async scrapingClearNetwork({ session_id }) {
      manager.getCdpSession(session_id).cdp.clearEvents();
      return { ok: true };
    },
    async scrapingInterceptStart({ session_id, ...opts }) {
      return manager.getCdpSession(session_id).intercept.interceptRequests(opts);
    },
    async scrapingInterceptList({ session_id }) {
      return manager.getCdpSession(session_id).intercept.getPausedRequests();
    },
    async scrapingInterceptContinue({ session_id, request_id, overrides }) {
      return manager.getCdpSession(session_id).intercept.continueRequest(request_id, overrides);
    },
    async scrapingInterceptStop({ session_id }) {
      return manager.getCdpSession(session_id).intercept.stopIntercepting();
    },
    scrapingSessionManager: manager,
  };
}

module.exports = {
  createScrapingHandlers,
  ScrapingSessionManager,
  normalizeStartArgs,
  pythonCandidates,
  resolveWorkerPath,
  parseDebuggerAddress,
};
