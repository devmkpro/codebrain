import type { AppContext } from "../context";
import { safeSend } from "../context";
import { BROWSER_LOG_MAX } from "./constants";

function isInternalUrl(url: string): boolean {
  return url.startsWith("devtools://") || url.startsWith("chrome-extension://") || url.startsWith("chrome-devtools://") || url.startsWith("about:");
}

export function guessResourceType(url: string, resourceType?: string): string {
  if (resourceType) return resourceType;
  if (url.match(/\.(js|mjs|jsx|ts|tsx)(\?|$)/)) return "script";
  if (url.match(/\.(css|scss|less)(\?|$)/)) return "stylesheet";
  if (url.match(/\.(png|jpg|jpeg|gif|svg|webp|ico|bmp)(\?|$)/)) return "image";
  if (url.match(/\.(woff2?|ttf|eot|otf)(\?|$)/)) return "font";
  if (url.match(/\.(json)(\?|$)/)) return "json";
  if (url.match(/\.(html|htm)(\?|$)/)) return "document";
  if (url.match(/\/api\//) || url.match(/\/graphql/)) return "fetch";
  return "other";
}

export function statusTextFromCode(code: number): string {
  const map: Record<number, string> = {
    200: "OK", 201: "Created", 204: "No Content", 301: "Moved", 302: "Found", 304: "Not Modified",
    400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
    405: "Method Not Allowed", 409: "Conflict", 422: "Unprocessable", 429: "Too Many Requests",
    500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout",
  };
  return map[code] || "";
}

export function attachNetworkTracking(ctx: AppContext, sess: Electron.Session): void {
  const pendingRequests = new Map<number, { startTime: number; method: string; url: string }>();

  sess.webRequest.onBeforeRequest((details, callback) => {
    if (!isInternalUrl(details.url)) {
      pendingRequests.set(details.id, { startTime: Date.now(), method: details.method, url: details.url });
    }
    callback({});
  });

  sess.webRequest.onCompleted((details) => {
    if (isInternalUrl(details.url)) return;
    const pending = pendingRequests.get(details.id);
    pendingRequests.delete(details.id);
    const startTime = pending?.startTime ?? Date.now();
    const entry = {
      id: `net_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: startTime,
      durationMs: Date.now() - startTime,
      method: details.method,
      url: details.url,
      type: guessResourceType(details.url, details.resourceType),
      status: details.statusCode,
      statusText: statusTextFromCode(details.statusCode),
      ok: details.statusCode >= 200 && details.statusCode < 400,
      requestHeaders: (details.requestHeaders as Record<string, string>) || {},
      responseHeaders: (details.responseHeaders as Record<string, string>) || {},
      error: null,
    };
    ctx.browserNetworkLog.push(entry);
    if (ctx.browserNetworkLog.length > BROWSER_LOG_MAX) ctx.browserNetworkLog.splice(0, ctx.browserNetworkLog.length - BROWSER_LOG_MAX);
    safeSend(ctx, "codebrain:browser:network-entry", entry);
  });

  sess.webRequest.onErrorOccurred((details) => {
    if (isInternalUrl(details.url)) return;
    const pending = pendingRequests.get(details.id);
    pendingRequests.delete(details.id);
    const startTime = pending?.startTime ?? Date.now();
    const entry = {
      id: `net_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: startTime,
      durationMs: Date.now() - startTime,
      method: details.method,
      url: details.url,
      type: guessResourceType(details.url, undefined),
      status: 0,
      statusText: "Error",
      ok: false,
      requestHeaders: {},
      responseHeaders: {},
      error: details.error || "request failed",
    };
    ctx.browserNetworkLog.push(entry);
    if (ctx.browserNetworkLog.length > BROWSER_LOG_MAX) ctx.browserNetworkLog.splice(0, ctx.browserNetworkLog.length - BROWSER_LOG_MAX);
    safeSend(ctx, "codebrain:browser:network-entry", entry);
  });
}
