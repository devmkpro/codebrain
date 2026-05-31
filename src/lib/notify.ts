import { useNotificationsStore } from '../stores/notifications-store';
import type { NotifLevel } from '../stores/notifications-store';

/**
 * Envia uma notificação desktop (via IPC) e registra na store in-app.
 * Use este helper em vez de chamar codeBrainApp.notify diretamente.
 */
export function notify(title: string, body?: string, level: NotifLevel = 'info') {
  useNotificationsStore.getState().push(title, body, level);
  (window as any).codeBrainApp?.notify?.(title, body ?? '');
}
