import React from "react";

export type BadgeTone = "neutral" | "accent" | "success" | "warn" | "danger" | "info";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return <span className={`cb-badge ${tone === "neutral" ? "" : `cb-badge--${tone}`} ${className ?? ""}`} {...props} />;
}
