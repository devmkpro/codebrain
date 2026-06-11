import React from "react";
import { useMissionsStore } from "../../stores/missions-store";

interface MissionBadgeProps {
  missionId?: string;
  workspacePath?: string;
}

export function MissionBadge({ missionId, workspacePath }: MissionBadgeProps) {
  const missionsByWorkspace = useMissionsStore((s) => s.missionsByWorkspace);

  if (!missionId) return null;

  // Search across all workspaces (or the specific one)
  const allMissions = workspacePath
    ? (missionsByWorkspace[workspacePath] ?? [])
    : Object.values(missionsByWorkspace).flat();

  const mission = allMissions.find((m) => m.id === missionId);
  if (!mission || mission.status === "archived") return null;

  const label = mission.title ? mission.title.slice(0, 10) : missionId.slice(0, 6);

  return (
    <span
      className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-amber-900/30 text-amber-400 border border-amber-700/30 shrink-0 cursor-default"
      title={`Mission: ${mission.title ?? missionId}`}
    >
      {label}
    </span>
  );
}
