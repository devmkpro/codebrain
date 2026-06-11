import React from 'react';
import { Bell, X, CheckCheck, Trash2, Info, CheckCircle, AlertTriangle, AlertCircle, ExternalLink, Globe } from 'lucide-react';
import { useNotificationsStore } from '../../stores/notifications-store';
import type { NotifLevel } from '../../stores/notifications-store';

const PROVIDER_ICON: Record<string, React.ReactNode> = {
  gitlab: <Globe size={10} className="text-orange-400" />,
  github: <Globe size={10} className="text-slate-300" />,
};

function timeSince(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'agora';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

const LEVEL_ICON: Record<NotifLevel, React.ReactNode> = {
  info:    <Info size={13} strokeWidth={1.6} className="text-blue-400" />,
  success: <CheckCircle size={13} strokeWidth={1.6} className="text-emerald-400" />,
  warning: <AlertTriangle size={13} strokeWidth={1.6} className="text-amber-400" />,
  error:   <AlertCircle size={13} strokeWidth={1.6} className="text-red-400" />,
};

const LEVEL_DOT: Record<NotifLevel, string> = {
  info:    'bg-blue-400',
  success: 'bg-emerald-400',
  warning: 'bg-amber-400',
  error:   'bg-red-400',
};

// ─── Bell button (exported for use in header) ─────────────────────────────────

export function NotificationsBell() {
  const [open, setOpen] = React.useState(false);
  const [anchor, setAnchor] = React.useState<{ top: number; right: number } | null>(null);
  const unread = useNotificationsStore(s => s.unreadCount);
  const fetchFromDB = useNotificationsStore(s => s.fetchFromDB);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const panelRef  = React.useRef<HTMLDivElement>(null);

  // Fetch persisted notifications from SQLite on mount
  React.useEffect(() => { fetchFromDB(); }, [fetchFromDB]);

  React.useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (buttonRef.current?.contains(e.target as Node)) return;
      if (panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h);
    window.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); window.removeEventListener('keydown', k); };
  }, [open]);

  // mark all read when panel opens
  const markAllRead = useNotificationsStore(s => s.markAllRead);
  React.useEffect(() => { if (open) markAllRead(); }, [open, markAllRead]);

  const handleToggle = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      // Compensate for CSS body zoom: getBoundingClientRect returns zoomed coords
      // but fixed positioning uses unzoomed viewport coords.
      const zoom = parseFloat(document.body.style.zoom) || 1;
      setAnchor({
        top: (rect.bottom + 6) / zoom,
        right: (window.innerWidth - rect.right) / zoom,
      });
    }
    setOpen(v => !v);
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleToggle}
        className={`relative w-8 h-8 rounded-lg flex items-center justify-center transition-all cursor-pointer focus:outline-none
          ${open ? 'text-violet-300 bg-violet-500/10' : 'text-slate-600 hover:text-slate-300 hover:bg-white/[0.04]'}`}
        title="Notificações"
      >
        <Bell size={14} />
        {unread > 0 && (
          <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-violet-400" />
        )}
      </button>

      {open && anchor && (
        <NotificationsPanel ref={panelRef} onClose={() => setOpen(false)} anchor={anchor} />
      )}
    </>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

const NotificationsPanel = React.forwardRef<HTMLDivElement, { onClose: () => void; anchor: { top: number; right: number } }>(
  ({ onClose, anchor }, ref) => {
    const notifications = useNotificationsStore(s => s.notifications);
    const dismiss = useNotificationsStore(s => s.dismiss);
    const clear   = useNotificationsStore(s => s.clear);

    return (
      <div
        ref={ref}
        className="fixed z-[99999] w-[340px] max-w-[calc(100vw-1rem)]
                   rounded-xl border border-white/10 bg-[#0a0a0a] shadow-2xl overflow-hidden"
        style={{
          top: anchor.top,
          right: anchor.right,
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        {/* header */}
        <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <Bell size={13} strokeWidth={1.5} className="text-violet-400" />
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-slate-300">
              Notificações
            </span>
            {notifications.length > 0 && (
              <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[9px] text-slate-600">
                {notifications.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {notifications.length > 0 && (
              <button
                onClick={clear}
                className="flex h-6 w-6 items-center justify-center rounded border border-white/10 text-slate-600
                           hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-300 transition-all focus:outline-none"
                title="Limpar tudo"
              >
                <Trash2 size={11} strokeWidth={1.6} />
              </button>
            )}
            <button
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded border border-white/10 text-slate-600
                         hover:border-white/20 hover:text-slate-300 transition-all focus:outline-none"
              title="Fechar"
            >
              <X size={11} strokeWidth={1.7} />
            </button>
          </div>
        </div>

        {/* list */}
        <div className="max-h-[400px] overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 px-4">
              <CheckCheck size={22} strokeWidth={1.2} className="text-slate-700" />
              <p className="font-mono text-[10px] text-slate-600 tracking-wider">Sem notificações</p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {notifications.map(n => (
                <div
                  key={n.id}
                  className={`group flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-white/[0.02]
                    ${n.read ? '' : 'bg-violet-500/[0.03]'}`}
                >
                  {/* level icon */}
                  <div className="mt-0.5 shrink-0">{LEVEL_ICON[n.level]}</div>

                  {/* content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {n.provider && PROVIDER_ICON[n.provider]}
                        <span className="font-mono text-[10px] font-bold text-slate-200 truncate">{n.title}</span>
                      </div>
                      <span className="shrink-0 font-mono text-[9px] text-slate-700 tabular-nums">{timeSince(n.at)}</span>
                    </div>
                    {n.body && (
                      <p className="mt-0.5 font-mono text-[10px] text-slate-500 leading-relaxed line-clamp-2">{n.body}</p>
                    )}
                    {n.mr_url && (
                      <a
                        href={n.mr_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-[9px] font-mono text-indigo-400 hover:text-indigo-300 hover:underline transition-colors"
                      >
                        <ExternalLink size={8} /> Abrir MR
                      </a>
                    )}
                  </div>

                  {/* dismiss */}
                  <button
                    onClick={() => dismiss(n.id)}
                    className="mt-0.5 shrink-0 flex h-5 w-5 items-center justify-center rounded text-slate-700
                               opacity-0 group-hover:opacity-100 hover:bg-white/10 hover:text-slate-400
                               transition-all focus:outline-none"
                    title="Dispensar"
                  >
                    <X size={10} strokeWidth={1.8} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
);
NotificationsPanel.displayName = 'NotificationsPanel';
