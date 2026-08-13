import React from "react";
import { CODEBRAIN_FILE_DRAG_TYPE } from "../session/SessionMap";

import { usePanesStore } from "../../stores/panes-store";
import { SessionMap } from "../session/SessionMap";
import { FileTree } from "../files/FileTree";
import { useEditorStore } from "../../stores/editor-store";
import { Editor } from "../files/Editor";
import { Grid } from "../layout/Grid";
import { FloatingFileWindow } from "./FloatingFileWindow";

export function WorkspaceView({ workspacePath, view }) {
  const addPane = usePanesStore(s => s.addPane);
  const [floatingFiles, setFloatingFiles] = React.useState([]);
  const rootRef = React.useRef(null);
  const zRef = React.useRef(50);

  // Panes spawned by MCP enter the same terminal-first workspace immediately.
  React.useEffect(() => {
    const unsub = window.codeBrainApp?.pty?.onPaneAdded?.((info: any) => {
      if (!info?.paneId) return;
      addPane({
        id: info.paneId,
        agent: info.agent || "openclaude",
        cwd: info.cwd || workspacePath,
        workspacePath,
        providerId: info.providerId,
        model: info.model,
        externallySpawned: true,
      });
    });
    return () => { unsub?.(); };
  }, [addPane, workspacePath]);

  const bringFloatingFileToFront = React.useCallback(id => {
    const nextZ = ++zRef.current;
    setFloatingFiles(prev => prev.map(f => f.id === id ? { ...f, z: nextZ } : f));
  }, []);

  const openFloatingFile = React.useCallback(async (relPath, point) => {
    const existing = floatingFiles.find(f => f.workspacePath === workspacePath && f.relPath === relPath);
    if (existing) {
      bringFloatingFileToFront(existing.id);
      return;
    }
    const res = await window.codeBrainApp?.files?.read(workspacePath, relPath);
    if (!res?.ok || typeof res.content !== "string") return;
    const rect = rootRef.current?.getBoundingClientRect();
    const x = Math.max(12, Math.min((point?.x ?? 320) - (rect?.left ?? 0), Math.max(12, (rect?.width ?? 900) - 520)));
    const y = Math.max(46, Math.min((point?.y ?? 120) - (rect?.top ?? 0), Math.max(46, (rect?.height ?? 700) - 380)));
    setFloatingFiles(prev => [...prev, {
      id: `${relPath}-${Date.now()}`,
      workspacePath,
      relPath,
      content: res.content,
      dirty: false,
      x,
      y,
      w: 520,
      h: 360,
      z: ++zRef.current,
    }]);
  }, [bringFloatingFileToFront, floatingFiles, workspacePath]);

  const updateFloatingFile = React.useCallback((id, patch) => {
    setFloatingFiles(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
  }, []);

  const closeFloatingFile = React.useCallback(id => {
    setFloatingFiles(prev => prev.filter(f => f.id !== id));
  }, []);

  const saveFloatingFile = React.useCallback(async file => {
    const res = await window.codeBrainApp?.files?.write(file.workspacePath, file.relPath, file.content);
    if (res?.ok) updateFloatingFile(file.id, { dirty: false });
  }, [updateFloatingFile]);

  return (
    <div
      ref={rootRef}
      className="flex flex-col h-full cb-surface"
      onDragOver={event => {
        if (!event.dataTransfer.types.includes(CODEBRAIN_FILE_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={event => {
        const relPath = event.dataTransfer.getData(CODEBRAIN_FILE_DRAG_TYPE);
        if (!relPath) return;
        event.preventDefault();
        void openFloatingFile(relPath, { x: event.clientX, y: event.clientY });
      }}
    >
      {view?.kind === "map" && (
        <div className="flex-1 min-h-0 flex">
          <SessionMap workspacePath={workspacePath} />
        </div>
      )}

      {view?.kind === "files" && (
        <div className="flex-1 min-h-0 flex">
          <div style={{ width: 260, flexShrink: 0 }} className="h-full border-r border-cb-line-0">
            <FileTree
              workspacePath={workspacePath}
              onFileClick={async relPath => {
                const res = await window.codeBrainApp?.files?.read(workspacePath, relPath);
                if (res?.ok && typeof res.content === "string") {
                  useEditorStore.getState().open(workspacePath, relPath, res.content);
                }
              }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <Editor />
          </div>
        </div>
      )}

      <div
        className="flex-1 min-h-0"
        style={{ display: view?.kind === "map" || view?.kind === "files" ? "none" : "flex" }}
      >
        <Grid workspacePath={workspacePath} />
      </div>

      {floatingFiles.map(file => (
        <FloatingFileWindow
          key={file.id}
          file={file}
          onFocus={() => bringFloatingFileToFront(file.id)}
          onMove={(x, y) => updateFloatingFile(file.id, { x, y })}
          onChange={content => updateFloatingFile(file.id, { content, dirty: true })}
          onSave={() => saveFloatingFile(file)}
          onClose={() => closeFloatingFile(file.id)}
        />
      ))}
    </div>
  );
}
