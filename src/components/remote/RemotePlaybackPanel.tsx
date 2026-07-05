import { useRemoteBridgeStore } from '../../stores/remote-bridge-store';

/**
 * RemotePlaybackPanel — sidebar panel for mobile remote control.
 * Shows pairing code, connection status, and connected clients.
 * Backend: remoteBridge.js (already ported).
 */
export function RemotePlaybackPanel() {
  const visible = useRemoteBridgeStore(s => s.visible);
  const status = useRemoteBridgeStore(s => s.status);
  const loading = useRemoteBridgeStore(s => s.loading);
  const toggle = useRemoteBridgeStore(s => s.toggle);
  const fetchStatus = useRemoteBridgeStore(s => s.fetchStatus);
  const start = useRemoteBridgeStore(s => s.start);
  const stop = useRemoteBridgeStore(s => s.stop);

  if (!visible) return null;

  const pairCode = status?.pairCode?.code || '------';
  const isRunning = status?.running || false;

  return (
    <div className="absolute right-0 top-0 bottom-0 z-20 w-72 bg-[#0d0d12] border-l border-white/[0.06] flex flex-col shadow-2xl overflow-hidden" style={{ WebkitAppRegion: "no-drag" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400">
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2" /><line x1="12" y1="18" x2="12.01" y2="18" />
          </svg>
          <span className="text-[12px] font-semibold text-slate-200">Remote Control</span>
          {isRunning && (
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-[8px] font-bold text-emerald-300 border border-emerald-500/20">
              live
            </span>
          )}
        </div>
        <button onClick={toggle} className="text-slate-600 hover:text-slate-300 transition-colors p-1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Pairing Code */}
        <div className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02] text-center">
          <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-2">Pairing Code</div>
          <div className="text-[28px] font-mono font-bold text-indigo-300 tracking-[0.3em]">
            {pairCode}
          </div>
          <div className="text-[9px] text-slate-600 mt-2">
            Enter this code on your mobile device to connect
          </div>
        </div>

        {/* Connection Status */}
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] text-center">
            <div className="text-[18px] font-bold text-slate-200">{status?.connectedClients ?? 0}</div>
            <div className="text-[8px] text-slate-500 uppercase tracking-wider">Connected</div>
          </div>
          <div className="p-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] text-center">
            <div className="text-[18px] font-bold text-slate-200">{status?.authenticatedClients ?? 0}</div>
            <div className="text-[8px] text-slate-500 uppercase tracking-wider">Authenticated</div>
          </div>
        </div>

        {/* Server Info */}
        {isRunning && status && (
          <div className="p-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02]">
            <div className="text-[9px] text-slate-500 space-y-1">
              <div className="flex justify-between">
                <span>Port</span>
                <span className="text-slate-300 font-mono">{status.port}</span>
              </div>
              <div className="flex justify-between">
                <span>Bind</span>
                <span className="text-slate-300 font-mono">{status.bindAddr}</span>
              </div>
              <div className="flex justify-between">
                <span>Tokens</span>
                <span className="text-slate-300 font-mono">{status.tokenCount}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-white/[0.06] space-y-2">
        <button
          onClick={() => isRunning ? stop() : start()}
          disabled={loading}
          className={`w-full py-1.5 rounded-lg text-[10px] font-medium transition-colors disabled:opacity-40 ${
            isRunning
              ? 'bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/20'
              : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/20'
          }`}
        >
          {loading ? 'Loading...' : isRunning ? 'Stop Server' : 'Start Server'}
        </button>
        <button
          onClick={() => fetchStatus()}
          className="w-full py-1.5 rounded-lg text-[9px] font-medium bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 hover:text-slate-200 transition-colors"
        >
          Refresh Status
        </button>
      </div>
    </div>
  );
}
