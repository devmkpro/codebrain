import React from "react";
import { savedContextLines } from "../terminal/TerminalPane";

// SavedContextPanel
export function SavedContextPanel({
  pane,
  open,
  onToggle
}) {
  const lines = savedContextLines(pane.lastLines);
  if (lines.length === 0) return null;
  const hasResume = pane.session?.confidence === "high";
  const label = hasResume ? `${pane.session?.provider}: resume` : `${pane.agent}: new session`;
  return <div className="shrink-0 border-b border-indigo-500/10 bg-black/70">
      <button type="button" onClick={e => {
      e.stopPropagation();
      onToggle();
    }} className="w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-white/[0.03]">
        <span className="font-mono text-[9px] uppercase tracking-widest text-red-400/80">
          saved context
        </span>
        <span className="font-mono text-[9px] text-gray-500 truncate">{label}</span>
      </button>
      {open && <pre className="max-h-28 overflow-auto px-3 pb-2 font-mono text-[10px] leading-relaxed text-gray-400 whitespace-pre-wrap break-words">
          {lines.join("\n")}
        </pre>}
    </div>;
}