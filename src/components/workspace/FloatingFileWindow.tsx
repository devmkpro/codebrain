import React from "react";
import { Circle, Save, X$1 } from "../../stores/providers-store";

// FloatingFileWindow
export function FloatingFileWindow({
  file,
  onFocus,
  onMove,
  onChange,
  onSave,
  onClose
}) {
  const dragRef = React.useRef(null);
  const name = file.relPath.split("/").pop() ?? file.relPath;
  React.useEffect(() => {
    const onPointerMove = event => {
      const drag = dragRef.current;
      if (!drag) return;
      onMove(Math.max(8, drag.x + event.clientX - drag.startX), Math.max(36, drag.y + event.clientY - drag.startY));
    };
    const onPointerUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [onMove]);
  return <div className="absolute rounded border border-white/10 bg-[#050505] shadow-2xl overflow-hidden flex flex-col" style={{
    left: file.x,
    top: file.y,
    width: file.w,
    height: file.h,
    zIndex: file.z,
    resize: "both",
    minWidth: 320,
    minHeight: 220
  }} onMouseDown={onFocus}>
      <div className="shrink-0 flex items-center justify-between gap-2 px-2.5 py-1.5 bg-black border-b border-white/10 cursor-grab active:cursor-grabbing select-none" onPointerDown={event => {
      onFocus();
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        x: file.x,
        y: file.y
      };
    }}>
        <div className="min-w-0 flex items-center gap-1.5">
          {file.dirty && <Circle size={6} fill="currentColor" strokeWidth={0} className="text-red-500 shrink-0" />}
          <span className="font-mono text-[10px] font-bold text-gray-300 truncate">{name}</span>
          <span className="font-mono text-[9px] text-gray-700 truncate">{file.relPath}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={e => {
          e.stopPropagation();
          onSave();
        }} className="h-5 w-5 flex items-center justify-center text-gray-500 hover:text-indigo-400" title="Save">
            <Save size={12} strokeWidth={1.5} />
          </button>
          <button onClick={e => {
          e.stopPropagation();
          onClose();
        }} className="h-5 w-5 flex items-center justify-center text-gray-500 hover:text-red-500" title="Close">
            <X$1 size={12} strokeWidth={1.5} />
          </button>
        </div>
      </div>
      <textarea value={file.content} onChange={e => onChange(e.target.value)} spellCheck={false} className="flex-1 w-full bg-black text-gray-200 font-mono text-[12px] leading-[1.5] p-3 resize-none outline-none" style={{
      tabSize: 2,
      whiteSpace: "pre"
    }} />
    </div>;
}