import type { PtyInfo } from "../../types/electron";
import { useMissionsStore } from "../../stores/missions-store";
import { usePanesStore } from "../../stores/panes-store";

export type MissionPaneInfo = Partial<PtyInfo> & {
  paneId: string;
  missionId?: string;
  uiMissionId?: string;
  operationalMissionId?: string;
  mission_id?: string;
  parentPaneId?: string;
  role?: string;
};

const workspaceKey = (value: string): string => {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
};

/** Um único caminho para pane:added, pty:list e reattach. Nunca usa a missão ativa para um ID operacional. */
export function ingestMissionPane(info: MissionPaneInfo): void {
  const panes = usePanesStore.getState() as {
    panes: any[];
    addPane: (config: unknown) => unknown;
    updatePane: (id: string, patch: unknown) => void;
    updatePaneMission: (id: string, missionId: string) => void;
  };
  const missions = useMissionsStore.getState();
  const existing = panes.panes.find(pane => pane.id === info.paneId);
  const parent = info.parentPaneId ? panes.panes.find(pane => pane.id === info.parentPaneId) : undefined;
  const rawWorkspace = info.workspacePath || parent?.workspacePath || existing?.workspacePath || info.cwd || parent?.cwd;
  const workspace = rawWorkspace && (Object.keys(missions.missionsByWorkspace).find(key => workspaceKey(key) === workspaceKey(rawWorkspace)) || rawWorkspace);
  const localMissions = workspace ? missions.getWorkspaceMissions(workspace) : [];
  const operationalMissionId = info.operationalMissionId || info.mission_id || (info.missionId?.startsWith("mission_") ? info.missionId : undefined);
  const explicitUiId = info.uiMissionId || info.missionId;
  let mission = localMissions.find(item => item.id === explicitUiId) ||
    (operationalMissionId ? localMissions.find(item => item.operationalMissionId === operationalMissionId) : undefined);
  // O pai só decide quando sua associação é compatível com a do evento.
  if (!mission && parent?.missionId) {
    mission = localMissions.find(item => item.id === parent.missionId && (!operationalMissionId || item.operationalMissionId === operationalMissionId));
  }
  // Missões criadas fora da UI também ganham uma identidade local estável.
  if (!mission && workspace && operationalMissionId) {
    const previousActive = missions.getActiveMissionId(workspace);
    const id = missions.createMission(workspace, { operationalMissionId });
    if (previousActive) missions.setActiveMission(workspace, previousActive);
    mission = missions.getWorkspaceMissions(workspace).find(item => item.id === id);
  }
  if (mission && workspace) {
    const patch = {
      ...(operationalMissionId && mission.operationalMissionId !== operationalMissionId ? { operationalMissionId } : {}),
      ...(mission.mode === "agentico" && info.role === "orchestrator" ? {
        pilotPaneId: info.paneId,
        pilot: { agent: info.agent, providerId: info.providerId, model: info.model },
      } : {}),
    };
    if (Object.keys(patch).length) missions.updateMission(workspace, mission.id, patch);
  }
  const config = Object.fromEntries(Object.entries({
    ...info,
    id: info.paneId,
    externallySpawned: true,
    workspacePath: workspace,
    missionId: mission?.id,
    operationalMissionId: operationalMissionId || mission?.operationalMissionId,
  }).filter(([, value]) => value !== undefined));
  if (existing?.labelLocked) delete config.label;
  // Para um pane já existente, o layout tem de ser movido antes de trocar
  // missionId no objeto; addPane sozinho retorna cedo e perde a reconciliação.
  const targetMission = mission?.id;
  delete config.missionId;
  if (!existing) panes.addPane({ ...config, ...(targetMission ? { missionId: targetMission } : {}) });
  panes.updatePane(info.paneId, config);
  if (targetMission && existing?.missionId !== targetMission) panes.updatePaneMission(info.paneId, targetMission);
}
