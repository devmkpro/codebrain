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
}

interface NotificationsState {
  notifications: AppNotification[];
  unreadCount: number;
  push: (title: string, body?: string, level?: NotifLevel) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

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

  markAllRead: () => set(s => ({
    notifications: s.notifications.map(n => ({ ...n, read: true })),
    unreadCount: 0,
  })),

  dismiss: (id) => set(s => {
    const notif = s.notifications.find(n => n.id === id);
    return {
      notifications: s.notifications.filter(n => n.id !== id),
      unreadCount: notif && !notif.read ? Math.max(0, s.unreadCount - 1) : s.unreadCount,
    };
  }),

  clear: () => set({ notifications: [], unreadCount: 0 }),
}));
