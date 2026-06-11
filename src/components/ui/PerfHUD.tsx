import React, { useEffect, useRef, useState } from "react";

interface PaneSnap {
  paneId: string;
  agent: string;
  pid: number | null;
  rssMB: number;
  cpu: number;
}

interface PerfSnap {
  totalRssMB: number;
  electronRssMB: number;
  panesRssMB: number;
  paneCount: number;
  panes: PaneSnap[];
}

interface PerfHUDProps {
  visible: boolean;
}

export function PerfHUD({ visible }: PerfHUDProps) {
  const [snap, setSnap] = useState<PerfSnap | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!visible) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    async function poll() {
      try {
        const result = await window.codeBrainApp?.diagnostics?.perfSnap?.();
        if (result) setSnap(result);
      } catch {
        // fallback: use basic snapshot
        try {
          const basic = await window.codeBrainApp?.diagnostics?.snapshot?.();
          if (basic?.memory) {
            const rssMB = Math.round((basic.memory as any).rss / 1024 / 1024);
            setSnap({
              totalRssMB: rssMB,
              electronRssMB: rssMB,
              panesRssMB: 0,
              paneCount: (basic as any).panes?.length ?? 0,
              panes: ((basic as any).panes ?? []).map((p: any) => ({
                paneId: p.paneId,
                agent: p.agent ?? "agent",
                pid: null,
                rssMB: 0,
                cpu: 0,
              })),
            });
          }
        } catch { /* ignore */ }
      }
    }

    poll();
    intervalRef.current = setInterval(poll, 2000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [visible]);

  if (!visible || !snap) return null;

  const rssColor =
    snap.totalRssMB > 4096
      ? "text-red-400"
      : snap.totalRssMB > 2048
        ? "text-amber-400"
        : "text-emerald-400";

  return (
    <div className="fixed top-10 right-2 z-[9999] w-64 rounded-lg border border-white/10 bg-black/90 backdrop-blur-sm p-3 font-mono text-[10px] text-slate-300 shadow-2xl select-none">
      {/* Title */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9px] font-semibold tracking-widest text-slate-500 uppercase">Perf HUD</span>
        <span className="text-[9px] text-slate-600">Ctrl+Shift+M</span>
      </div>

      {/* Total RSS */}
      <div className="flex items-center justify-between mb-1.5 pb-1.5 border-b border-white/5">
        <span className="text-slate-400">RSS Total</span>
        <span className={`font-bold text-[11px] ${rssColor}`}>
          {snap.totalRssMB} MB
        </span>
      </div>

      {/* Breakdown */}
      <div className="flex gap-3 text-[9px] text-slate-500 mb-2">
        <span>electron <span className="text-slate-400">{snap.electronRssMB}MB</span></span>
        <span>panes <span className="text-slate-400">{snap.paneCount}</span></span>
      </div>

      {/* Per-pane list */}
      {snap.panes.length > 0 && (
        <div className="space-y-0.5">
          <div className="text-[9px] text-slate-600 mb-1 uppercase tracking-widest">Por Pane</div>
          {snap.panes.slice(0, 8).map(p => (
            <div
              key={p.paneId}
              className={`flex items-center justify-between ${p.rssMB > 300 ? "text-amber-400" : "text-slate-400"}`}
            >
              <span className="truncate max-w-[140px]">
                {p.agent}·<span className="text-slate-600">{p.paneId.slice(0, 6)}</span>
              </span>
              <span className="shrink-0 ml-1">
                {p.rssMB > 0 ? `${p.rssMB}MB` : "–"}
                {p.cpu > 0 && <span className="text-slate-500"> · {p.cpu.toFixed(1)}%</span>}
              </span>
            </div>
          ))}
          {snap.panes.length > 8 && (
            <div className="text-slate-600 text-[9px]">+{snap.panes.length - 8} mais…</div>
          )}
        </div>
      )}
    </div>
  );
}
