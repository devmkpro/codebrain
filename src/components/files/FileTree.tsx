import React from "react";

// FileTree
import { FileNode } from "./FileNode";
export function FileTree({
  workspacePath,
  onFileClick
}) {
  const [items, setItems] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    setItems(null);
    window.codeBrainApp?.files?.list(workspacePath).then(res => {
      if (cancelled) return;
      // Accept both { ok, items } contract and raw array (legacy/backwards compat)
      const items = Array.isArray(res) ? res : (res?.items ?? []);
      setItems(items);
    });
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);
  const folderName = workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? workspacePath;
  return <div className="h-full flex flex-col bg-black border-r border-white/5">
      <div className="px-3 py-2 border-b border-white/5">
        <p className="font-mono text-[9px] text-gray-700 uppercase tracking-widest">Files</p>
        <p className="font-mono text-[10px] text-gray-500 truncate">{folderName}</p>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {items === null && <div className="px-3 py-2 font-mono text-[10px] text-gray-700">…</div>}
        {items?.length === 0 && <div className="px-3 py-2 font-mono text-[10px] text-gray-700">empty</div>}
        {items?.map(e => <FileNode workspacePath={workspacePath} entry={e} depth={0} onFileClick={onFileClick} />)}
      </div>
    </div>;
}
export function fileKey(workspacePath, relPath) {
  return `${workspacePath}::${relPath}`;
}