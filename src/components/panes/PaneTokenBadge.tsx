import React, { useEffect, useRef, useState } from "react";
import type { TokenCounts } from "../../types/electron";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtTok(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

function fmtUsd(n: number): string {
  if (n < 0.001) return "<$0.001";
  if (n < 0.01) return "$" + n.toFixed(4);
  if (n < 1) return "$" + n.toFixed(3);
  return "$" + n.toFixed(2);
}

/**
 * Scrape last N chars of raw PTY text for a live token estimate when IPC is unavailable.
 * Pattern: arrows + number + optional k/m + "token"
 * Examples: "↑ 1234 tokens" "↓ 42k tokens" "· 1.2M tokens"
 */
function scrapeTokensFromText(raw: string): number {
  if (!raw) return 0;
  const tail = raw.slice(-4000);
  const matches = [...tail.matchAll(/[↑↓·]\s*([\d.]+)\s*([kmKM])?\s*tokens?/gi)];
  if (!matches.length) return 0;
  const last = matches[matches.length - 1];
  const num = parseFloat(last[1]);
  const suffix = (last[2] ?? "").toLowerCase();
  if (suffix === "m") return Math.round(num * 1_000_000);
  if (suffix === "k") return Math.round(num * 1_000);
  return Math.round(num);
}

// ── component ─────────────────────────────────────────────────────────────────

interface PaneTokenBadgeProps {
  paneId: string;
  /** Role of this pane: "orchestrator" adds Σ mission aggregation */
  role?: string;
  /** Mission ID — used by orchestrator to aggregate all pane tokens */
  missionId?: string;
  /** All pane IDs in the current mission (orchestrator only) */
  missionPaneIds?: string[];
  /** Whether the agent is currently generating output (shows live pulse dot) */
  isRunning?: boolean;
}

export function PaneTokenBadge({
  paneId,
  role,
  missionId,
  missionPaneIds,
  isRunning,
}: PaneTokenBadgeProps) {
  const [counts, setCounts] = useState<TokenCounts | null>(null);
  const [missionCounts, setMissionCounts] = useState<TokenCounts | null>(null);
  const [liveOut, setLiveOut] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isOrchestrator = role === "orchestrator" || role === "orquestrador";

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      try {
        // Try IPC real token data first
        const res = await (window as any).codeBrainApp?.tokens?.byPane?.({ paneId });
        if (!cancelled && res?.ok && res.data) {
          setCounts(res.data as TokenCounts);
        } else {
          // Fallback: scrape PTY text
          const rawResult = await (window as any).codeBrainApp?.pty?.readRawText?.(paneId);
          if (!cancelled && rawResult?.ok && rawResult.text) {
            const live = scrapeTokensFromText(rawResult.text);
            if (live > 0) setLiveOut(live);
          }
        }
      } catch {
        // silently ignore
      }

      // Orchestrator: also aggregate mission tokens
      if (!cancelled && isOrchestrator && missionId && missionPaneIds && missionPaneIds.length > 0) {
        try {
          const mRes = await (window as any).codeBrainApp?.tokens?.byMission?.({
            missionId,
            paneIds: missionPaneIds,
          });
          if (!cancelled && mRes?.ok && mRes.data) {
            setMissionCounts(mRes.data as TokenCounts);
          }
        } catch {}
      }
    }

    poll();
    intervalRef.current = setInterval(poll, 1200);

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [paneId, isOrchestrator, missionId, missionPaneIds?.join(",")]);

  // Only show when we have data
  const hasCounts = counts && (counts.input > 0 || counts.output > 0);
  const hasLive = liveOut > 0;
  if (!hasCounts && !hasLive) return null;

  const hasMission = isOrchestrator && missionCounts && (missionCounts.input > 0 || missionCounts.output > 0);

  return (
    <span
      className="flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded text-[9px] font-mono bg-emerald-950/60 text-emerald-300 border border-emerald-800/40 shrink-0 select-none"
      title={
        hasCounts && counts
          ? [
              `in: ${counts.input.toLocaleString()} · out: ${counts.output.toLocaleString()}`,
              counts.cache_read > 0 ? `cache_r: ${counts.cache_read.toLocaleString()}` : "",
              counts.cache_write > 0 ? `cache_w: ${counts.cache_write.toLocaleString()}` : "",
              `custo: ${fmtUsd(counts.cost_usd)}`,
              hasMission && missionCounts
                ? `\nΣ missão — in: ${missionCounts.input.toLocaleString()} · out: ${missionCounts.output.toLocaleString()} · custo: ${fmtUsd(missionCounts.cost_usd)}`
                : "",
            ]
              .filter(Boolean)
              .join(" · ")
          : `~${liveOut.toLocaleString()} tokens (estimativa ao vivo do terminal)`
      }
    >
      {/* Live pulse dot when generating */}
      {isRunning && (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
      )}

      {hasCounts && counts ? (
        <>
          <span className="text-slate-400">in</span>
          <span>{fmtTok(counts.input)}</span>
          <span className="text-slate-600">·</span>
          <span className="text-slate-400">out</span>
          <span>{fmtTok(counts.output)}</span>
          {counts.cache_read > 0 && (
            <>
              <span className="text-slate-600">·</span>
              <span className="text-slate-400">cache</span>
              <span>{fmtTok(counts.cache_read)}</span>
            </>
          )}
          {counts.cost_usd > 0 && (
            <>
              <span className="text-slate-600">·</span>
              <span className="text-emerald-500">{fmtUsd(counts.cost_usd)}</span>
            </>
          )}
          {/* Orchestrator mission total */}
          {hasMission && missionCounts && (
            <>
              <span className="text-slate-600 mx-0.5">│</span>
              <span className="text-amber-400/80">Σ</span>
              <span className="text-slate-400">in</span>
              <span>{fmtTok(missionCounts.input)}</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-400">out</span>
              <span>{fmtTok(missionCounts.output)}</span>
              {missionCounts.cost_usd > 0 && (
                <>
                  <span className="text-slate-600">·</span>
                  <span className="text-amber-400/80">{fmtUsd(missionCounts.cost_usd)}</span>
                </>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <span>~{fmtTok(liveOut)}</span>
          <span className="text-emerald-600">tok</span>
        </>
      )}
    </span>
  );
}
