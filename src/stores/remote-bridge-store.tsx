import { create } from "zustand";

interface RemoteBridgeStatus {
  running: boolean;
  port: number;
  bindAddr: string;
  connectedClients: number;
  authenticatedClients: number;
  pairCode: { code: string; expiresAt: number };
  tokenCount: number;
}

interface RemoteBridgeStore {
  /** Sidebar visibility */
  visible: boolean;
  toggle: () => void;

  /** Current bridge status */
  status: RemoteBridgeStatus | null;
  /** Loading state */
  loading: boolean;
  /** Error message */
  error: string | null;
  /** Whether status is being polled */
  polling: boolean;

  // Actions
  fetchStatus: () => Promise<void>;
  start: (port?: number) => Promise<void>;
  stop: () => Promise<void>;
  revokeTokens: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

const DEFAULT_STATUS: RemoteBridgeStatus = {
  running: false,
  port: 8789,
  bindAddr: "0.0.0.0",
  connectedClients: 0,
  authenticatedClients: 0,
  pairCode: { code: "------", expiresAt: 0 },
  tokenCount: 0,
};

let pollInterval: ReturnType<typeof setInterval> | null = null;

export const useRemoteBridgeStore = create<RemoteBridgeStore>((set, get) => ({
  visible: false,
  toggle: () => set((s) => ({ visible: !s.visible })),

  status: null,
  loading: false,
  error: null,
  polling: false,

  fetchStatus: async () => {
    try {
      const result = await (window as any).codeBrainApp?.remoteBridge?.status?.();
      if (result?.ok && result.data) {
        set({ status: result.data, error: null });
      } else {
        set({ status: DEFAULT_STATUS });
      }
    } catch (err) {
      set({ error: String(err), status: DEFAULT_STATUS });
    }
  },

  start: async (port?: number) => {
    set({ loading: true, error: null });
    try {
      const result = await (window as any).codeBrainApp?.remoteBridge?.start?.({ port });
      if (result?.ok) {
        // Refresh status after starting
        await get().fetchStatus();
      } else {
        set({ error: result?.error || "Failed to start remote bridge" });
      }
    } catch (err) {
      set({ error: String(err) });
    } finally {
      set({ loading: false });
    }
  },

  stop: async () => {
    set({ loading: true, error: null });
    try {
      const result = await (window as any).codeBrainApp?.remoteBridge?.stop?.();
      if (result?.ok) {
        set({ status: DEFAULT_STATUS });
      } else {
        set({ error: result?.error || "Failed to stop remote bridge" });
      }
    } catch (err) {
      set({ error: String(err) });
    } finally {
      set({ loading: false });
    }
  },

  revokeTokens: async () => {
    try {
      await (window as any).codeBrainApp?.remoteBridge?.revokeTokens?.();
      await get().fetchStatus();
    } catch (err) {
      set({ error: String(err) });
    }
  },

  startPolling: () => {
    if (pollInterval) return;
    set({ polling: true });
    // Fetch immediately
    get().fetchStatus();
    // Poll every 10 seconds
    pollInterval = setInterval(() => {
      get().fetchStatus();
    }, 10_000);
  },

  stopPolling: () => {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    set({ polling: false });
  },
}));
