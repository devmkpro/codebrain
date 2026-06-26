"use strict";

/**
 * Request Logger — SQLite-backed automatic HTTP request capture.
 *
 * Intercepts ALL network requests from CDP events and stores them
 * in a SQLite database with full details: timestamp, URL, method,
 * status, headers, body, timing, site URL, and more.
 *
 * Features:
 * - Auto-captures Network.requestWillBeSent, responseReceived, loadingFinished
 * - Stores request + response bodies (via getResponseBody)
 * - Query/search by URL, method, status, time range
 * - Export as JSON/CSV
 * - Auto-creates DB on first use
 * - WAL mode for concurrent reads
 */

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

let Database;
try {
  Database = require("better-sqlite3");
} catch {
  // better-sqlite3 not installed — logger will be a no-op
  Database = null;
}

const DEFAULT_DB_DIR = path.join(os.homedir(), ".codebrain");
const DEFAULT_DB_PATH = path.join(DEFAULT_DB_DIR, "request-log.db");

// Max body size to store (100KB)
const MAX_BODY_SIZE = 100 * 1024;

class RequestLogger {
  constructor(dbPath, opts) {
    this.dbPath = dbPath || DEFAULT_DB_PATH;
    this.opts = opts || {};
    this.db = null;
    this._insertStmt = null;
    this._initialized = false;
  }

  /**
   * Initialize the SQLite database and create tables.
   */
  init() {
    if (this._initialized) return;
    if (!Database) {
      console.log("[RequestLogger] better-sqlite3 not available — logger disabled");
      return;
    }

    try {
      // Ensure directory exists
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      this.db = new Database(this.dbPath);

      // WAL mode for better concurrent performance
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("synchronous = NORMAL");

      // Create table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp INTEGER NOT NULL,
          site_url TEXT,
          url TEXT NOT NULL,
          method TEXT NOT NULL DEFAULT 'GET',
          status INTEGER,
          status_text TEXT,
          request_headers TEXT,
          request_body TEXT,
          response_headers TEXT,
          response_body TEXT,
          content_type TEXT,
          resource_type TEXT,
          cdp_request_id TEXT,
          timing_ms REAL,
          size_bytes INTEGER,
          error TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);
        CREATE INDEX IF NOT EXISTS idx_requests_url ON requests(url);
        CREATE INDEX IF NOT EXISTS idx_requests_method ON requests(method);
        CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
        CREATE INDEX IF NOT EXISTS idx_requests_site ON requests(site_url);
        CREATE INDEX IF NOT EXISTS idx_requests_cdp_id ON requests(cdp_request_id);
      `);

      this._insertStmt = this.db.prepare(`
        INSERT INTO requests (
          timestamp, site_url, url, method, status, status_text,
          request_headers, request_body, response_headers, response_body,
          content_type, resource_type, cdp_request_id, timing_ms, size_bytes, error
        ) VALUES (
          @timestamp, @site_url, @url, @method, @status, @status_text,
          @request_headers, @request_body, @response_headers, @response_body,
          @content_type, @resource_type, @cdp_request_id, @timing_ms, @size_bytes, @error
        )
      `);

      this._initialized = true;
      console.log(`[RequestLogger] Initialized: ${this.dbPath}`);
    } catch (err) {
      console.error(`[RequestLogger] Init failed: ${err.message}`);
      this.db = null;
    }
  }

  /**
   * Log a request from CDP Network.requestWillBeSent event.
   */
  logRequest(event) {
    if (!this.db || !this._insertStmt) return;
    try {
      const params = event.params || {};
      const req = params.request || {};

      this._insertStmt.run({
        timestamp: Math.round((params.timestamp || Date.now() / 1000) * 1000),
        site_url: params.frameId ? null : null, // Will be updated later
        url: req.url || "",
        method: req.method || "GET",
        status: null,
        status_text: null,
        request_headers: req.headers ? JSON.stringify(req.headers) : null,
        request_body: req.postData ? req.postData.slice(0, MAX_BODY_SIZE) : null,
        response_headers: null,
        response_body: null,
        content_type: req.headers?.["content-type"] || null,
        resource_type: params.type || null,
        cdp_request_id: params.requestId || null,
        timing_ms: null,
        size_bytes: null,
        error: null,
      });
    } catch (err) {
      console.error(`[RequestLogger] logRequest error: ${err.message}`);
    }
  }

  /**
   * Update request with response info from CDP Network.responseReceived event.
   */
  logResponse(event) {
    if (!this.db) return;
    try {
      const params = event.params || {};
      const resp = params.response || {};
      const requestId = params.requestId;

      if (!requestId) return;

      // Update the existing request row
      this.db.prepare(`
        UPDATE requests SET
          status = ?,
          status_text = ?,
          response_headers = ?,
          content_type = ?,
          site_url = COALESCE(site_url, ?)
        WHERE cdp_request_id = ?
      `).run(
        resp.status || null,
        resp.statusText || null,
        resp.headers ? JSON.stringify(resp.headers) : null,
        resp.headers?.["content-type"] || null,
        resp.url ? new URL(resp.url).origin : null,
        requestId
      );
    } catch (err) {
      console.error(`[RequestLogger] logResponse error: ${err.message}`);
    }
  }

  /**
   * Update request with timing/size from CDP Network.loadingFinished event.
   */
  logLoadingFinished(event) {
    if (!this.db) return;
    try {
      const params = event.params || {};
      const requestId = params.requestId;
      if (!requestId) return;

      this.db.prepare(`
        UPDATE requests SET
          timing_ms = ?,
          size_bytes = ?
        WHERE cdp_request_id = ?
      `).run(
        params.timestamp ? (params.timestamp * 1000 - (this._getRequestTimestamp(requestId) || 0)) : null,
        params.encodedDataLength || null,
        requestId
      );
    } catch (err) {
      console.error(`[RequestLogger] logLoadingFinished error: ${err.message}`);
    }
  }

  /**
   * Update request with error from CDP Network.loadingFailed event.
   */
  logLoadingFailed(event) {
    if (!this.db) return;
    try {
      const params = event.params || {};
      const requestId = params.requestId;
      if (!requestId) return;

      this.db.prepare(`
        UPDATE requests SET error = ? WHERE cdp_request_id = ?
      `).run(params.errorText || "loading failed", requestId);
    } catch (err) {
      console.error(`[RequestLogger] logLoadingFailed error: ${err.message}`);
    }
  }

  /**
   * Store response body for a request.
   */
  logResponseBody(requestId, body) {
    if (!this.db || !requestId || !body) return;
    try {
      const truncated = typeof body === "string" ? body.slice(0, MAX_BODY_SIZE) : String(body).slice(0, MAX_BODY_SIZE);
      this.db.prepare(`UPDATE requests SET response_body = ? WHERE cdp_request_id = ?`)
        .run(truncated, requestId);
    } catch (err) {
      console.error(`[RequestLogger] logResponseBody error: ${err.message}`);
    }
  }

  /**
   * Get request timestamp by CDP request ID (helper).
   */
  _getRequestTimestamp(requestId) {
    if (!this.db) return null;
    try {
      const row = this.db.prepare(`SELECT timestamp FROM requests WHERE cdp_request_id = ?`).get(requestId);
      return row?.timestamp || null;
    } catch {
      return null;
    }
  }

  /**
   * Query requests with filters.
   */
  query(opts) {
    if (!this.db) return [];
    opts = opts || {};

    let where = [];
    let params = [];

    if (opts.url_filter) {
      where.push("url LIKE ?");
      params.push(`%${opts.url_filter}%`);
    }
    if (opts.method) {
      where.push("method = ?");
      params.push(opts.method.toUpperCase());
    }
    if (opts.status) {
      where.push("status = ?");
      params.push(parseInt(opts.status, 10));
    }
    if (opts.site_url) {
      where.push("site_url LIKE ?");
      params.push(`%${opts.site_url}%`);
    }
    if (opts.since_ms) {
      where.push("timestamp >= ?");
      params.push(opts.since_ms);
    }
    if (opts.search) {
      where.push("(url LIKE ? OR request_body LIKE ? OR response_body LIKE ?)");
      params.push(`%${opts.search}%`, `%${opts.search}%`, `%${opts.search}%`);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const limit = opts.limit || 100;
    const offset = opts.offset || 0;

    try {
      const rows = this.db.prepare(`
        SELECT * FROM requests ${whereClause}
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset);

      // Also get total count
      const countRow = this.db.prepare(`
        SELECT COUNT(*) as total FROM requests ${whereClause}
      `).get(...params);

      return {
        ok: true,
        requests: rows,
        total: countRow?.total || 0,
        limit,
        offset,
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Get stats about captured requests.
   */
  stats() {
    if (!this.db) return { ok: false, error: "Logger not initialized" };
    try {
      const total = this.db.prepare("SELECT COUNT(*) as c FROM requests").get().c;
      const byMethod = this.db.prepare("SELECT method, COUNT(*) as c FROM requests GROUP BY method ORDER BY c DESC").all();
      const byStatus = this.db.prepare("SELECT status, COUNT(*) as c FROM requests WHERE status IS NOT NULL GROUP BY status ORDER BY c DESC").all();
      const bySite = this.db.prepare("SELECT site_url, COUNT(*) as c FROM requests WHERE site_url IS NOT NULL GROUP BY site_url ORDER BY c DESC LIMIT 10").all();
      const recent = this.db.prepare("SELECT timestamp, url, method, status FROM requests ORDER BY timestamp DESC LIMIT 5").all();

      return {
        ok: true,
        total,
        byMethod,
        byStatus,
        topSites: bySite,
        recent,
        dbPath: this.dbPath,
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Export requests as JSON string.
   */
  exportJson(opts) {
    const result = this.query({ ...opts, limit: opts?.limit || 10000 });
    if (!result.ok) return result;
    return { ok: true, json: JSON.stringify(result.requests, null, 2), count: result.requests.length };
  }

  /**
   * Export requests as CSV string.
   */
  exportCsv(opts) {
    const result = this.query({ ...opts, limit: opts?.limit || 10000 });
    if (!result.ok) return result;

    const headers = ["timestamp", "method", "status", "url", "site_url", "content_type", "resource_type", "timing_ms", "size_bytes", "error"];
    const csvLines = [headers.join(",")];

    for (const row of result.requests) {
      const line = headers.map(h => {
        const val = row[h];
        if (val === null || val === undefined) return "";
        const str = String(val);
        return str.includes(",") || str.includes('"') || str.includes("\n")
          ? `"${str.replace(/"/g, '""')}"` : str;
      }).join(",");
      csvLines.push(line);
    }

    return { ok: true, csv: csvLines.join("\n"), count: result.requests.length };
  }

  /**
   * Clear all logged requests.
   */
  clear() {
    if (!this.db) return { ok: false, error: "Logger not initialized" };
    try {
      this.db.exec("DELETE FROM requests");
      return { ok: true, message: "All requests cleared" };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Close the database connection.
   */
  close() {
    if (this.db) {
      try { this.db.close(); } catch {}
      this.db = null;
      this._initialized = false;
    }
  }
}

// Singleton instance
let _instance = null;

function getRequestLogger(dbPath) {
  if (!_instance) {
    _instance = new RequestLogger(dbPath);
    _instance.init();
  }
  return _instance;
}

module.exports = { RequestLogger, getRequestLogger };
