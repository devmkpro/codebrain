import React from "react";
import { Crown, HardHat } from "lucide-react";

// ── RoleBadge — shows pane role (orchestrator/worker) ──────────────────────
// Polls pane:getRole IPC every 10s for live updates when role changes.
// Falls back to "worker" when pane is not in actor_registry (most panes).

interface RoleBadgeProps {
  paneId: string;
  agent?: string;
}

const POLL_INTERVAL_MS = 10_000;

export function RoleBadge({ paneId, agent }: RoleBadgeProps) {
  const [role, setRole] = React.useState<string | null>(null);
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      try {
        const res = await (window as any).codeBrainApp?.pty?.getRole?.(paneId);
        if (!cancelled && res?.ok) {
          setRole(res.role ?? null);
        }
      } catch {
        // silently ignore
      }
    }

    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [paneId]);

  // Hide for pure shell panes (no AI agent)
  if (agent === "shell") return null;

  // Resolve effective role: registry value → fallback "worker" for any agent pane
  const effectiveRole = role ?? "worker";

  const isOrchestrator = effectiveRole === "orchestrator";

  return (
    <span
      className={
        "inline-flex h-5 shrink-0 items-center gap-1 rounded border px-1.5 font-mono text-[9px] font-bold uppercase tracking-wider transition-colors " +
        (isOrchestrator
          ? "border-amber-500/40 bg-amber-500/15 text-amber-300 shadow-[0_0_6px_rgba(245,158,11,0.15)]"
          : "border-sky-500/30 bg-sky-500/10 text-sky-400")
      }
      title={isOrchestrator ? "Orquestrador" : "Worker"}
    >
      {isOrchestrator ? (
        <Crown size={10} strokeWidth={2} className="shrink-0 text-amber-400" />
      ) : (
        <HardHat size={10} strokeWidth={1.5} className="shrink-0 text-sky-500" />
      )}
      <span>{isOrchestrator ? "ORQ" : "WORKER"}</span>
    </span>
  );
}
