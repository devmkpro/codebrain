import { create } from "zustand";
import type { AgentMessage } from "../types/electron";
import { usePanesStore } from "./panes-store";

interface ConversationState {
  open: boolean;
  paneId: string | null;
  messages: AgentMessage[];
  loading: boolean;
  sending: boolean;
  error: string | null;
  openFor: (paneId: string) => void;
  close: () => void;
  refresh: () => Promise<void>;
  send: (content: string, parentId?: string) => Promise<boolean>;
}

function paneWorkspace(paneId: string): string | undefined {
  const pane = (usePanesStore.getState() as any).panes.find((item: any) => item.id === paneId);
  return pane?.workspacePath ?? pane?.cwd;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  open: false,
  paneId: null,
  messages: [],
  loading: false,
  sending: false,
  error: null,
  openFor: (paneId) => {
    set({ open: true, paneId, messages: [], error: null });
    void get().refresh();
  },
  close: () => set({ open: false }),
  refresh: async () => {
    const paneId = get().paneId;
    if (!paneId) return;
    set({ loading: true, error: null });
    try {
      const result = await window.codeBrainApp.conversation.list({ paneId, workspace: paneWorkspace(paneId) });
      if (!result.ok) throw new Error(result.error || "Não foi possível carregar a conversa");
      if (get().paneId === paneId) set({ messages: result.messages ?? [] });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ loading: false });
    }
  },
  send: async (content, parentId) => {
    const paneId = get().paneId;
    if (!paneId || !content.trim()) return false;
    set({ sending: true, error: null });
    try {
      const result = await window.codeBrainApp.conversation.send({
        toPane: paneId,
        content: content.trim(),
        parentId,
        workspace: paneWorkspace(paneId),
      });
      if (!result.ok) throw new Error(result.error || "Não foi possível enviar");
      await get().refresh();
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      set({ sending: false });
    }
  },
}));
