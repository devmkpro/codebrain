import React from "react";
import { DollarSign, X } from "lucide-react";
import { useCostStore } from "../../stores/cost-store";
import { CostPanel } from "./CostPanel";

export function UsageSidebar() {
  const visible = useCostStore((s) => s.visible);
  const toggle = useCostStore((s) => s.toggle);

  if (!visible) return null;

  return (
    <div
      className="absolute right-0 top-0 bottom-0 z-20 w-96 bg-black border-l border-white/10 flex flex-col shadow-2xl"
      style={{ WebkitAppRegion: "no-drag" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-1.5">
          <DollarSign size={13} strokeWidth={1.5} className="text-green-500/70" />
          <p className="font-mono text-[10px] font-bold text-white tracking-widest uppercase">
            Token Usage
          </p>
        </div>
        <button onClick={toggle} className="text-gray-600 hover:text-red-500 cursor-pointer">
          <X size={12} strokeWidth={1.5} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto hacker-scroll p-3">
        <CostPanel />
      </div>
    </div>
  );
}
