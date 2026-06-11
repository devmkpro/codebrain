import { create } from 'zustand';

export interface DetectedWorkspace {
  path: string;
  name: string;
  allowed: boolean;
}

export interface MrReviewFindings {
  mrId: number;
  workspace: string;
  findings: string[];
  summary: string;
  title: string;
  sourceBranch: string;
  targetBranch: string;
}

interface MrReviewState {
  reviewing: boolean;
  activeWorkspaces: string[];
  allowedWorkspaces: string[];
  autoReview: boolean;
  hasReviewModel: boolean;
  detectedWorkspaces: DetectedWorkspace[];
  loading: boolean;
  /** Findings from last review — triggers auto-fix modal */
  pendingFindings: MrReviewFindings | null;
  /** Whether the auto-fix modal is visible */
  showFixModal: boolean;
  /** Whether auto-fix is in progress */
  fixing: boolean;

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
  /** Dismiss the auto-fix modal */
  dismissFindings: () => void;
  /** Apply auto-fixes for pending findings */
  applyFixes: () => Promise<void>;
  /** Listen for findings from main process */
  listenForFindings: () => () => void;
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
  pendingFindings: null,
  showFixModal: false,
  fixing: false,

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
    try {
      const mrApi = api();
      if (!mrApi) return;
      set(s => ({
        reviewing: true,
        activeWorkspaces: [...s.activeWorkspaces, workspace],
      }));
      const res = await mrApi.trigger({ workspace });
      if (res && !res.ok) {
        set(s => ({
          reviewing: false,
          activeWorkspaces: s.activeWorkspaces.filter(w => w !== workspace),
        }));
        return;
      }
      // Poll status every 5s until reviewing is done (max 3 min)
      let polls = 0;
      const pollInterval = setInterval(async () => {
        polls++;
        const { fetchStatus } = get();
        await fetchStatus();
        const { reviewing } = get();
        if (!reviewing || polls >= 36) {
          clearInterval(pollInterval);
        }
      }, 5000);
    } catch (err) {
      console.error('[mrReviewStore] triggerReview error:', err);
    }
  },

  dismissFindings: () => {
    set({ pendingFindings: null, showFixModal: false });
  },

  applyFixes: async () => {
    const { pendingFindings } = get();
    if (!pendingFindings) return;
    try {
      const mrApi = api();
      if (!mrApi) return;
      set({ fixing: true });
      const res = await mrApi.applyFixes({
        workspace: pendingFindings.workspace,
        mrId: pendingFindings.mrId,
        findings: pendingFindings.findings.join("\n"),
        sourceBranch: pendingFindings.sourceBranch,
      });
      if (res?.ok) {
        set({ showFixModal: false, pendingFindings: null, fixing: false });
      } else {
        set({ fixing: false });
      }
    } catch {
      set({ fixing: false });
    }
  },

  listenForFindings: () => {
    const mrApi = api();
    if (!mrApi?.onFindings) return () => {};
    return mrApi.onFindings((data) => {
      if (data?.findings?.length > 0) {
        set({ pendingFindings: data as MrReviewFindings, showFixModal: true });
      }
    });
  },
}));
