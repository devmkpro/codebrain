import React from "react";

/** Linha com a assinatura `❯`. `waiting` acende o cursor: só onde o app espera por você. */
export function Prompt({ waiting = false, className, children }: {
  waiting?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={`cb-prompt ${className ?? ""}`}>
      <span className="min-w-0">{children}</span>
      {waiting && <span className="cb-caret" aria-hidden />}
    </span>
  );
}

export function Kbd({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-1 shrink-0">
      {keys.map((key) => <kbd key={key} className="cb-kbd">{key}</kbd>)}
    </span>
  );
}

/** Ponto de estado. Sempre ao lado da palavra: cor sozinha não informa. */
export function StateDot({ color, pulse = false }: { color: string; pulse?: boolean }) {
  return (
    <span
      className="cb-dot"
      data-pulse={pulse ? "true" : undefined}
      style={{ "--cb-dot-color": color } as React.CSSProperties}
      aria-hidden
    />
  );
}
