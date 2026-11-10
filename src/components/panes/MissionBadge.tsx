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
      className="cb-chip cursor-default"
      title={`Missão: ${mission.title ?? missionId}`}
    >
      {label}
    </span>
  );
}
