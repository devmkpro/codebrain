import React from "react";
import { CircleCheck, CircleOff } from "../../stores/providers-store";

// StatusPill
export function StatusPill({
  ok,
  label
}) {
  return <span className={`cb-badge ${ok ? "cb-badge--success" : "cb-badge--accent"}`}>
      {ok ? <CircleCheck size={10} strokeWidth={1.7} /> : <CircleOff size={10} strokeWidth={1.7} />}
      {label}
    </span>;
}