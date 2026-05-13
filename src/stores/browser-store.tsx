import React from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

// ── Browser Control Types ────────────────────────────────────────────────────

export interface NetworkEntry {
  id: string;
  timestamp: number;
  method: string;
  url: string;
  status: number;
  duration?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  error?: string;
}

export interface ConsoleEntry {
  id: string;
  timestamp: number;
  level: "log" | "warn" | "error";
  message: string;
  source?: string;
}

// useBrowserStore
export const useBrowserStore = create(set => ({
  detectedUrl: null,
  currentUrl: null,
  detectedAt: null,
  // Network/console logs keyed by paneId
  networkLog: {},
  consoleLog: {},
  setDetected: url => set({
    detectedUrl: url,
    detectedAt: Date.now()
  }),
  setCurrent: url => set({
    currentUrl: url
  }),
  addNetworkEntry: (paneId, entry) => set(state => ({
    networkLog: {
      ...state.networkLog,
      [paneId]: [...(state.networkLog[paneId] || []), entry]
    }
  })),
  addConsoleEntry: (paneId, entry) => set(state => ({
    consoleLog: {
      ...state.consoleLog,
      [paneId]: [...(state.consoleLog[paneId] || []), entry]
    }
  })),
  clearLogs: paneId => set(state => ({
    networkLog: { ...state.networkLog, [paneId]: [] },
    consoleLog: { ...state.consoleLog, [paneId]: [] }
  })),
  clear: () => set({
    detectedUrl: null,
    currentUrl: null,
    detectedAt: null,
    networkLog: {},
    consoleLog: {}
  })
}));
export const URL_REGEX = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)(?::\d+)?(?:\/[^\s\x1b]*)?/gi;
function extractUrl(text) {
  const matches = text.match(URL_REGEX);
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1].replace(/[)\]>'"`,.;]+$/, "");
}
export const DEFAULT_MIMO_ANTHROPIC_BASE_URL = "https://token-plan-sgp.xiaomimimo.com/anthropic";
export const MIMO_ANTHROPIC_ROUTES = [{
  label: "SGP",
  url: DEFAULT_MIMO_ANTHROPIC_BASE_URL
}, {
  label: "CN",
  url: "https://token-plan-cn.xiaomimimo.com/anthropic"
}, {
  label: "AMS",
  url: "https://token-plan-ams.xiaomimimo.com/anthropic"
}];
export function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/, "");
}
export function isValidHttpBaseUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
export function resolveIntegrationBaseUrl(template, integration, customMimoAnthropicBaseUrl) {
  const custom = normalizeBaseUrl(customMimoAnthropicBaseUrl);
  if (template.id !== "mimo" || !custom) return integration.baseUrl;
  if (integration.type === "anthropic-compat" || integration.type === "mimo-compat") return custom;
  return integration.baseUrl;
}
export async function fetchModelsFromEndpoint(baseUrl, token, kind) {
  try {
    const url = kind === "anthropic" ? `${baseUrl.replace(/\/$/, "")}/v1/models` : `${baseUrl.replace(/\/$/, "")}/models`;
    const res = await fetch(url, {
      headers: kind === "anthropic" ? {
        "x-api-key": token,
        authorization: `Bearer ${token}`,
        "anthropic-version": "2023-06-01"
      } : {
        authorization: `Bearer ${token}`
      }
    });
    if (!res.ok) return [];
    const json = await res.json();
    const ids = [];
    for (const m of json.data ?? []) if (m?.id) ids.push(m.id);
    for (const m of json.models ?? []) {
      if (typeof m === "string") ids.push(m);else if (m?.id) ids.push(m.id);
    }
    return Array.from(new Set(ids));
  } catch {
    return [];
  }
}