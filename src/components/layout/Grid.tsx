import React from "react";

import { usePanesStore } from "../../stores/panes-store";
import { useMissionsStore } from "../../stores/missions-store";
import { DropTarget } from "./DropTarget";
import { BrowserPane } from "../panes/BrowserPane";
import { TerminalPane } from "../terminal/TerminalPane";
import { RenderNode } from "./RenderNode";
import { MissionSidebar } from "../missions/MissionSidebar";
import { WorkspaceEmptyState } from "../workspace/WorkspaceEmptyState";

export function Grid({ workspacePath } = {} as any) {
  const allPanes = usePanesStore(state => state.panes) as any[];
  const activePaneId = usePanesStore(state => state.activePaneId);
  const layouts = usePanesStore(state => state.layouts) as Record<string, Record<string, any>>;
  const setActive = usePanesStore(state => state.setActive);
  const movePaneTo = usePanesStore(state => state.movePaneTo);
  const ws = workspacePath ?? "";
  const activeMissionId = useMissionsStore(state => ws ? state.getActiveMissionId(ws) : null);
  const layout = ws && activeMissionId ? layouts[ws]?.[activeMissionId] ?? null : null;

  const missionPanes = React.useMemo(() => {
    if (!ws || !activeMissionId) return [];
    return allPanes.filter(pane => {
      if ((pane.workspacePath ?? pane.cwd) !== ws) return false;
      return pane.missionId ? pane.missionId === activeMissionId : true;
    });
  }, [allPanes, ws, activeMissionId]);

  const panesById = new Map(missionPanes.map(pane => [pane.id, pane]));

  if (!layout) return <WorkspaceEmptyState />;

  const renderLeaf = (paneId: string) => {
    const pane = panesById.get(paneId);
    if (!pane) return null;
    return (
      <DropTarget pane={pane} workspacePath={ws} movePaneTo={movePaneTo}>
        {pane.kind === "browser"
          ? <BrowserPane pane={pane} isActive={pane.id === activePaneId} onClick={() => setActive(pane.id)} />
          : <TerminalPane pane={pane} isActive={pane.id === activePaneId} onClick={() => setActive(pane.id)} />}
      </DropTarget>
    );
  };

  return (
    <div className="h-full w-full flex overflow-hidden">
      <div className="flex-1 overflow-hidden p-1.5">
        <RenderNode node={layout} panesById={panesById} renderLeaf={renderLeaf} />
      </div>
      {ws && <MissionSidebar workspacePath={ws} />}
    </div>
  );
}
