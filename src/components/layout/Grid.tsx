import React from "react";

// Grid
import { usePanesStore } from "../../stores/panes-store";
import { DropTarget } from "./DropTarget";
import { BrowserPane } from "../panes/BrowserPane";
import { TerminalPane } from "../terminal/TerminalPane";
import { RenderNode } from "./RenderNode";
export function Grid({
  workspacePath
} = {}) {
  const allPanes = usePanesStore(s => s.panes);
  const activePaneId = usePanesStore(s => s.activePaneId);
  const layouts = usePanesStore(s => s.layouts);
  const setActive = usePanesStore(s => s.setActive);
  const movePaneTo = usePanesStore(s => s.movePaneTo);
  const ws = workspacePath ?? "";
  const layout = ws ? layouts[ws] ?? null : null;
  const panesById = new Map(allPanes.map(p => [p.id, p]));
  if (!layout) {
    return <div className="flex-1 flex items-center justify-center select-none">
        <div className="text-center space-y-3">
          <p className="font-mono text-[10px] text-gray-700 tracking-wider">NO PANES OPEN</p>
          <p className="font-mono text-[9px] text-gray-600 tracking-wider">
            Use <span className="text-red-500/80">+ PANE</span> in the top right to spawn one with a
            provider.
          </p>
        </div>
      </div>;
  }
  const renderLeaf = paneId => {
    const pane = panesById.get(paneId);
    if (!pane) return null;
    return <DropTarget pane={pane} workspacePath={ws} movePaneTo={movePaneTo}>
        {pane.kind === "browser" ? <BrowserPane pane={pane} isActive={pane.id === activePaneId} onClick={() => setActive(pane.id)} /> : <TerminalPane pane={pane} isActive={pane.id === activePaneId} onClick={() => setActive(pane.id)} />}
      </DropTarget>;
  };
  return <div className="h-full w-full overflow-hidden p-1.5">
      <RenderNode node={layout} panesById={panesById} renderLeaf={renderLeaf} />
    </div>;
}