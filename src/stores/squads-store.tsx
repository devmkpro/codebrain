import React from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface SquadWorker {
  id: string;
  role: string;
  providerId?: string;
  model?: string;
}

export interface Squad {
  id: string;
  name: string;
  orchestrator: { providerId?: string; model?: string };
  workers: SquadWorker[];
  createdAt: number;
}

// useSquadsStore
export const useSquadsStore = create((set, get) => ({
  squads: [],
  loaded: false,
  load: async () => {
    const list = (await window.codeBrainApp?.squads?.list?.()) ?? [];
    set({
      squads: list,
      loaded: true
    });
  },
  save: async squad => {
    const res = (await window.codeBrainApp?.squads?.save?.(squad)) ?? {
      ok: false
    };
    if (res.ok) await get().load();
    return res;
  },
  remove: async id => {
    const res = (await window.codeBrainApp?.squads?.delete?.(id)) ?? {
      ok: false
    };
    if (res.ok) await get().load();
    return res;
  }
}));