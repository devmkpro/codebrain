"use strict";

/**
 * HTTP Fetch/Request bridge handlers — Scraping-first approach.
 *
 * Uses undici (built-in in Node 18+) with TLS fingerprinting to simulate
 * real Chrome/Firefox browsers. First-choice for scraping — faster and
 * lighter than full browser automation.
 *
 * When Cloudflare or similar challenge is detected, returns cfBlocked flag
 * so the agent can fall back to browser_* tools.
 */

const { buildConnector, fetch: undiciFetch, Agent } = require("undici");

// ═══════════════════════════════════════════════════════════════════════════
// TLS FINGERPRINT PROFILES
// ═══════════════════════════════════════════════════════════════════════════

const TLS_PROFILES = {
  "chrome-131": {
    ciphers: [
      "TLS_AES_128_GCM_SHA256",
      "TLS_AES_256_GCM_SHA384",
      "TLS_CHACHA20_POLY1305_SHA256",
      "ECDHE-ECDSA-AES128-GCM-SHA256",
      "ECDHE-RSA-AES128-GCM-SHA256",
      "ECDHE-ECDSA-AES256-GCM-SHA384",
      "ECDHE-RSA-AES256-GCM-SHA384",
      "ECDHE-ECDSA-CHACHA20-POLY1305",
      "ECDHE-RSA-CHACHA20-POLY1305",
      "ECDHE-RSA-AES128-SHA",
      "ECDHE-RSA-AES256-SHA",
      "AES128-GCM-SHA256",
      "AES256-GCM-SHA384",
      "AES128-SHA",
      "AES256-SHA",
    ].join(":"),
    sigalgs:
      "ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256:rsa_pkcs1_sha256:ecdsa_secp384r1_sha384:rsa_pss_rsae_sha384:rsa_pkcs1_sha384:rsa_pss_rsae_sha512:rsa_pkcs1_sha512",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    headers: {
      "sec-ch-ua":
        '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "upgrade-insecure-requests": "1",
    },
  },
  "chrome-mobile": {
    ciphers: [
      "TLS_AES_128_GCM_SHA256",
      "TLS_AES_256_GCM_SHA384",
      "TLS_CHACHA20_POLY1305_SHA256",
      "ECDHE-ECDSA-AES128-GCM-SHA256",
      "ECDHE-RSA-AES128-GCM-SHA256",
      "ECDHE-ECDSA-AES256-GCM-SHA384",
      "ECDHE-RSA-AES256-GCM-SHA384",
      "ECDHE-ECDSA-CHACHA20-POLY1305",
      "ECDHE-RSA-CHACHA20-POLY1305",
    ].join(":"),
    sigalgs:
      "ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256:rsa_pkcs1_sha256:ecdsa_secp384r1_sha384:rsa_pss_rsae_sha384:rsa_pkcs1_sha384",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    headers: {
      "sec-ch-ua":
        '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      "sec-ch-ua-mobile": "?1",
      "sec-ch-ua-platform": '"Android"',
      "upgrade-insecure-requests": "1",
    },
  },
  "firefox-133": {
    ciphers: [
      "TLS_AES_128_GCM_SHA256",
      "TLS_CHACHA20_POLY1305_SHA256",
      "TLS_AES_256_GCM_SHA384",
      "ECDHE-ECDSA-AES128-GCM-SHA256",
      "ECDHE-RSA-AES128-GCM-SHA256",
      "ECDHE-ECDSA-CHACHA20-POLY1305",
      "ECDHE-RSA-CHACHA20-POLY1305",
      "ECDHE-ECDSA-AES256-GCM-SHA384",
      "ECDHE-RSA-AES256-GCM-SHA384",
      "ECDHE-RSA-AES128-SHA256",
      "ECDHE-ECDSA-AES128-SHA256",
      "ECDHE-RSA-AES128-SHA",
      "ECDHE-ECDSA-AES128-SHA",
      "ECDHE-RSA-AES256-SHA",
      "ECDHE-ECDSA-AES256-SHA",
    ].join(":"),
    sigalgs:
      "ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256:rsa_pkcs1_sha256:ecdsa_secp384r1_sha384:rsa_pss_rsae_sha384:rsa_pkcs1_sha384:rsa_pss_rsae_sha512:rsa_pkcs1_sha512",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
    headers: {
      "upgrade-insecure-requests": "1",
    },
  },
};

const DEFAULT_PROFILE = "chrome-131";

// ═══════════════════════════════════════════════════════════════════════════
// COOKIE JAR (in-memory, per-session)
// ═══════════════════════════════════════════════════════════════════════════

class CookieJar {
  constructor() {
    /** @type {Map<string, Map<string, {value:string, path:string, expires:number|null}>>} */
    this.cookies = new Map();
  }

  /**
   * Get cookies for a URL (domain matching).
   */
  getCookiesForUrl(url) {
    try {
      const hostname = new URL(url).hostname;
      const parts = hostname.split(".");
      const matched = [];

      // Match domain and parent domains
      for (let i = 0; i < parts.length - 1; i++) {
        const domain = parts.slice(i).join(".");
        const jar = this.cookies.get(domain);
        if (jar) {
          const now = Date.now();
          for (const [name, cookie] of jar) {
            if (cookie.expires && cookie.expires < now) {
              jar.delete(name); // Expired
              continue;
            }
            matched.push(`${name}=${cookie.value}`);
          }
        }
      }

      return matched.join("; ") || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Parse Set-Cookie headers from response and store them.
   */
  setCookiesFromResponse(url, setCookieHeader) {
    if (!setCookieHeader) return;
    const cookies = Array.isArray(setCookieHeader)
      ? setCookieHeader
      : [setCookieHeader];

    let domain;
    try {
      domain = new URL(url).hostname;
    } catch {
      return;
    }

    for (const cookieStr of cookies) {
      const parts = cookieStr.split(";").map((p) => p.trim());
      const [nameValue, ...attrs] = parts;
      const eqIdx = nameValue.indexOf("=");
      if (eqIdx < 1) continue;

      const name = nameValue.slice(0, eqIdx).trim();
      const value = nameValue.slice(eqIdx + 1).trim();

      let cookieDomain = domain;
      let path = "/";
      let expires = null;

      for (const attr of attrs) {
        const [k, v] = attr.split("=").map((s) => s.trim());
        const kLower = k.toLowerCase();
        if (kLower === "domain" && v) {
          cookieDomain = v.replace(/^\./, "");
        } else if (kLower === "path" && v) {
          path = v;
        } else if (kLower === "expires" && v) {
          expires = new Date(v).getTime();
        } else if (kLower === "max-age" && v) {
          const maxAge = parseInt(v, 10);
          if (!isNaN(maxAge)) expires = Date.now() + maxAge * 1000;
        }
      }

      if (!this.cookies.has(cookieDomain)) {
        this.cookies.set(cookieDomain, new Map());
      }
      this.cookies.get(cookieDomain).set(name, { value, path, expires });
    }
  }

  /**
   * List cookies for a domain (or all).
   */
  list(domain) {
    const result = [];
    for (const [d, jar] of this.cookies) {
      if (domain && d !== domain) continue;
      for (const [name, cookie] of jar) {
        result.push({ domain: d, name, value: cookie.value, path: cookie.path, expires: cookie.expires });
      }
    }
    return result;
  }

  /**
   * Clear cookies for a domain (or all).
   */
  clear(domain) {
    if (domain) {
      this.cookies.delete(domain);
    } else {
      this.cookies.clear();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLOUDFLARE DETECTION
// ═══════════════════════════════════════════════════════════════════════════

const CF_CHALLENGE_MARKERS = [
  "cf-mitigated",
  "challenge-platform",
  "Just a moment",
  "Checking your browser",
  "cf_chl_opt",
  "cf_chl_prog",
  "turnstile",
  "ray ID",
  "Attention Required! | Cloudflare",
  "Enable JavaScript and cookies to continue",
  "Verify you are human",
];

function isCloudflareChallenge(status, headers, body) {
  // Status-based detection
  if (status === 403 || status === 503) {
    const server = (headers["server"] || "").toLowerCase();
    if (server.includes("cloudflare")) return true;
  }

  // Header-based detection
  const cfMitigated = headers["cf-mitigated"] || headers["cf-mitigated-by"];
  if (cfMitigated) return true;

  // Body-based detection (check first 5KB only for performance)
  if (body) {
    const snippet = typeof body === "string" ? body.slice(0, 5000) : "";
    for (const marker of CF_CHALLENGE_MARKERS) {
      if (snippet.toLowerCase().includes(marker.toLowerCase())) return true;
    }
  }

  return false;
}

/**
 * Detect if a response is a bot detection page (generic — not just CF).
 */
function isBotDetection(status, headers, body) {
  if (isCloudflareChallenge(status, headers, body)) return { blocked: true, type: "cloudflare" };

  // Akamai
  if (status === 403 && (headers["x-akamai-transformed"] || "").includes("challenge")) {
    return { blocked: true, type: "akamai" };
  }

  // PerimeterX / DataDome
  if (status === 403 && body) {
    const snippet = (typeof body === "string" ? body : "").slice(0, 3000);
    if (snippet.includes("_px") || snippet.includes("datadome")) {
      return { blocked: true, type: "perimeterx" };
    }
  }

  return { blocked: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONNECTOR CACHE (per profile, reuse across requests)
// ═══════════════════════════════════════════════════════════════════════════

const agentCache = new Map();

function getAgent(profileName) {
  if (agentCache.has(profileName)) return agentCache.get(profileName);

  const profile = TLS_PROFILES[profileName] || TLS_PROFILES[DEFAULT_PROFILE];
  const connector = buildConnector({
    ciphers: profile.ciphers,
    sigalgs: profile.sigalgs,
    secureOptions: 0,
    alpnProtocols: ["h2", "http/1.1"],
  });

  const agent = new Agent({
    connect: connector,
    keepAliveTimeout: 10_000,
    keepAliveMaxTimeout: 60_000,
    connections: 6,
    pipelining: 1,
  });

  agentCache.set(profileName, agent);
  return agent;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Build request headers
// ═══════════════════════════════════════════════════════════════════════════

function buildHeaders(profileName, url, userHeaders, acceptType) {
  const profile = TLS_PROFILES[profileName] || TLS_PROFILES[DEFAULT_PROFILE];
  const isHttps = url.startsWith("https://");

  const headers = {
    "user-agent": profile.userAgent,
    accept: acceptType === "json"
      ? "application/json, text/plain, */*"
      : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "accept-encoding": "gzip, deflate, br",
    connection: "keep-alive",
    ...profile.headers,
  };

  // Sec-Fetch headers (only for HTTPS)
  if (isHttps) {
    headers["sec-fetch-site"] = "none";
    headers["sec-fetch-mode"] = "navigate";
    headers["sec-fetch-dest"] = "document";
    headers["sec-fetch-user"] = "?1";
  }

  // User overrides take precedence
  if (userHeaders) {
    for (const [k, v] of Object.entries(userHeaders)) {
      if (v === null || v === undefined) {
        delete headers[k.toLowerCase()];
      } else {
        headers[k.toLowerCase()] = v;
      }
    }
  }

  return headers;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Parse response body
// ═══════════════════════════════════════════════════════════════════════════

async function parseBody(response, maxBodySize) {
  maxBodySize = maxBodySize || 1_000_000; // 1MB default
  const contentType = response.headers?.["content-type"] || "";
  const raw = await response.text();

  // Truncate if too large
  const body = raw.length > maxBodySize ? raw.slice(0, maxBodySize) : raw;
  const truncated = raw.length > maxBodySize;

  let parsed = body;
  let contentTypeCategory = "text";

  if (contentType.includes("application/json")) {
    try {
      parsed = JSON.parse(body);
      contentTypeCategory = "json";
    } catch {
      // Keep as string if JSON parse fails
      contentTypeCategory = "text";
    }
  } else if (contentType.includes("text/html")) {
    contentTypeCategory = "html";
  } else if (contentType.includes("text/xml") || contentType.includes("application/xml")) {
    contentTypeCategory = "xml";
  } else if (contentType.includes("application/octet-stream")) {
    contentTypeCategory = "binary";
  }

  return { body: parsed, contentType, contentTypeCategory, truncated, size: raw.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Strip HTML (for fetch_html responses)
// ═══════════════════════════════════════════════════════════════════════════

function stripHtml(html) {
  if (!html || typeof html !== "string") return html;
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<link[^>]*>/gi, "")
    .replace(/<meta[^>]*>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN: doFetch — core request function
// ═══════════════════════════════════════════════════════════════════════════

async function doFetch(args, cookieJar) {
  const {
    url,
    method = "GET",
    headers: userHeaders,
    body,
    timeout_ms = 30000,
    tls_profile = DEFAULT_PROFILE,
    follow_redirects = true,
    max_body_size,
  } = args;

  if (!url) return { ok: false, error: "url is required" };

  // Validate URL
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { ok: false, error: `Invalid URL: ${url}` };
  }

  const isHttps = parsedUrl.protocol === "https:";
  if (!isHttps && parsedUrl.protocol !== "http:") {
    return { ok: false, error: `Unsupported protocol: ${parsedUrl.protocol}` };
  }

  const profileName = TLS_PROFILES[tls_profile] ? tls_profile : DEFAULT_PROFILE;
  const agent = isHttps ? getAgent(profileName) : undefined;

  const requestHeaders = buildHeaders(profileName, url, userHeaders, "html");

  // Inject cookies
  const cookieStr = cookieJar.getCookiesForUrl(url);
  if (cookieStr) {
    requestHeaders["cookie"] = cookieStr;
  }

  // Prepare body
  let requestBody = undefined;
  const upperMethod = method.toUpperCase();
  if (body && !["GET", "HEAD"].includes(upperMethod)) {
    requestBody = typeof body === "string" ? body : JSON.stringify(body);
    if (!requestHeaders["content-type"]) {
      requestHeaders["content-type"] = typeof body === "string"
        ? "application/x-www-form-urlencoded"
        : "application/json";
    }
  }

  const start = Date.now();

  try {
    const response = await undiciFetch(url, {
      method: upperMethod,
      headers: requestHeaders,
      body: requestBody,
      dispatcher: agent,
      redirect: follow_redirects ? "follow" : "manual",
      signal: AbortSignal.timeout(timeout_ms),
    });

    const timing = Date.now() - start;

    // Collect response headers
    const respHeaders = {};
    for (const [key, value] of Object.entries(response.headers || {})) {
      respHeaders[key] = value;
    }

    // Store cookies
    const setCookie = respHeaders["set-cookie"];
    if (setCookie) {
      cookieJar.setCookiesFromResponse(url, setCookie);
    }

    // Parse body
    const { body: parsedBody, contentType, contentTypeCategory, truncated, size } =
      await parseBody(response, max_body_size);

    // Bot detection
    const botCheck = isBotDetection(response.status, respHeaders, typeof parsedBody === "string" ? parsedBody : "");

    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      headers: respHeaders,
      body: parsedBody,
      contentType,
      contentTypeCategory,
      truncated,
      size,
      timing,
      url: response.url || url,
      cfBlocked: botCheck.blocked,
      botDetectionType: botCheck.blocked ? botCheck.type : undefined,
      message: botCheck.blocked
        ? `${botCheck.type} challenge detected. Use browser_* tools (browser_open + browser_wait_for) to solve it.`
        : undefined,
    };
  } catch (err) {
    const timing = Date.now() - start;

    if (err.name === "TimeoutError" || err.code === "UND_ERR_HEADERS_TIMEOUT") {
      return { ok: false, error: `Request timed out after ${timeout_ms}ms`, timing };
    }

    if (err.code === "ECONNREFUSED") {
      return { ok: false, error: `Connection refused: ${url}`, timing };
    }

    if (err.code === "ENOTFOUND") {
      return { ok: false, error: `DNS resolution failed: ${parsedUrl.hostname}`, timing };
    }

    // TLS/cipher errors — likely SSL fingerprint mismatch
    if (err.code === "ERR_TLS_HANDSHAKE_TIMEOUT" || err.message?.includes("ssl3")) {
      return {
        ok: false,
        error: `TLS handshake failed. Try a different tls_profile (chrome-131, firefox-133, chrome-mobile). Detail: ${err.message}`,
        timing,
      };
    }

    return { ok: false, error: err.message || String(err), timing };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FACTORY: createFetchHandlers
// ═══════════════════════════════════════════════════════════════════════════

function createFetchHandlers(opts) {
  const cookieJar = new CookieJar();

  return {
    /**
     * browser_fetch — Generic HTTP request.
     * Returns full response with status, headers, body, timing, bot detection.
     */
    async browserFetch(args) {
      return doFetch(args, cookieJar);
    },

    /**
     * browser_fetch_json — Fetch with auto JSON parse.
     * Returns parsed JSON directly (or error if response is not JSON).
     */
    async browserFetchJson(args) {
      const result = await doFetch(
        {
          ...args,
          headers: { ...args.headers, accept: "application/json, text/plain, */*" },
        },
        cookieJar
      );

      if (!result.ok) return result;

      // Auto-parse if response is JSON but body wasn't parsed
      if (result.contentTypeCategory !== "json" && typeof result.body === "string") {
        try {
          result.body = JSON.parse(result.body);
          result.contentTypeCategory = "json";
        } catch {
          // Keep as string — caller can handle
          result.warning = "Response is not valid JSON";
        }
      }

      return result;
    },

    /**
     * browser_fetch_html — Fetch HTML with optional CSS selector extraction.
     * Strips scripts/styles by default. Auto-truncated at 50k chars.
     */
    async browserFetchHtml(args) {
      const result = await doFetch(
        {
          ...args,
          headers: {
            ...args.headers,
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        },
        cookieJar
      );

      if (!result.ok) return result;

      let html = result.body;

      // Strip heavy tags
      if (typeof html === "string") {
        html = stripHtml(html);
      }

      // Truncate at 50k chars
      const MAX_HTML = 50000;
      const truncated = typeof html === "string" && html.length > MAX_HTML;
      if (truncated) html = html.slice(0, MAX_HTML);

      return {
        ...result,
        body: html,
        truncated: truncated || result.truncated,
        stripped: true,
      };
    },

    /**
     * browser_fetch_batch — Multiple requests in parallel (max 10).
     * Returns array of responses.
     */
    async browserFetchBatch(args) {
      const {
        urls,
        method = "GET",
        headers: userHeaders,
        body,
        timeout_ms = 30000,
        tls_profile = DEFAULT_PROFILE,
        max_concurrent = 5,
      } = args;

      if (!Array.isArray(urls) || urls.length === 0) {
        return { ok: false, error: "urls must be a non-empty array" };
      }

      if (urls.length > 10) {
        return { ok: false, error: "Maximum 10 URLs per batch" };
      }

      // Process in chunks respecting concurrency
      const results = [];
      const concurrency = Math.min(max_concurrent, urls.length);

      for (let i = 0; i < urls.length; i += concurrency) {
        const chunk = urls.slice(i, i + concurrency);
        const chunkResults = await Promise.all(
          chunk.map((url) =>
            doFetch({ url, method, headers: userHeaders, body, timeout_ms, tls_profile }, cookieJar)
          )
        );
        results.push(...chunkResults);
      }

      const allOk = results.every((r) => r.ok);
      const cfBlockedCount = results.filter((r) => r.cfBlocked).length;

      return {
        ok: true,
        results,
        total: results.length,
        success: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        cfBlocked: cfBlockedCount > 0 ? cfBlockedCount : undefined,
        message:
          cfBlockedCount > 0
            ? `${cfBlockedCount}/${results.length} URLs blocked by bot detection. Use browser_* tools for those.`
            : undefined,
      };
    },

    /**
     * browser_fetch_cookies — Manage cookies: list, set, clear.
     */
    async browserFetchCookies(args) {
      const { action, domain, name, value } = args;

      switch (action) {
        case "list":
          return { ok: true, cookies: cookieJar.list(domain) };

        case "set": {
          if (!domain || !name) {
            return { ok: false, error: "domain and name are required for set" };
          }
          if (!cookieJar.cookies.has(domain)) {
            cookieJar.cookies.set(domain, new Map());
          }
          cookieJar.cookies.get(domain).set(name, {
            value: value || "",
            path: "/",
            expires: null,
          });
          return { ok: true, message: `Cookie ${name} set for ${domain}` };
        }

        case "clear":
          cookieJar.clear(domain);
          return {
            ok: true,
            message: domain
              ? `Cookies cleared for ${domain}`
              : "All cookies cleared",
          };

        default:
          return {
            ok: false,
            error: `Unknown action: ${action}. Use: list, set, clear`,
          };
      }
    },
  };
}

module.exports = { createFetchHandlers, TLS_PROFILES, CookieJar };
