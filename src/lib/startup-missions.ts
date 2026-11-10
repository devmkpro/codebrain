import { useMissionsStore } from '../stores/missions-store';
import { usePanesStore } from '../stores/panes-store';

const workspaceKey = (value: string | undefined) => {
  const normalized = value?.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized && /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
};

/** Remove empty persisted rows only after IPC confirms the live pane list.
 * Saved sessions retain their mission even before their deferred auto-resume.
 * This does not close panes, delete native sessions or archive backend work.
 */
export async function reconcileStartupMissions(
  live: any[],
  loadSnapshot: (workspace: string) => Promise<any>,
): Promise<void> {
  const store = useMissionsStore.getState();
  const candidates = Object.entries(store.missionsByWorkspace).map(([workspace, missions]) => ({
    workspace, missions: missions.filter(m => m.status !== 'archived'),
  }));
  for (const { workspace, missions } of candidates) {
    let snapshot: any;
    try {
      const response = await loadSnapshot(workspace);
      // An IPC error is not evidence that a workspace has no saved sessions.
      if (!response?.ok && response?.error !== 'no snapshot found') continue;
      snapshot = response.snapshot;
    } catch { continue; }
    const panes = [...live, ...(snapshot?.panes ?? []), ...(usePanesStore.getState() as any).panes];
    const retained = new Set<string>();
    for (const pane of panes) {
      const paneWorkspace = pane.workspacePath ?? pane.cwd ?? (snapshot?.panes?.includes(pane) ? workspace : undefined);
      if (workspaceKey(paneWorkspace) !== workspaceKey(workspace)) continue;
      const mission = missions.find(m => m.id === (pane.uiMissionId ?? pane.missionId)
        || (m.operationalMissionId && m.operationalMissionId === (pane.operationalMissionId ?? pane.missionId))
        || (m.pilotPaneId && m.pilotPaneId === (pane.paneId ?? pane.id)));
      const fallback = store.getActiveMissionId(workspace);
      if (mission) retained.add(mission.id);
      else if (!pane.missionId && fallback) retained.add(fallback);
    }
    store.pruneStartupMissions(workspace, missions.map(m => m.id), [...retained]);
  }
}
