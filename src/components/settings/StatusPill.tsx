import React from "react";
import { CircleCheck, CircleOff } from "../../stores/providers-store";

// StatusPill
export function StatusPill({
  ok,
  label
}) {
  return <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest ${ok ? "border-green-500/25 bg-green-500/10 text-green-300" : "border-indigo-500/25 bg-indigo-500/10 text-indigo-300"}`}>
      {ok ? <CircleCheck size={10} strokeWidth={1.7} /> : <CircleOff size={10} strokeWidth={1.7} />}
      {label}
    </span>;
}