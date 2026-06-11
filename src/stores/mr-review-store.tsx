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
  hasReviewModel: boolean;
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
  hasReviewModel: false,
  detectedWorkspaces: [],
  loading: false,

  fetchStatus: async () => {
    try {
      const mrApi = api();
      if (!mrApi) return;
      const res = await mrApi.status();
      if (res?.ok) {
        // hasReviewModel: prefer IPC response, fallback to direct config read
        let hasModel = !!res.hasReviewModel;
        if (!hasModel) {
          try {
            const cfg = await (window as any).codeBrainApp?.appConfig?.get?.();
            hasModel = !!(cfg?.mr_review_provider && cfg?.mr_review_model);
          } catch {}
        }
        set({
          reviewing: !!res.reviewing,
          activeWorkspaces: res.activeWorkspaces || [],
          allowedWorkspaces: res.allowedWorkspaces || [],
          autoReview: !!res.autoReview,
          hasReviewModel: hasModel,
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
    console.log('[mrReviewStore] triggerReview called for workspace:', workspace);
    try {
      const mrApi = api();
      console.log('[mrReviewStore] mrApi available:', !!mrApi, mrApi ? Object.keys(mrApi) : 'null');
      if (!mrApi) {
        console.error('[mrReviewStore] ERROR: window.codeBrainApp.mrReview is undefined! Preload not loaded.');
        return;
      }
      set(s => ({
        reviewing: true,
        activeWorkspaces: [...s.activeWorkspaces, workspace],
      }));
      console.log('[mrReviewStore] Calling mrApi.trigger({ workspace:', workspace, '})');
      const res = await mrApi.trigger({ workspace });
      console.log('[mrReviewStore] mrApi.trigger response:', JSON.stringify(res));
      if (res && !res.ok) {
        // Debounce or other error — undo reviewing state
        console.warn('[mrReviewStore] trigger error:', res.error);
        set(s => ({
          reviewing: false,
          activeWorkspaces: s.activeWorkspaces.filter(w => w !== workspace),
        }));
        return;
      }
      // Poll status after a delay to update
      setTimeout(async () => {
        const { fetchStatus } = get();
        await fetchStatus();
      }, 5000);
    } catch (err) {
      console.error('[mrReviewStore] triggerReview CRASHED:', err);
    }
  },
}));
