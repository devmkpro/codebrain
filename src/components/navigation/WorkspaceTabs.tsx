import React from "react";

import { useNavStore } from "../../stores/nav-store";
import { usePanesStore } from "../../stores/panes-store";
import { useAuthStore } from "../../stores/auth-store";
import { useProvidersStore, House, X$1, ListTodo, Settings, Activity, FolderOpen, Save, RotateCcw, Plus } from "../../stores/providers-store";
import { Logo } from "../auth/Logo";
import { useTasksStore, tabLabel, normalizedVoiceMode } from "../../stores/tasks-store";
import { useVoiceStore } from "../../stores/voice-store";
import { ProvidersModal } from "../providers/ProvidersModal";
import { SquadModal } from "../squads/SquadModal";
import { useRouter } from "../../lib/router";
import { DiagnosticsModal } from "../diagnostics/DiagnosticsModal";

import { useSpawnPane } from "../../hooks/useSpawnPane";
import { useSessionActions } from "../../hooks/useSessionActions";
import { useAudioConfig } from "../../hooks/useAudioConfig";
import { useClickOutside } from "../../hooks/useWorkspaceConfig";

export function WorkspaceTabs() {
  const tabs = useNavStore(s => s.tabs);
  const activeTabIndex = useNavStore(s => s.activeTabIndex);
  const onHome = useNavStore(s => s.onHome);
  const setActiveTab = useNavStore(s => s.setActiveTab);
  const moveTab = useNavStore(s => s.moveTab);
  const closeTab = useNavStore(s => s.closeTab);
  const goHome = useNavStore(s => s.goHome);
  const navigateInActiveTab = useNavStore(s => s.navigateInActiveTab);
  const addPane = usePanesStore(s => s.addPane);
  const authEmail = useAuthStore(s => s.email);
  const providers = useProvidersStore(s => s.providers);
  const loadProviders = useProvidersStore(s => s.load);
  const tasksVisible = useTasksStore(s => s.visible);
  const tasksCount = useTasksStore(s => s.list.length);
  const toggleTasks = useTasksStore(s => s.toggle);
  const voiceStats = useVoiceStore(s => s.stats);
  const requestVoiceCancel = useVoiceStore(s => s.requestCancel);

  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const [dropIndex, setDropIndex] = React.useState<number | null>(null);
  const [showAccount, setShowAccount] = React.useState(false);
  const [profile, setProfile] = React.useState<any>(null);
  const accountRef = React.useRef<HTMLDivElement>(null);
  const [showPaneMenu, setShowPaneMenu] = React.useState(false);
  const paneMenuRef = React.useRef<HTMLDivElement>(null);
  const [showProvidersModal, setShowProvidersModal] = React.useState(false);
  const [providersInitialStep, setProvidersInitialStep] = React.useState("list");
  const [showSquadModal, setShowSquadModal] = React.useState(false);
  const [showDiagnosticsModal, setShowDiagnosticsModal] = React.useState(false);

  const { navigate } = useRouter();
  const activeTab = !onHome ? tabs[activeTabIndex] : undefined;
  const activeWorkspace = activeTab?.workspacePath;
  const isMapView = activeTab?.view.kind === "map";
  const isFilesView = activeTab?.view.kind === "files";
  const voiceCancelable = voiceStats.visible || voiceStats.phase !== "idle" || voiceStats.chunksPending > 0;

  // Hooks
  const { permissionMode, setPermissionMode, handleAddPane, handleAddTerminal, handleAddBrowser, handleSpawnSquad, detectedUrl } = useSpawnPane(activeWorkspace);
  const { snapshotBusy, savedPanes, loadSavedPanes, handleSaveSnapshot, handleRestoreSnapshot, handleRestorePane } = useSessionActions(activeWorkspace, permissionMode, addPane);
  const { audioConfig, audioModeBusy, toggleVoiceInteractionMode } = useAudioConfig();

  useClickOutside(accountRef, showAccount, () => setShowAccount(false));
  useClickOutside(paneMenuRef, showPaneMenu, () => setShowPaneMenu(false));

  React.useEffect(() => { loadProviders(); }, [loadProviders]);
  React.useEffect(() => {
    if (!showAccount) return;
    window.codeBrainApp?.auth?.profile?.().then((p: any) => {
      setProfile({ plan: p.plan, status: p.status, periodEnd: p.periodEnd });
    }).catch(() => {});
  }, [showAccount]);
  React.useEffect(() => {
    if (showPaneMenu) loadSavedPanes();
  }, [showPaneMenu, loadSavedPanes]);

  const toggleMap = () => navigateInActiveTab(isMapView ? { kind: "workspace" } : { kind: "map" });
  const toggleFiles = () => navigateInActiveTab(isFilesView ? { kind: "workspace" } : { kind: "files" });

  const handleNewPaneWithProvider = (providerId?: string, model?: string) => {
    setShowPaneMenu(false);
    handleAddPane(providerId, model);
  };

  return <div className="flex items-stretch bg-[#040408] border-b border-white/[0.06] shrink-0 overflow-x-auto scrollbar-none" style={{ WebkitAppRegion: "drag" }}>
    {/* ── Brand / Home ─────────────────────────────────────── */}
    <button className={`shrink-0 px-3 flex items-center gap-2 border-r border-white/[0.06] transition-all focus:outline-none group ${onHome ? "bg-indigo-500/[0.05]" : "hover:bg-white/[0.02]"}`} style={{ WebkitAppRegion: "no-drag", minWidth: 116 }} onClick={goHome} title="CodeBrain Home">
      <Logo size={15} />
      <span className={`font-mono text-[9px] font-bold tracking-[0.2em] transition-colors ${onHome ? "text-indigo-400" : "text-gray-600 group-hover:text-indigo-300"}`}>CODEBRAIN</span>
    </button>

    {/* ── Tabs ─────────────────────────────────────────────── */}
    <div className="flex items-stretch min-w-0" style={{ WebkitAppRegion: "no-drag" }}>
      {tabs.map((tab, i) => {
        const isActive = !onHome && i === activeTabIndex;
        const label = tabLabel(tab);
        const isMissing = tab.missing === true;
        const isDragging = dragIndex === i;
        const isDropTarget = dropIndex === i && dragIndex !== null && dragIndex !== i;
        return <div key={tab.id ?? i} draggable
          onDragStart={e => { setDragIndex(i); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); }}
          onDragOver={e => { if (dragIndex === null) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dropIndex !== i) setDropIndex(i); }}
          onDragLeave={() => { if (dropIndex === i) setDropIndex(null); }}
          onDrop={e => { e.preventDefault(); if (dragIndex !== null && dragIndex !== i) moveTab(dragIndex, i); setDragIndex(null); setDropIndex(null); }}
          onDragEnd={() => { setDragIndex(null); setDropIndex(null); }}
          className={`group relative flex items-center gap-1.5 px-3.5 cursor-pointer shrink min-w-0 border-r border-white/[0.06] transition-all select-none ${isActive ? "text-gray-100 bg-indigo-500/[0.04] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-gradient-to-r after:from-indigo-500 after:to-violet-500" : isMissing ? "text-gray-700 hover:text-gray-600 hover:bg-white/[0.01]" : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.02]"} ${isDragging ? "opacity-40" : ""} ${isDropTarget ? "bg-indigo-500/10" : ""}`}
          style={{ height: 38 }} onClick={() => setActiveTab(i)} title={tab.workspacePath}>
          <span className="font-mono text-[10px] font-medium truncate max-w-[130px]">{isMissing ? `${label} ×` : label}</span>
          <button className="shrink-0 ml-0.5 w-3.5 h-3.5 rounded flex items-center justify-center transition-all focus:outline-none opacity-0 group-hover:opacity-50 hover:!opacity-100 hover:bg-white/10 text-gray-600 hover:text-gray-200" onClick={e => { e.stopPropagation(); closeTab(i); }} title={`Fechar ${label}`}>
            <X$1 size={10} strokeWidth={1.5} />
          </button>
        </div>;
      })}
    </div>

    <div className="flex-1" />

    {/* ── Right toolbar ────────────────────────────────────── */}
    <div className="flex items-stretch shrink-0" style={{ WebkitAppRegion: "no-drag" }}>
      <button className={`relative px-2.5 flex items-center justify-center transition-all focus:outline-none border-l border-white/[0.06] ${tasksVisible ? "text-indigo-400 bg-indigo-500/10" : "text-gray-600 hover:text-gray-300 hover:bg-white/[0.02]"}`} onClick={toggleTasks} title="Tasks">
        <ListTodo size={14} strokeWidth={1.5} />
        {tasksCount > 0 && <span className="absolute top-1.5 right-1 font-mono text-[7px] font-bold bg-indigo-500 text-white rounded-full min-w-[13px] h-[13px] flex items-center justify-center px-0.5">{tasksCount > 9 ? "9+" : tasksCount}</span>}
      </button>

      {activeWorkspace && <button className={`px-2.5 flex items-center justify-center border-l border-white/[0.06] transition-all focus:outline-none ${isMapView ? "text-indigo-400 bg-indigo-500/10" : "text-gray-600 hover:text-gray-300 hover:bg-white/[0.02]"}`} onClick={toggleMap} title="Session Map"><Activity size={14} strokeWidth={1.5} /></button>}
      {activeWorkspace && <button className={`px-2.5 flex items-center justify-center border-l border-white/[0.06] transition-all focus:outline-none ${isFilesView ? "text-indigo-400 bg-indigo-500/10" : "text-gray-600 hover:text-gray-300 hover:bg-white/[0.02]"}`} onClick={toggleFiles} title="Files"><FolderOpen size={14} strokeWidth={1.5} /></button>}
      {activeWorkspace && <button className={`px-2.5 flex items-center justify-center border-l border-white/[0.06] transition-all focus:outline-none ${snapshotBusy ? "text-gray-700 cursor-wait" : "text-gray-600 hover:text-emerald-400 hover:bg-emerald-500/5"}`} onClick={handleSaveSnapshot} disabled={snapshotBusy} title="Save session"><Save size={14} strokeWidth={1.5} /></button>}
      {activeWorkspace && <button className={`px-2.5 flex items-center justify-center border-l border-white/[0.06] transition-all focus:outline-none ${snapshotBusy ? "text-gray-700 cursor-wait" : "text-gray-600 hover:text-violet-400 hover:bg-violet-500/5"}`} onClick={handleRestoreSnapshot} disabled={snapshotBusy} title="Restore session"><RotateCcw size={14} strokeWidth={1.5} /></button>}

      {/* Voice */}
      {activeWorkspace && audioConfig && <div className={`flex items-stretch border-l border-white/[0.06] ${audioModeBusy ? "opacity-60" : ""}`}>
        <React.Fragment>
          <div className={`flex items-center gap-1.5 px-2.5 border-r border-white/[0.06] transition-colors duration-200 ${voiceStats.phase === "error" ? "text-indigo-300 bg-indigo-500/10" : voiceStats.phase === "listening" ? "text-cyan-300 bg-cyan-500/10" : voiceStats.phase === "transcribing" ? "text-yellow-300 bg-yellow-500/10" : "text-gray-600"}`} title={voiceStats.error ?? "BrainVoice — volume"}>
            <div className="flex items-end gap-[2px] h-3 w-8" aria-hidden="true">
              {voiceStats.levels.slice(-8).map((level: number, i: number) => <span key={i} className={`w-[2px] rounded-full transition-all duration-75 ${voiceStats.phase === "error" ? "bg-red-400/70" : voiceStats.phase === "listening" ? "bg-cyan-400/70" : "bg-gray-700"}`} style={{ height: `${Math.max(2, Math.round(level * 12))}px` }} />)}
            </div>
          </div>
          {voiceCancelable && <button className="px-2 flex items-center justify-center text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/15 transition-all focus:outline-none border-r border-white/[0.06]" onClick={requestVoiceCancel} title="Cancelar BrainVoice"><X$1 size={11} strokeWidth={1.7} /></button>}
          <button className="px-3 flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-widest transition-all duration-200 focus:outline-none text-gray-500 hover:text-white hover:bg-white/5" onClick={toggleVoiceInteractionMode} title={normalizedVoiceMode(audioConfig.interactionMode) === "coding" ? "Modo coding. Clique para CHAT." : "Modo conversa. Clique para CODE."}>
            <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${normalizedVoiceMode(audioConfig.interactionMode) === "coding" ? "bg-red-500" : "bg-indigo-500"}`} />
            {normalizedVoiceMode(audioConfig.interactionMode) === "coding" ? "CODE" : "CHAT"}
          </button>
        </React.Fragment>
      </div>}

      {/* Pane menu */}
      {activeWorkspace && <div ref={paneMenuRef} className="border-l border-white/[0.06]">
        <button className="h-full px-3 flex items-center gap-1.5 font-mono text-[10px] font-bold text-indigo-400/70 hover:text-indigo-300 hover:bg-indigo-500/[0.06] transition-all focus:outline-none" onClick={() => setShowPaneMenu(v => !v)} title="Novo pane ou restaurar">
          <Plus size={11} strokeWidth={2.5} />
          <span className="tracking-widest">PANE</span>
        </button>
        {showPaneMenu && <div className="fixed top-[39px] right-2 w-72 max-h-[calc(100vh-60px)] bg-[#0c0c14] border border-white/[0.08] rounded-xl shadow-2xl z-[10000] overflow-y-auto overflow-x-hidden">
          <p className="px-3 pt-1.5 pb-0.5 font-mono text-[9px] text-gray-600 uppercase tracking-widest">Mode</p>
          <div className="flex gap-1 px-3 pb-2">
            {[{ id: "bypassPermissions", label: "Danger", color: "red" }, { id: "auto", label: "Auto", color: "green" }, { id: "default", label: "Pend", color: "gray" }, { id: "plan", label: "Plan", color: "blue" }].map(m => {
              const active = permissionMode === m.id;
              const tone = m.color === "red" ? active ? "bg-rose-500/20 text-rose-300 border-rose-500/40" : "border-white/10 text-gray-500 hover:text-rose-400" : m.color === "green" ? active ? "bg-green-500/20 text-green-300 border-green-500/40" : "border-white/10 text-gray-500 hover:text-green-400" : m.color === "blue" ? active ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/40" : "border-white/10 text-gray-500 hover:text-indigo-400" : active ? "bg-white/10 text-gray-200 border-white/20" : "border-white/10 text-gray-500 hover:text-gray-300";
              return <button key={m.id} onClick={() => setPermissionMode(m.id)} className={`flex-1 px-1.5 py-1 rounded border font-mono text-[9px] font-bold uppercase tracking-wider ${tone}`}>{m.label}</button>;
            })}
          </div>
          <p className="px-3 pt-1.5 pb-0.5 font-mono text-[9px] text-gray-600 uppercase tracking-widest border-t border-white/5">Tipo</p>
          <button className="w-full text-left px-3 py-1.5 font-mono text-[10px] transition-all border-b border-white/5 text-gray-300 hover:text-gray-200 hover:bg-white/5" onClick={() => { setShowPaneMenu(false); handleAddTerminal(isFilesView, isMapView); }}>Terminal</button>
          <button className={`w-full text-left px-3 py-1.5 font-mono text-[10px] transition-all border-b border-white/5 ${detectedUrl ? "text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10" : "text-gray-300 hover:text-gray-200 hover:bg-white/5"}`} onClick={() => { setShowPaneMenu(false); handleAddBrowser(isFilesView, isMapView); }}>
            Browser {detectedUrl && <span className="text-[9px] text-indigo-500/60 ml-1 truncate">{detectedUrl}</span>}
          </button>
          <p className="px-3 pt-1.5 pb-0.5 font-mono text-[9px] text-gray-600 uppercase tracking-widest">Novo pane</p>
          {providers.map(p => {
            const pid = p.id;
            const models = p.models ?? [];
            const hostLabel = "OpenClaude";
            const mix = p.id === "claude-oauth" ? hostLabel : `${hostLabel} ← ${p.label}`;
            return <div key={p.id} className="border-b border-white/5">
              <div className="px-3 pt-1.5 pb-0.5 flex items-center justify-between">
                <span className="font-mono text-[10px] font-bold text-indigo-400 uppercase tracking-widest">{mix}</span>
                <span className="font-mono text-[9px] text-gray-600">{p.type === "oauth" ? "OAuth" : p.type === "anthropic-compat" ? "Anthropic-compat" : p.type === "openai-compat" ? "OpenAI-compat" : "custom"}</span>
              </div>
              {models.length === 0 ? <button className="w-full text-left px-3 py-1 font-mono text-[10px] text-gray-300 hover:text-indigo-300 hover:bg-indigo-500/10" onClick={() => handleNewPaneWithProvider(pid)}>+ default</button> : models.map((m: string) => <button key={m} className="w-full text-left px-5 py-1 font-mono text-[10px] text-gray-300 hover:text-indigo-300 hover:bg-indigo-500/10" onClick={() => handleNewPaneWithProvider(pid, m)}>+ {m}</button>)}
            </div>;
          })}
          <button className="w-full text-left px-3 py-1.5 font-mono text-[10px] text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-all border-b border-white/5" onClick={() => { setShowPaneMenu(false); setProvidersInitialStep("pickTemplate"); setShowProvidersModal(true); }}>⚙ Configurar providers…</button>
          <p className="px-3 pt-1.5 pb-0.5 font-mono text-[9px] text-gray-600 uppercase tracking-widest border-t border-white/5">Sessão</p>
          <button className={`w-full text-left px-3 py-1.5 font-mono text-[10px] transition-all border-b border-white/5 ${snapshotBusy ? "text-gray-600 cursor-wait" : "text-gray-300 hover:text-gray-200 hover:bg-white/5"}`} onClick={handleSaveSnapshot} disabled={snapshotBusy}>{snapshotBusy ? "Salvando…" : "Salvar Sessão"}</button>
          <button className={`w-full text-left px-3 py-1.5 font-mono text-[10px] transition-all border-b border-white/5 ${snapshotBusy ? "text-gray-600 cursor-wait" : "text-gray-300 hover:text-gray-200 hover:bg-white/5"}`} onClick={handleRestoreSnapshot} disabled={snapshotBusy}>{snapshotBusy ? "Restaurando…" : "Restaurar Sessão"}</button>
          {savedPanes.length > 0 && <React.Fragment>
            <p className="px-3 pt-1.5 pb-0.5 font-mono text-[9px] text-gray-600 uppercase tracking-widest">Restaurar</p>
            <div className="max-h-72 overflow-y-auto">
              {savedPanes.map((p: any) => {
                const preview = p.summary || "(sem mensagens ainda)";
                const ago = new Date(p.savedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
                return <button key={p.id} className="w-full text-left px-3 py-1 hover:bg-white/5 transition-all" onClick={() => handleRestorePane(p)} title={`${p.session?.confidence === "high" ? "Resume conversation" : "Reopen pane (new session)"} ${p.id}`}>
                  <div className="flex items-center justify-between gap-2 leading-tight">
                    <span className="font-mono text-[10px] truncate flex-1 text-gray-300">{preview}</span>
                    <span className="font-mono text-[9px] text-gray-600 shrink-0">{ago}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 leading-tight">
                    <span className="font-mono text-[9px] text-gray-600">{p.agent}:{p.id}</span>
                    <span className="font-mono text-[9px] text-gray-600 truncate">{p.session?.confidence === "high" ? "Resume conversation" : "Reopen pane (new session)"}</span>
                  </div>
                  <div className="flex items-center justify-end leading-tight">
                    {p.session ? <span className="font-mono text-[9px] text-indigo-500/60 truncate">{p.session.provider}:{p.session.id.slice(0, 8)}</span> : <span className="font-mono text-[9px] text-gray-700 truncate">fresh</span>}
                  </div>
                </button>;
              })}
            </div>
          </React.Fragment>}
        </div>}
      </div>}

      {/* Account */}
      <div ref={accountRef} className="border-l border-white/[0.06]">
        <button className="h-full px-2.5 flex items-center gap-1.5 text-gray-600 hover:text-gray-300 hover:bg-white/[0.03] transition-all focus:outline-none" style={{ WebkitAppRegion: "no-drag" }} onClick={() => setShowAccount(v => !v)} title="Conta">
          <div className="w-6 h-6 rounded-full bg-indigo-500/20 border border-indigo-500/25 flex items-center justify-center">
            <span className="font-mono text-[9px] font-bold text-indigo-400">{authEmail?.slice(0, 1).toUpperCase() ?? "?"}</span>
          </div>
        </button>
        {showAccount && <div className="fixed top-[39px] right-2 w-64 bg-[#0c0c14] border border-white/[0.08] rounded-xl shadow-2xl z-[10000] overflow-hidden">
          <div className="px-3 py-2.5 border-b border-white/5">
            <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-0.5">Conta</p>
            <p className="font-mono text-[11px] text-gray-300 truncate">{authEmail}</p>
          </div>
          <div className="px-3 py-2.5 border-b border-white/5 space-y-1">
            <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest">Assinatura</p>
            {profile === null ? <p className="font-mono text-[11px] text-gray-600 animate-pulse">carregando…</p> : profile.plan ? <React.Fragment>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] text-gray-300 capitalize">{profile.plan}</span>
                <span className={`font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded ${profile.status === "active" || profile.status === "trialing" ? "text-green-400 bg-green-500/10 border border-green-500/20" : "text-amber-400 bg-amber-500/10 border border-amber-500/20"}`}>{profile.status ?? "—"}</span>
              </div>
              {profile.periodEnd && <p className="font-mono text-[10px] text-gray-600">renova {new Date(profile.periodEnd).toLocaleDateString("pt-BR")}</p>}
            </React.Fragment> : <p className="font-mono text-[11px] text-amber-400">sem plano ativo</p>}
          </div>
          <button className="w-full text-left px-3 py-2.5 font-mono text-[11px] text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-all border-b border-white/5" onClick={() => { setShowAccount(false); window.codeBrainApp?.auth?.openBilling?.(); }}>Gerenciar assinatura →</button>
          {activeWorkspace && <button className="w-full text-left px-3 py-2.5 font-mono text-[11px] text-gray-400 hover:text-indigo-400 hover:bg-indigo-500/5 transition-all border-b border-white/5 flex items-center gap-2" onClick={() => { setShowAccount(false); setShowSquadModal(true); }}><span className="text-indigo-500/70">+</span> Squad</button>}
          <button className="w-full text-left px-3 py-2.5 font-mono text-[11px] text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-all border-b border-white/5 flex items-center gap-2" onClick={() => { setShowAccount(false); setProvidersInitialStep("pickTemplate"); setShowProvidersModal(true); }}><Settings size={12} strokeWidth={1.5} /> Providers</button>
          <button className="w-full text-left px-3 py-2.5 font-mono text-[11px] text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-all border-b border-white/5 flex items-center gap-2" onClick={() => { setShowAccount(false); goHome(); navigate('/settings'); }}><Settings size={12} strokeWidth={1.5} /> Configurações</button>
          <button className="w-full text-left px-3 py-2.5 font-mono text-[11px] text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-all border-b border-white/5 flex items-center gap-2" onClick={() => { setShowAccount(false); setShowDiagnosticsModal(true); }}><Activity size={12} strokeWidth={1.5} /> Diagnostico</button>
          <button className="w-full text-left px-3 py-2.5 font-mono text-[11px] text-gray-500 hover:text-rose-400 hover:bg-rose-500/5 transition-all" onClick={() => { setShowAccount(false); window.codeBrainApp?.auth?.logout?.(); }}>Sair</button>
        </div>}
      </div>
    </div>

    <ProvidersModal open={showProvidersModal} initialStep={providersInitialStep} onClose={() => { setShowProvidersModal(false); setProvidersInitialStep("list"); }} />
    <SquadModal open={showSquadModal} onClose={() => setShowSquadModal(false)} onSpawn={handleSpawnSquad} />
    <DiagnosticsModal open={showDiagnosticsModal} activeWorkspace={activeWorkspace} onClose={() => setShowDiagnosticsModal(false)} />
  </div>;
}
