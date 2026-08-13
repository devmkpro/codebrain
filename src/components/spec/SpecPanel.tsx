import React, { useEffect, useState } from "react";
import { FileCode2, Plus, X } from "lucide-react";
import { useSpecStore } from "../../stores/spec-store";
import { useNavStore } from "../../stores/nav-store";

export function SpecPanel() {
  const { visible, specs, loading, error, toggle, load, create } = useSpecStore();
  const tabs = useNavStore((state) => state.tabs) as Array<{ workspacePath: string }>;
  const active = useNavStore((state) => state.activeTabIndex);
  const workspace = tabs[active]?.workspacePath;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  useEffect(() => { if (visible && workspace) void load(workspace); }, [visible, workspace, load]);
  if (!visible) return null;
  return <aside className="absolute inset-y-0 right-0 w-[min(480px,94vw)] flex flex-col bg-cb-bg-1 border-l border-cb-line-1" style={{ zIndex: "var(--cb-z-panel)" }}>
    <header className="h-cell-lg px-3 flex items-center gap-2 border-b border-cb-line-0"><FileCode2 size={13} className="text-cb-accent"/><span className="text-xs flex-1">spec kit</span><button onClick={toggle} aria-label="Fechar"><X size={14}/></button></header>
    {!workspace ? <p className="p-4 text-xs text-cb-fg-3">Abra um workspace para criar uma especificação.</p> : <>
      <form className="p-3 border-b border-cb-line-0 space-y-2" onSubmit={async (event) => { event.preventDefault(); if (await create(workspace, title, description)) { setTitle(""); setDescription(""); } }}>
        <div className="cb-label">nova feature</div>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: autenticação offline" className="w-full bg-cb-bg-0 border border-cb-line-1 rounded-cb-1 px-2 h-cell text-xs outline-none focus:border-cb-accent" />
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Problema e resultado esperado" rows={3} className="w-full resize-none bg-cb-bg-0 border border-cb-line-1 rounded-cb-1 px-2 py-1.5 text-xs outline-none focus:border-cb-accent" />
        <button disabled={!title.trim() || loading} className="flex items-center gap-1 bg-cb-accent text-cb-bg-0 px-3 h-cell rounded-cb-1 text-xs disabled:opacity-40"><Plus size={12}/> criar spec → plan → tasks</button>
        {error && <p className="text-2xs text-cb-danger">{error}</p>}
      </form>
      <div className="cb-scroll flex-1 overflow-auto p-2 space-y-2">{specs.length === 0 && !loading && <p className="p-4 text-xs text-cb-fg-3 text-center">Nenhuma spec neste workspace.</p>}{specs.map((spec) => <section key={spec.id} className="border border-cb-line-1 rounded-cb-1 bg-cb-bg-0">
        <div className="px-3 py-2 border-b border-cb-line-0"><div className="text-xs text-cb-fg-0">{spec.title}</div><div className="text-2xs text-cb-fg-3">{spec.id}</div></div>
        <div className="flex">{spec.files.map((file, index) => <button key={file.name} onClick={() => void window.codeBrainApp.spec.open({ workspace, id: spec.id, file: file.name })} className={`flex-1 py-2 text-2xs hover:text-cb-accent ${index ? "border-l border-cb-line-0" : ""}`}><span className={file.exists ? "text-cb-success" : "text-cb-danger"}>{file.exists ? "●" : "○"}</span> {file.name}</button>)}</div>
      </section>)}</div>
    </>}
  </aside>;
}
