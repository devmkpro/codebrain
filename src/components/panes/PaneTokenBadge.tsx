import React, { useEffect, useRef, useState } from "react";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtTok(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return Math.round(n / 1_000) + "k";
  return String(n);
}

/**
 * Scrape last N chars of raw PTY text for the live token count emitted by
 * Claude Code / other CLIs. Pattern: arrows + number + optional k/m + "token"
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

interface TokenCounts {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  cost_usd: number;
}

interface PaneTokenBadgeProps {
  paneId: string;
  isRunning?: boolean;
}

export function PaneTokenBadge({ paneId, isRunning }: PaneTokenBadgeProps) {
  const [counts, setCounts] = useState<TokenCounts | null>(null);
  const [liveOut, setLiveOut] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      try {
        // Try cost store first (has real token data from session files)
        const costData = await (window as any).codeBrainApp?.cost?.listModels?.();
        // Then get pane raw text for live scraping
        const rawResult = await (window as any).codeBrainApp?.pty?.readRawText?.(paneId);
        if (!cancelled && rawResult?.ok && rawResult.text) {
          const live = scrapeTokensFromText(rawResult.text);
          setLiveOut(live);
        }
        // For now counts come from scraping — future: IPC tokens:byPane
        // We show live output token count from PTY scraping
      } catch {
        // silently ignore
      }
    }

    // Poll every 1200ms (matching Overclock's cadence)
    poll();
    intervalRef.current = setInterval(poll, 1200);

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [paneId]);

  // Only show when we have live data
  if (!liveOut && !counts) return null;

  const total = counts
    ? counts.input + counts.output + counts.cache_read + counts.cache_write
    : liveOut;

  if (total === 0) return null;

  return (
    <span
      className="flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded text-[9px] font-mono bg-emerald-950/60 text-emerald-400 border border-emerald-800/40 shrink-0"
      title={
        counts
          ? `in: ${counts.input} · out: ${counts.output} · cache_r: ${counts.cache_read} · cache_w: ${counts.cache_write}\ncusto: $${counts.cost_usd.toFixed(4)}`
          : `~${liveOut} tokens (estimativa ao vivo do terminal)`
      }
    >
      {counts ? (
        <>
          <span className="text-slate-400">in</span>
          <span>{fmtTok(counts.input)}</span>
          <span className="text-slate-500">·</span>
          <span className="text-slate-400">out</span>
          <span>{fmtTok(counts.output)}</span>
          {counts.cache_read > 0 && (
            <>
              <span className="text-slate-500">·</span>
              <span className="text-slate-400">$</span>
              <span>{counts.cost_usd.toFixed(3)}</span>
            </>
          )}
        </>
      ) : (
        <>
          {isRunning && (
            <span className="inline-block w-1 h-1 rounded-full bg-emerald-400 animate-pulse mr-0.5" />
          )}
          <span>~{fmtTok(liveOut)}</span>
          <span className="text-emerald-600">tok</span>
        </>
      )}
    </span>
  );
}
