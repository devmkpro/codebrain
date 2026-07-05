import { create } from "zustand";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ClarifyRequest {
  id: string;
  paneId: string;
  question: string;
  suggestions: string[];
  receivedAt: number;
}

interface ClarifyStore {
  // State — active clarification requests
  requests: ClarifyRequest[];

  // Actions
  addRequest: (req: Omit<ClarifyRequest, "id" | "receivedAt">) => void;
  dismiss: (id: string) => void;
  dismissByPane: (paneId: string) => void;
  clear: () => void;
}

// ── Store ──────────────────────────────────────────────────────────────────

export const useClarifyStore = create<ClarifyStore>((set) => ({
  requests: [],

  addRequest: (req) =>
    set((s) => ({
      requests: [
        ...s.requests.filter((r) => r.paneId !== req.paneId), // dedup by pane
        {
          ...req,
          id: `clarify_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          receivedAt: Date.now(),
        },
      ],
    })),

  dismiss: (id) =>
    set((s) => ({
      requests: s.requests.filter((r) => r.id !== id),
    })),

  dismissByPane: (paneId) =>
    set((s) => ({
      requests: s.requests.filter((r) => r.paneId !== paneId),
    })),

  clear: () => set({ requests: [] }),
}));
