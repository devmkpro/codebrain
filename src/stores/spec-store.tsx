import { create } from "zustand";

export interface WorkspaceSpec { id: string; title: string; path: string; files: Array<{ name: string; exists: boolean }>; complete: boolean }
interface SpecState {
  visible: boolean; specs: WorkspaceSpec[]; loading: boolean; error: string | null;
  toggle: () => void; load: (workspace: string) => Promise<void>; create: (workspace: string, title: string, description?: string) => Promise<boolean>;
}
export const useSpecStore = create<SpecState>((set, get) => ({
  visible: false, specs: [], loading: false, error: null,
  toggle: () => set((state) => ({ visible: !state.visible })),
  load: async (workspace) => {
    set({ loading: true, error: null });
    try { const result = await window.codeBrainApp.spec.list({ workspace }); if (!result.ok) throw new Error(result.error); set({ specs: result.specs ?? [] }); }
    catch (error) { set({ error: error instanceof Error ? error.message : String(error) }); }
    finally { set({ loading: false }); }
  },
  create: async (workspace, title, description) => {
    set({ loading: true, error: null });
    try { const result = await window.codeBrainApp.spec.create({ workspace, title, description }); if (!result.ok) throw new Error(result.error); await get().load(workspace); return true; }
    catch (error) { set({ error: error instanceof Error ? error.message : String(error) }); return false; }
    finally { set({ loading: false }); }
  },
}));
