import { create } from "zustand";

export interface MemoryEntry {
  id: string;
  type: "episodic" | "semantic" | "procedural" | "working";
  key: string;
  content: string;
  tags: string[];
  agent_id?: string;
  workspace?: string;
  created_at: number;
  updated_at: number;
  access_count: number;
}

export interface PatternEntry {
  id: string;
  pattern_type: string;
  description: string;
  source_trajectory?: string;
  quality_score: number;
  success_count: number;
  failure_count: number;
  created_at: number;
  updated_at: number;
}

export interface MemoryStats {
  total: number;
  byType: Record<string, { count: number; totalBytes: number }>;
}

interface MemoryState {
  visible: boolean;
  tab: "memories" | "patterns";
  memories: MemoryEntry[];
  patterns: PatternEntry[];
  stats: MemoryStats | null;
  filter: string;
  typeFilter: string;
  searchQuery: string;
  loading: boolean;

  toggle: () => void;
  setTab: (tab: "memories" | "patterns") => void;
  setFilter: (f: string) => void;
  setTypeFilter: (t: string) => void;
  setSearchQuery: (q: string) => void;
  loadMemories: () => Promise<void>;
  loadPatterns: () => Promise<void>;
  loadStats: () => Promise<void>;
  searchMemories: (query: string) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  deletePattern: (id: string) => Promise<void>;
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  visible: false,
  tab: "memories",
  memories: [],
  patterns: [],
  stats: null,
  filter: "",
  typeFilter: "",
  searchQuery: "",
  loading: false,

  toggle: () => set((s) => ({ visible: !s.visible })),

  setTab: (tab) => {
    set({ tab });
    if (tab === "memories") get().loadMemories();
    if (tab === "patterns") get().loadPatterns();
  },

  setFilter: (filter) => set({ filter }),
  setTypeFilter: (typeFilter) => {
    set({ typeFilter });
    get().loadMemories();
  },
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  loadMemories: async () => {
    set({ loading: true });
    try {
      const type = get().typeFilter || undefined;
      const result = await (window as any).codeBrainApp?.memory?.list?.({ type, limit: 100 });
      if (result?.ok) set({ memories: result.memories || [] });
    } catch {}
    set({ loading: false });
  },

  loadPatterns: async () => {
    set({ loading: true });
    try {
      const result = await (window as any).codeBrainApp?.memory?.listPatterns?.({ limit: 50 });
      if (result?.ok) set({ patterns: result.patterns || [] });
    } catch {}
    set({ loading: false });
  },

  loadStats: async () => {
    try {
      const result = await (window as any).codeBrainApp?.memory?.stats?.();
      if (result?.ok) set({ stats: { total: result.total, byType: result.byType } });
    } catch {}
  },

  searchMemories: async (query: string) => {
    if (!query.trim()) {
      get().loadMemories();
      return;
    }
    set({ loading: true });
    try {
      const result = await (window as any).codeBrainApp?.memory?.search?.({ query, limit: 50 });
      if (result?.ok) set({ memories: result.memories || [] });
    } catch {}
    set({ loading: false });
  },

  deleteMemory: async (id: string) => {
    try {
      await (window as any).codeBrainApp?.memory?.delete?.({ id });
      get().loadMemories();
      get().loadStats();
    } catch {}
  },

  deletePattern: async (id: string) => {
    try {
      await (window as any).codeBrainApp?.memory?.deletePattern?.({ id });
      get().loadPatterns();
    } catch {}
  },
}));
