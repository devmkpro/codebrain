import { create } from "zustand";

const STORAGE_KEY = "codebrain-whats-new-version";

interface WhatsNewStore {
  /** Whether the modal is currently visible */
  shown: boolean;
  /** Last version the user dismissed */
  lastSeenVersion: string;
  /** Show the modal */
  show: () => void;
  /** Dismiss the modal and persist the version */
  dismiss: (version: string) => void;
  /** Returns true if the modal should be shown for this version */
  shouldShow: (currentVersion: string) => boolean;
}

export const useWhatsNewStore = create<WhatsNewStore>((set, get) => ({
  shown: false,
  lastSeenVersion: localStorage.getItem(STORAGE_KEY) ?? "",

  show: () => set({ shown: true }),

  dismiss: (version: string) => {
    localStorage.setItem(STORAGE_KEY, version);
    set({ shown: false, lastSeenVersion: version });
  },

  shouldShow: (currentVersion: string) => {
    if (!currentVersion) return false;
    const lastSeen = get().lastSeenVersion;
    return lastSeen !== currentVersion;
  },
}));
