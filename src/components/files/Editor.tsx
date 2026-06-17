import React from "react";
import { fileKey } from "./FileTree";
import { Circle, X$1, Save } from "../../stores/providers-store";

// Editor
import { useEditorStore } from "../../stores/editor-store";
export function Editor() {
  const files = useEditorStore(s => s.files);
  const activeKey = useEditorStore(s => s.activeKey);
  const setActive = useEditorStore(s => s.setActive);
  const close = useEditorStore(s => s.close);
  const setContent = useEditorStore(s => s.setContent);
  const markSaved = useEditorStore(s => s.markSaved);
  const active = files.find(f => fileKey(f.workspacePath, f.relPath) === activeKey) ?? null;
  const save = React.useCallback(async () => {
    if (!active) return;
    const res = await window.codeBrainApp?.files?.write(active.workspacePath, active.relPath, active.content);
    if (res?.ok) markSaved(fileKey(active.workspacePath, active.relPath));
  }, [active, markSaved]);
  React.useEffect(() => {
    const handler = e => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [save]);
  if (files.length === 0) {
    return <div className="h-full flex items-center justify-center bg-black">
        <p className="font-mono text-[10px] text-gray-700">click a file to open</p>
      </div>;
  }
  return <div className="h-full flex flex-col bg-black">
      <div className="flex items-stretch border-b border-white/5 overflow-x-auto scrollbar-none shrink-0">
        {files.map(f => {
        const k2 = fileKey(f.workspacePath, f.relPath);
        const isActive = k2 === activeKey;
        const name = f.relPath.split("/").pop() ?? f.relPath;
        return <div onClick={() => setActive(k2)} className={`group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer border-r border-white/5 ${isActive ? "bg-white/5 text-gray-200" : "text-gray-500 hover:text-gray-300 hover:bg-white/5"}`} title={f.relPath}>
              <span className="font-mono text-[10px] truncate max-w-[160px]">{name}</span>
              {f.dirty && <Circle size={6} fill="currentColor" strokeWidth={0} className="text-red-500 shrink-0" />}
              <button onClick={e => {
            e.stopPropagation();
            close(k2);
          }} className="text-gray-700 hover:text-red-500 opacity-0 group-hover:opacity-100">
                <X$1 size={11} strokeWidth={1.5} />
              </button>
            </div>;
      })}
        {active && <div className="ml-auto flex items-center px-3">
            <button onClick={save} className="flex items-center gap-1 font-mono text-[10px] font-bold text-indigo-500/70 hover:text-indigo-400" title={`Save (${/Mac/i.test(navigator.userAgent) ? '⌘' : 'Ctrl'}+S)`}>
              <Save size={12} strokeWidth={1.5} /> SAVE
            </button>
          </div>}
      </div>
      {active && <textarea value={active.content} onChange={e => setContent(fileKey(active.workspacePath, active.relPath), e.target.value)} spellCheck={false} className="flex-1 w-full bg-black text-gray-200 font-mono text-[12px] leading-[1.5] p-3 resize-none outline-none" style={{
      tabSize: 2,
      whiteSpace: "pre"
    }} />}
    </div>;
}
export function timeSince(ms) {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 6e4);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
export function highConfidenceLabel(pane) {
  const session = pane.session ?? (pane.claudeSessionId ? {
    id: pane.claudeSessionId,
    confidence: "high"
  } : void 0);
  return session?.confidence === "high" ? "Resume conversation" : "Reopen pane (new session)";
}
export function sessionKey(pane) {
  const session = pane.session ?? (pane.claudeSessionId ? {
    provider: "claude",
    id: pane.claudeSessionId
  } : void 0);
  return session ? `${session.provider}:${session.id}` : null;
}