import React from "react";

export interface ToggleProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  enabled: boolean;
  onChange: (value: boolean) => void;
}

/** Interruptor. Passe `aria-label` ou `aria-labelledby` com o que ele controla. */
export function Toggle({ enabled, onChange, className, ...props }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className={`cb-toggle ${className ?? ""}`}
      {...props}
    />
  );
}
