import React from "react";
import { ChevronDown, ChevronRight, FolderOpen, Folder } from "../../stores/providers-store";
import { fileIcon, CODEBRAIN_FILE_DRAG_TYPE } from "../session/SessionMap";

// FileNode
export function FileNode({
  workspacePath,
  entry,
  depth,
  onFileClick
}) {
  const [open, setOpen] = React.useState(false);
  const [children, setChildren] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const toggle = React.useCallback(async () => {
    if (!entry.isDir) {
      onFileClick?.(entry.path);
      return;
    }
    const next = !open;
    setOpen(next);
    if (next && children === null) {
      setLoading(true);
      const res = await window.codeBrainApp?.files?.list(workspacePath, entry.path);
      setChildren(res?.ok && res.items ? res.items : []);
      setLoading(false);
    }
  }, [entry, open, children, workspacePath, onFileClick]);
  const Chevron = entry.isDir ? open ? ChevronDown : ChevronRight : null;
  const FolderIcon = open ? FolderOpen : Folder;
  const fi = entry.isDir ? null : fileIcon(entry.name);
  return <div>
      <button onClick={toggle} draggable={!entry.isDir} onDragStart={e => {
      if (entry.isDir) return;
      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData(CODEBRAIN_FILE_DRAG_TYPE, entry.path);
      e.dataTransfer.setData("text/plain", entry.path);
    }} className="w-full flex items-center gap-1.5 px-2 py-0.5 hover:bg-white/5 text-left font-mono text-[11px] text-gray-300" style={{
      paddingLeft: 8 + depth * 12
    }}>
        {Chevron ? <Chevron size={12} strokeWidth={1.5} className="text-gray-600 shrink-0" /> : <span className="w-3 shrink-0" />}
        {entry.isDir ? <FolderIcon size={14} strokeWidth={1.5} className="text-indigo-500/70 shrink-0" /> : fi && <fi.Icon size={14} strokeWidth={1.5} className={`${fi.color} shrink-0`} />}
        <span className="truncate">{entry.name}</span>
      </button>
      {open && <div>
          {loading && <div className="font-mono text-[10px] text-gray-700" style={{
        paddingLeft: 20 + depth * 12
      }}>
              …
            </div>}
          {children?.map(c => <FileNode workspacePath={workspacePath} entry={c} depth={depth + 1} onFileClick={onFileClick} />)}
        </div>}
    </div>;
}