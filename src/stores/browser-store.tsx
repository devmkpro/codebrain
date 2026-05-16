import { create } from "zustand";

// Re-export provider utils so existing imports from browser-store still work
export {
  DEFAULT_MIMO_ANTHROPIC_BASE_URL,
  MIMO_ANTHROPIC_ROUTES,
  normalizeBaseUrl,
  isValidHttpBaseUrl,
  resolveIntegrationBaseUrl,
  fetchModelsFromEndpoint,
  URL_REGEX,
  extractLocalUrl as extractUrl,
} from "../lib/provider-utils";

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

export const useBrowserStore = create<{
  detectedUrl: string | null;
  currentUrl: string | null;
  detectedAt: number | null;
  networkLog: Record<string, NetworkEntry[]>;
  consoleLog: Record<string, ConsoleEntry[]>;
  setDetected: (url: string) => void;
  setCurrent: (url: string) => void;
  addNetworkEntry: (paneId: string, entry: NetworkEntry) => void;
  addConsoleEntry: (paneId: string, entry: ConsoleEntry) => void;
  clearLogs: (paneId: string) => void;
  clear: () => void;
}>(set => ({
  detectedUrl: null,
  currentUrl: null,
  detectedAt: null,
  networkLog: {},
  consoleLog: {},
  setDetected: url => set({ detectedUrl: url, detectedAt: Date.now() }),
  setCurrent: url => set({ currentUrl: url }),
  addNetworkEntry: (paneId, entry) => set(state => ({
    networkLog: { ...state.networkLog, [paneId]: [...(state.networkLog[paneId] || []), entry] },
  })),
  addConsoleEntry: (paneId, entry) => set(state => ({
    consoleLog: { ...state.consoleLog, [paneId]: [...(state.consoleLog[paneId] || []), entry] },
  })),
  clearLogs: paneId => set(state => ({
    networkLog: { ...state.networkLog, [paneId]: [] },
    consoleLog: { ...state.consoleLog, [paneId]: [] },
  })),
  clear: () => set({ detectedUrl: null, currentUrl: null, detectedAt: null, networkLog: {}, consoleLog: {} }),
}));
