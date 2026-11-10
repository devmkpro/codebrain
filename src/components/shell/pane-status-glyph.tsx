import React from "react";
import "../../styles/terminal.css";
import {
  activityPresentation,
  formatElapsed,
  type PaneActivity,
} from "./pane-status";

/* Formas desenhadas em SVG, não caracteres: a cobertura de ◐ ⊘ ◆ varia entre
   as fontes do stack mono, e um glifo trocado por tofu derrubaria justamente
   o canal que garante leitura sem depender de cor. */
const SHAPES: Record<PaneActivity, React.ReactNode> = {
  idle: <circle cx="6" cy="6" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />,
  thinking: (
    <>
      <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 2a4 4 0 0 1 0 8z" fill="currentColor" />
    </>
  ),
  running: <path d="M3.5 2 8 6l-4.5 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />,
  waiting: <path fillRule="evenodd" d="M6 .5 11.5 6 6 11.5.5 6zM6 4.5A1.5 1.5 0 1 0 6 7.5 1.5 1.5 0 0 0 6 4.5z" fill="currentColor" />,
  blocked: (
    <>
      <circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 9 9 3" stroke="currentColor" strokeWidth="1.5" />
    </>
  ),
  failed: <path d="m2.5 2.5 7 7m0-7-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />,
  done: <path d="m2 6.5 2.75 2.75L10 3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />,
};

export function StatusGlyph({ activity, size = 12 }: { activity: PaneActivity; size?: number }) {
  const presentation = activityPresentation(activity);
  return (
    <span
      className="cb-status-glyph"
      data-motion={presentation.motion}
      style={{ "--cb-status-color": presentation.color } as React.CSSProperties}
      role="img"
      aria-label={presentation.label}
      title={presentation.label}
    >
      <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden>
        {SHAPES[activity]}
      </svg>
    </span>
  );
}

/** Tempo da atividade atual. Só agenda relógio quando o estado conta tempo. */
export function ElapsedTime({ since, ticking }: { since?: number; ticking: boolean }) {
  const [, tick] = React.useReducer((value: number) => value + 1, 0);
  React.useEffect(() => {
    if (!ticking || !since) return;
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [since, ticking]);
  if (!since || !ticking) return null;
  return (
    <time className="cb-elapsed" title="Tempo na atividade atual">
      {formatElapsed(Date.now() - since)}
    </time>
  );
}
