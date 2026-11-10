import React from "react";
import { savedContextLines } from "../terminal/TerminalPane";

// SavedContextPanel — últimas linhas de uma sessão restaurada.
export function SavedContextPanel({
  pane,
  open,
  onToggle
}) {
  const lines = savedContextLines(pane.lastLines);
  if (lines.length === 0) return null;
  const hasResume = pane.session?.confidence === "high";
  const label = hasResume ? `${pane.session?.provider}: retomar` : `${pane.agent}: nova sessão`;
  return (
    <div className="cb-saved-context">
      <button
        type="button"
        aria-expanded={open}
        onClick={event => {
          event.stopPropagation();
          onToggle();
        }}
        className="cb-saved-context-toggle"
      >
        <span className="cb-label">contexto salvo</span>
        <span className="truncate text-2xs text-cb-fg-2">{label}</span>
      </button>
      {open && <pre className="cb-scroll">{lines.join("\n")}</pre>}
    </div>
  );
}
