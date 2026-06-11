import { create } from 'zustand';
import { nanoid } from 'nanoid';

export type NotifLevel = 'info' | 'success' | 'warning' | 'error';

export interface AppNotification {
  id: string;
  title: string;
  body?: string;
  level: NotifLevel;
  at: number;
  read: boolean;
  /** If set, this notification came from SQLite (has a DB id) */
  dbId?: string;
  mr_url?: string;
  provider?: string;
}

interface NotificationsState {
  notifications: AppNotification[];
  unreadCount: number;
  /** Push a local-only notification (in-memory, not persisted) */
  push: (title: string, body?: string, level?: NotifLevel) => void;
  /** Fetch persisted notifications from SQLite via IPC */
  fetchFromDB: () => Promise<void>;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

const api = () => (window as any).codeBrainApp?.notifications;

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  notifications: [],
  unreadCount: 0,

  push: (title, body, level = 'info') => {
    const notif: AppNotification = { id: nanoid(), title, body, level, at: Date.now(), read: false };
    set(s => ({
      notifications: [notif, ...s.notifications].slice(0, 100),
      unreadCount: s.unreadCount + 1,
    }));
  },

  fetchFromDB: async () => {
    try {
      const nApi = api();
      if (!nApi) return;
      const [listRes, countRes] = await Promise.all([
        nApi.list({ limit: 50 }),
        nApi.count(),
      ]);
      if (!listRes?.ok) return;
      const dbNotifs: AppNotification[] = (listRes.notifications || []).map((n: any) => ({
        id: n.id,
        dbId: n.id,
        title: n.title,
        body: n.body,
        level: (n.level || 'info') as NotifLevel,
        at: (n.created_at || 0) * 1000, // SQLite stores seconds, JS uses ms
        read: !!n.read,
        mr_url: n.mr_url,
        provider: n.provider,
      }));
      // Merge: DB notifications first, then any in-memory-only ones (dedup by dbId)
      const dbIds = new Set(dbNotifs.map(n => n.dbId));
      set(s => {
        const localOnly = s.notifications.filter(n => !n.dbId && !dbIds.has(n.id));
        const merged = [...dbNotifs, ...localOnly].slice(0, 100);
        const unread = countRes?.ok ? (countRes.count || 0) : merged.filter(n => !n.read).length;
        return { notifications: merged, unreadCount: unread };
      });
    } catch {}
  },

  markAllRead: () => {
    set(s => ({
      notifications: s.notifications.map(n => ({ ...n, read: true })),
      unreadCount: 0,
    }));
    // Sync to DB
    try { api()?.markAllRead?.(); } catch {}
  },

  dismiss: (id) => {
    // Read notif BEFORE removing from state — get() after set() would miss it
    const notif = get().notifications.find(n => n.id === id);
    set(s => ({
      notifications: s.notifications.filter(n => n.id !== id),
      unreadCount: notif && !notif.read ? Math.max(0, s.unreadCount - 1) : s.unreadCount,
    }));
    // If it has a dbId, also delete from DB
    if (notif?.dbId) {
      try { api()?.dismiss?.({ id: notif.dbId }); } catch {}
    }
  },

  clear: () => {
    set({ notifications: [], unreadCount: 0 });
    try { api()?.clear?.(); } catch {}
  },
}));
