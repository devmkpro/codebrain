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

  return <div className="flex items-stretch bg-cb-bg-1 border-b border-cb-line-0 shrink-0 overflow-x-auto scrollbar-none" style={{ WebkitAppRegion: "drag" }}>
    {/* ── Brand / Home ─────────────────────────────────────── */}
    <button className={`shrink-0 px-3 flex items-center gap-2 border-r border-cb-line-0 transition-all focus:outline-none group ${onHome ? "bg-cb-accent-wash" : "hover:bg-cb-bg-2"}`} style={{ WebkitAppRegion: "no-drag", minWidth: 116 }} onClick={goHome} title="CodeBrain Home">
      <Logo size={15} />
      <span className={`font-mono text-xs font-bold tracking-[0.2em] transition-colors ${onHome ? "text-cb-accent" : "text-cb-fg-2 group-hover:text-cb-accent"}`}>CODEBRAIN</span>
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
          className={`group relative flex items-center gap-1.5 px-3.5 cursor-pointer shrink min-w-0 border-r border-cb-line-0 transition-all select-none ${isActive ? "text-cb-fg-0 bg-cb-accent-wash after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-gradient-to-r after:from-indigo-500 after:to-violet-500" : isMissing ? "text-cb-fg-2 hover:text-cb-fg-1 hover:bg-cb-bg-2" : "text-cb-fg-2 hover:text-cb-fg-0 hover:bg-cb-bg-2"} ${isDragging ? "opacity-40" : ""} ${isDropTarget ? "bg-cb-accent-wash" : ""}`}
          style={{ height: 38 }} onClick={() => setActiveTab(i)} title={tab.workspacePath}>
          <span className="font-mono text-xs font-medium truncate max-w-[130px]">{isMissing ? `${label} ×` : label}</span>
          <button className="cb-btn shrink-0 justify-center" onClick={e => { e.stopPropagation(); closeTab(i); }} title={`Fechar ${label}`}>
            <X$1 size={10} strokeWidth={1.5} />
          </button>
        </div>;
      })}
    </div>

    <div className="flex-1" />

    {/* ── Right toolbar ────────────────────────────────────── */}
    <div className="flex items-stretch shrink-0" style={{ WebkitAppRegion: "no-drag" }}>
      <button className={`relative px-2.5 flex items-center justify-center transition-all focus:outline-none border-l border-cb-line-0 ${tasksVisible ? "text-cb-accent bg-cb-accent-wash" : "text-cb-fg-2 hover:text-cb-fg-0 hover:bg-cb-bg-2"}`} onClick={toggleTasks} title="Tasks">
        <ListTodo size={14} strokeWidth={1.5} />
        {tasksCount > 0 && <span className="absolute top-1.5 right-1 font-mono text-[7px] font-bold bg-indigo-500 text-cb-fg-0 rounded-full min-w-[13px] h-[13px] flex items-center justify-center px-0.5">{tasksCount > 9 ? "9+" : tasksCount}</span>}
      </button>

      {activeWorkspace && <button className={`px-2.5 flex items-center justify-center border-l border-cb-line-0 transition-all focus:outline-none ${isMapView ? "text-cb-accent bg-cb-accent-wash" : "text-cb-fg-2 hover:text-cb-fg-0 hover:bg-cb-bg-2"}`} onClick={toggleMap} title="Session Map"><Activity size={14} strokeWidth={1.5} /></button>}
      {activeWorkspace && <button className={`px-2.5 flex items-center justify-center border-l border-cb-line-0 transition-all focus:outline-none ${isFilesView ? "text-cb-accent bg-cb-accent-wash" : "text-cb-fg-2 hover:text-cb-fg-0 hover:bg-cb-bg-2"}`} onClick={toggleFiles} title="Files"><FolderOpen size={14} strokeWidth={1.5} /></button>}
      {activeWorkspace && <button className={`px-2.5 flex items-center justify-center border-l border-cb-line-0 transition-all focus:outline-none ${snapshotBusy ? "text-cb-fg-2 cursor-wait" : "text-cb-fg-2 hover:text-cb-success hover:bg-cb-success-wash"}`} onClick={handleSaveSnapshot} disabled={snapshotBusy} title="Save session"><Save size={14} strokeWidth={1.5} /></button>}
      {activeWorkspace && <button className={`px-2.5 flex items-center justify-center border-l border-cb-line-0 transition-all focus:outline-none ${snapshotBusy ? "text-cb-fg-2 cursor-wait" : "text-cb-fg-2 hover:text-cb-accent hover:bg-cb-accent-wash"}`} onClick={handleRestoreSnapshot} disabled={snapshotBusy} title="Restore session"><RotateCcw size={14} strokeWidth={1.5} /></button>}

      {/* Voice */}
      {activeWorkspace && audioConfig && <div className={`flex items-stretch border-l border-cb-line-0 ${audioModeBusy ? "opacity-60" : ""}`}>
        <React.Fragment>
          <div className={`flex items-center gap-1.5 px-2.5 border-r border-cb-line-0 transition-colors duration-200 ${voiceStats.phase === "error" ? "text-cb-accent bg-cb-accent-wash" : voiceStats.phase === "listening" ? "text-cb-info bg-cb-info-wash" : voiceStats.phase === "transcribing" ? "text-cb-warn bg-cb-warn-wash" : "text-cb-fg-2"}`} title={voiceStats.error ?? "BrainVoice — volume"}>
            <div className="flex items-end gap-[2px] h-3 w-8" aria-hidden="true">
              {voiceStats.levels.slice(-8).map((level: number, i: number) => <span key={i} className={`w-[2px] rounded-full transition-all duration-75 ${voiceStats.phase === "error" ? "bg-cb-danger/70" : voiceStats.phase === "listening" ? "bg-cyan-400/70" : "bg-gray-700"}`} style={{ height: `${Math.max(2, Math.round(level * 12))}px` }} />)}
            </div>
          </div>
          {voiceCancelable && <button className="px-2 flex items-center justify-center text-cb-accent bg-cb-accent-wash hover:bg-cb-accent-wash transition-all focus:outline-none border-r border-cb-line-0" onClick={requestVoiceCancel} title="Cancelar BrainVoice"><X$1 size={11} strokeWidth={1.7} /></button>}
          <button className="cb-btn" onClick={toggleVoiceInteractionMode} title={normalizedVoiceMode(audioConfig.interactionMode) === "coding" ? "Modo coding. Clique para CHAT." : "Modo conversa. Clique para CODE."}>
            <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${normalizedVoiceMode(audioConfig.interactionMode) === "coding" ? "bg-cb-danger" : "bg-indigo-500"}`} />
            {normalizedVoiceMode(audioConfig.interactionMode) === "coding" ? "CODE" : "CHAT"}
          </button>
        </React.Fragment>
      </div>}

      {/* Pane menu */}
      {activeWorkspace && <div ref={paneMenuRef} className="border-l border-cb-line-0">
        <button className="cb-btn" onClick={() => setShowPaneMenu(v => !v)} title="Novo pane ou restaurar">
          <Plus size={11} strokeWidth={2.5} />
          <span className="tracking-widest">PANE</span>
        </button>
        {showPaneMenu && <div className="fixed top-[39px] right-2 w-72 max-h-[calc(100vh-60px)] bg-cb-overlay border border-cb-line-0 rounded-cb-1 shadow-2xl z-[10000] overflow-y-auto overflow-x-hidden">
          <p className="px-3 pt-1.5 pb-0.5 font-mono text-xs text-cb-fg-2 ">Mode</p>
          <div className="flex gap-1 px-3 pb-2">
            {[{ id: "bypassPermissions", label: "Danger", color: "red" }, { id: "auto", label: "Auto", color: "green" }, { id: "default", label: "Pend", color: "gray" }, { id: "plan", label: "Plan", color: "blue" }].map(m => {
              const active = permissionMode === m.id;
              const tone = m.color === "red" ? active ? "bg-rose-500/20 text-rose-300 border-rose-500/40" : "border-white/10 text-gray-500 hover:text-rose-400" : m.color === "green" ? active ? "bg-green-500/20 text-green-300 border-green-500/40" : "border-white/10 text-gray-500 hover:text-green-400" : m.color === "blue" ? active ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/40" : "border-white/10 text-gray-500 hover:text-indigo-400" : active ? "bg-white/10 text-gray-200 border-white/20" : "border-white/10 text-gray-500 hover:text-gray-300";
              return <button key={m.id} onClick={() => setPermissionMode(m.id)} className={`flex-1 px-1.5 py-1 rounded-cb-1 border font-mono text-xs font-medium ${tone}`}>{m.label}</button>;
            })}
          </div>
          <p className="px-3 pt-1.5 pb-0.5 font-mono text-xs text-cb-fg-2 border-t border-cb-line-0">Tipo</p>
          <button className="cb-btn w-full" onClick={() => { setShowPaneMenu(false); handleAddTerminal(isFilesView, isMapView); }}>Terminal</button>
          <button className={`w-full text-left px-3 py-1.5 font-mono text-xs transition-all border-b border-cb-line-0 ${detectedUrl ? "text-cb-accent hover:text-cb-accent hover:bg-cb-accent-wash" : "text-cb-fg-1 hover:text-cb-fg-0 hover:bg-cb-bg-2"}`} onClick={() => { setShowPaneMenu(false); handleAddBrowser(isFilesView, isMapView); }}>
            Browser {detectedUrl && <span className="text-xs text-cb-accent ml-1 truncate">{detectedUrl}</span>}
          </button>
          <p className="px-3 pt-1.5 pb-0.5 font-mono text-xs text-cb-fg-2 ">Novo pane</p>
          {providers.map(p => {
            const pid = p.id;
            const models = p.models ?? [];
            const hostLabel = "OpenClaude";
            const mix = p.id === "claude-oauth" ? hostLabel : `${hostLabel} ← ${p.label}`;
            return <div key={p.id} className="border-b border-cb-line-0">
              <div className="px-3 pt-1.5 pb-0.5 flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-cb-accent ">{mix}</span>
                <span className="font-mono text-xs text-cb-fg-2">{p.type === "oauth" ? "OAuth" : p.type === "anthropic-compat" ? "Anthropic-compat" : p.type === "openai-compat" ? "OpenAI-compat" : "custom"}</span>
              </div>
              {models.length === 0 ? <button className="cb-btn w-full" onClick={() => handleNewPaneWithProvider(pid)}>+ default</button> : models.map((m: string) => <button key={m} className="cb-btn w-full" onClick={() => handleNewPaneWithProvider(pid, m)}>+ {m}</button>)}
            </div>;
          })}
          <button className="cb-btn w-full" onClick={() => { setShowPaneMenu(false); setProvidersInitialStep("pickTemplate"); setShowProvidersModal(true); }}>⚙ Configurar providers…</button>
          <p className="px-3 pt-1.5 pb-0.5 font-mono text-xs text-cb-fg-2 border-t border-cb-line-0">Sessão</p>
          <button className={`w-full text-left px-3 py-1.5 font-mono text-xs transition-all border-b border-cb-line-0 ${snapshotBusy ? "text-cb-fg-2 cursor-wait" : "text-cb-fg-1 hover:text-cb-fg-0 hover:bg-cb-bg-2"}`} onClick={handleSaveSnapshot} disabled={snapshotBusy}>{snapshotBusy ? "Salvando…" : "Salvar Sessão"}</button>
          <button className={`w-full text-left px-3 py-1.5 font-mono text-xs transition-all border-b border-cb-line-0 ${snapshotBusy ? "text-cb-fg-2 cursor-wait" : "text-cb-fg-1 hover:text-cb-fg-0 hover:bg-cb-bg-2"}`} onClick={handleRestoreSnapshot} disabled={snapshotBusy}>{snapshotBusy ? "Restaurando…" : "Restaurar Sessão"}</button>
          {savedPanes.length > 0 && <React.Fragment>
            <p className="px-3 pt-1.5 pb-0.5 font-mono text-xs text-cb-fg-2 ">Restaurar</p>
            <div className="max-h-72 overflow-y-auto">
              {savedPanes.map((p: any) => {
                const preview = p.summary || "(sem mensagens ainda)";
                const ago = new Date(p.savedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
                return <button key={p.id} className="w-full text-left px-3 py-1 hover:bg-cb-bg-2 transition-all" onClick={() => handleRestorePane(p)} title={`${p.session?.confidence === "high" ? "Resume conversation" : "Reopen pane (new session)"} ${p.id}`}>
                  <div className="flex items-center justify-between gap-2 leading-tight">
                    <span className="font-mono text-xs truncate flex-1 text-cb-fg-1">{preview}</span>
                    <span className="font-mono text-xs text-cb-fg-2 shrink-0">{ago}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 leading-tight">
                    <span className="font-mono text-xs text-cb-fg-2">{p.agent}:{p.id}</span>
                    <span className="font-mono text-xs text-cb-fg-2 truncate">{p.session?.confidence === "high" ? "Resume conversation" : "Reopen pane (new session)"}</span>
                  </div>
                  <div className="flex items-center justify-end leading-tight">
                    {p.session ? <span className="font-mono text-xs text-cb-accent truncate">{p.session.provider}:{p.session.id.slice(0, 8)}</span> : <span className="font-mono text-xs text-cb-fg-2 truncate">fresh</span>}
                  </div>
                </button>;
              })}
            </div>
          </React.Fragment>}
        </div>}
      </div>}

      {/* Account */}
      <div ref={accountRef} className="border-l border-cb-line-0">
        <button className="h-full px-2.5 flex items-center gap-1.5 text-cb-fg-2 hover:text-cb-fg-0 hover:bg-cb-bg-2 transition-all focus:outline-none" style={{ WebkitAppRegion: "no-drag" }} onClick={() => setShowAccount(v => !v)} title="Conta">
          <div className="w-6 h-6 rounded-full bg-cb-accent-wash border border-cb-accent-dim flex items-center justify-center">
            <span className="font-mono text-xs font-bold text-cb-accent">{authEmail?.slice(0, 1).toUpperCase() ?? "?"}</span>
          </div>
        </button>
        {showAccount && <div className="fixed top-[39px] right-2 w-64 bg-cb-overlay border border-cb-line-0 rounded-cb-1 shadow-2xl z-[10000] overflow-hidden">
          <div className="px-3 py-2.5 border-b border-cb-line-0">
            <p className="cb-label block mb-0.5">Conta</p>
            <p className="font-mono text-sm text-cb-fg-1 truncate">{authEmail}</p>
          </div>
          <div className="px-3 py-2.5 border-b border-cb-line-0 space-y-1">
            <p className="cb-label block">Assinatura</p>
            {profile === null ? <p className="font-mono text-sm text-cb-fg-2 animate-pulse">carregando…</p> : profile.plan ? <React.Fragment>
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm text-cb-fg-1 capitalize">{profile.plan}</span>
                <span className={`font-mono text-xs px-1.5 py-0.5 rounded-cb-1 ${profile.status === "active" || profile.status === "trialing" ? "text-cb-success bg-cb-success-wash border border-cb-success" : "text-cb-warn bg-cb-warn-wash border border-cb-warn"}`}>{profile.status ?? "—"}</span>
              </div>
              {profile.periodEnd && <p className="font-mono text-xs text-cb-fg-2">renova {new Date(profile.periodEnd).toLocaleDateString("pt-BR")}</p>}
            </React.Fragment> : <p className="font-mono text-sm text-cb-warn">sem plano ativo</p>}
          </div>
          <button className="cb-btn w-full" onClick={() => { setShowAccount(false); window.codeBrainApp?.auth?.openBilling?.(); }}>Gerenciar assinatura →</button>
          {activeWorkspace && <button className="cb-btn w-full" onClick={() => { setShowAccount(false); setShowSquadModal(true); }}><span className="text-cb-accent">+</span> Squad</button>}
          <button className="cb-btn w-full" onClick={() => { setShowAccount(false); setProvidersInitialStep("pickTemplate"); setShowProvidersModal(true); }}><Settings size={12} strokeWidth={1.5} /> Providers</button>
          <button className="cb-btn w-full" onClick={() => { setShowAccount(false); goHome(); navigate('/settings'); }}><Settings size={12} strokeWidth={1.5} /> Configurações</button>
          <button className="cb-btn w-full" onClick={() => { setShowAccount(false); setShowDiagnosticsModal(true); }}><Activity size={12} strokeWidth={1.5} /> Diagnostico</button>
          <button className="cb-btn w-full" onClick={() => { setShowAccount(false); window.codeBrainApp?.auth?.logout?.(); }}>Sair</button>
        </div>}
      </div>
    </div>

    <ProvidersModal open={showProvidersModal} initialStep={providersInitialStep} onClose={() => { setShowProvidersModal(false); setProvidersInitialStep("list"); }} />
    <SquadModal open={showSquadModal} onClose={() => setShowSquadModal(false)} onSpawn={handleSpawnSquad} />
    <DiagnosticsModal open={showDiagnosticsModal} activeWorkspace={activeWorkspace} onClose={() => setShowDiagnosticsModal(false)} />
  </div>;
}
