import { create } from 'zustand';

export interface DetectedWorkspace {
  path: string;
  name: string;
  allowed: boolean;
}

interface MrReviewState {
  reviewing: boolean;
  activeWorkspaces: string[];
  allowedWorkspaces: string[];
  autoReview: boolean;
  detectedWorkspaces: DetectedWorkspace[];
  loading: boolean;

  /** Fetch current review status from main process */
  fetchStatus: () => Promise<void>;
  /** Fetch detected workspaces with git remotes */
  fetchAllowed: () => Promise<void>;
  /** Update allowed workspaces list */
  setAllowed: (workspaces: string[]) => Promise<void>;
  /** Toggle a single workspace's allowed state */
  toggleWorkspace: (workspacePath: string) => Promise<void>;
  /** Trigger manual review for a workspace */
  triggerReview: (workspace: string) => Promise<void>;
}

const api = () => (window as any).codeBrainApp?.mrReview;

export const useMrReviewStore = create<MrReviewState>((set, get) => ({
  reviewing: false,
  activeWorkspaces: [],
  allowedWorkspaces: [],
  autoReview: false,
  detectedWorkspaces: [],
  loading: false,

  fetchStatus: async () => {
    try {
      const mrApi = api();
      if (!mrApi) return;
      const res = await mrApi.status();
      if (res?.ok) {
        set({
          reviewing: !!res.reviewing,
          activeWorkspaces: res.activeWorkspaces || [],
          allowedWorkspaces: res.allowedWorkspaces || [],
          autoReview: !!res.autoReview,
        });
      }
    } catch {}
  },

  fetchAllowed: async () => {
    try {
      const mrApi = api();
      if (!mrApi) return;
      set({ loading: true });
      const res = await mrApi.allowed();
      if (res?.ok) {
        set({ detectedWorkspaces: res.workspaces || [] });
      }
      set({ loading: false });
    } catch {
      set({ loading: false });
    }
  },

  setAllowed: async (workspaces: string[]) => {
    try {
      const mrApi = api();
      if (!mrApi) return;
      await mrApi.setAllowed({ workspaces });
      set({ allowedWorkspaces: workspaces });
      // Refresh detected to update toggle states
      const res = await mrApi.allowed();
      if (res?.ok) {
        set({ detectedWorkspaces: res.workspaces || [] });
      }
    } catch {}
  },

  toggleWorkspace: async (workspacePath: string) => {
    const { allowedWorkspaces, setAllowed } = get();
    const isAllowed = allowedWorkspaces.includes(workspacePath);
    const newAllowed = isAllowed
      ? allowedWorkspaces.filter(p => p !== workspacePath)
      : [...allowedWorkspaces, workspacePath];
    await setAllowed(newAllowed);
  },

  triggerReview: async (workspace: string) => {
    try {
      const mrApi = api();
      if (!mrApi) return;
      set(s => ({
        reviewing: true,
        activeWorkspaces: [...s.activeWorkspaces, workspace],
      }));
      await mrApi.trigger({ workspace });
      // Poll status after a delay to update
      setTimeout(async () => {
        const { fetchStatus } = get();
        await fetchStatus();
      }, 5000);
    } catch {}
  },
}));
