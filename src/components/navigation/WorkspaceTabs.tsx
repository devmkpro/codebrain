import React from "react";
import { nanoid } from "nanoid";

// WorkspaceTabs
import { useNavStore } from "../../stores/nav-store";
import { usePanesStore } from "../../stores/panes-store";
import { useAuthStore } from "../../stores/auth-store";
import { useProvidersStore, House, X$1, ListTodo, Settings, Activity, FolderOpen, Save, RotateCcw, Plus } from "../../stores/providers-store";
import { Logo } from "../auth/Logo";
import { useTasksStore, tabLabel, outputModeForInteractionMode, normalizedVoiceMode } from "../../stores/tasks-store";
import { useVoiceStore } from "../../stores/voice-store";
import { useBrowserStore } from "../../stores/browser-store";
import { ProvidersModal } from "../providers/ProvidersModal";
import { SquadModal } from "../squads/SquadModal";
import { SettingsModal } from "../settings/SettingsModal";
import { DiagnosticsModal } from "../diagnostics/DiagnosticsModal";
export function WorkspaceTabs() {
  const tabs = useNavStore(s => s.tabs);
  const activeTabIndex = useNavStore(s => s.activeTabIndex);
  const onHome = useNavStore(s => s.onHome);
  const setActiveTab = useNavStore(s => s.setActiveTab);
  const moveTab = useNavStore(s => s.moveTab);
  const closeTab = useNavStore(s => s.closeTab);
  const [dragIndex, setDragIndex] = React.useState(null);
  const [dropIndex, setDropIndex] = React.useState(null);
  const goHome = useNavStore(s => s.goHome);
  const navigateInActiveTab = useNavStore(s => s.navigateInActiveTab);
  const addPane = usePanesStore(s => s.addPane);
  const authEmail = useAuthStore(s => s.email);
  const [showAccount, setShowAccount] = React.useState(false);
  const [profile, setProfile] = React.useState(null);
  const accountRef = React.useRef(null);
  const [showPaneMenu, setShowPaneMenu] = React.useState(false);
  const [savedPanes, setSavedPanes] = React.useState([]);
  const [snapshotBusy, setSnapshotBusy] = React.useState(false);
  const paneMenuRef = React.useRef(null);
  const [showProvidersModal, setShowProvidersModal] = React.useState(false);
  const [providersInitialStep, setProvidersInitialStep] = React.useState("list");
  const [showSquadModal, setShowSquadModal] = React.useState(false);
  const [showSettingsModal, setShowSettingsModal] = React.useState(false);
  const [showDiagnosticsModal, setShowDiagnosticsModal] = React.useState(false);
  const [audioConfig, setAudioConfig] = React.useState(null);
  const [audioModeBusy, setAudioModeBusy] = React.useState(false);
  const providers = useProvidersStore(s => s.providers);
  const loadProviders = useProvidersStore(s => s.load);
  React.useEffect(() => {
    loadProviders();
  }, [loadProviders]);
  const tasksVisible = useTasksStore(s => s.visible);
  const tasksCount = useTasksStore(s => s.list.length);
  const toggleTasks = useTasksStore(s => s.toggle);
  const voiceStats = useVoiceStore(s => s.stats);
  const requestVoiceCancel = useVoiceStore(s => s.requestCancel);
  const activeTab = !onHome ? tabs[activeTabIndex] : void 0;
  const activeWorkspace = activeTab?.workspacePath;
  const isMapView = activeTab?.view.kind === "map";
  const isFilesView = activeTab?.view.kind === "files";
  const detectedUrl = useBrowserStore(s => s.detectedUrl);
  const voiceCancelable = voiceStats.visible || voiceStats.phase !== "idle" || voiceStats.chunksPending > 0;
  const refreshAudioConfig = () => {
    const api = window.codeBrainApp?.audio;
    if (!api) {
      setAudioConfig(null);
      return;
    }
    api.getConfig().then(cfg => setAudioConfig(cfg)).catch(() => setAudioConfig(null));
  };
  React.useEffect(() => {
    refreshAudioConfig();
  }, []);
  React.useEffect(() => {
    if (!showSettingsModal) refreshAudioConfig();
  }, [showSettingsModal]);
  const saveAudioPatch = async patch => {
    if (!audioConfig || audioModeBusy) return;
    setAudioModeBusy(true);
    setAudioConfig(cfg => cfg ? {
      ...cfg,
      ...patch
    } : cfg);
    try {
      const res = await window.codeBrainApp?.audio?.saveConfig(patch);
      if (res?.ok && res.config) setAudioConfig(res.config);else refreshAudioConfig();
    } finally {
      setAudioModeBusy(false);
    }
  };
  const setVoiceInteractionMode = interactionMode => {
    void saveAudioPatch({
      interactionMode,
      outputMode: outputModeForInteractionMode(interactionMode)
    });
  };
  const toggleVoiceInteractionMode = () => {
    const currentMode = normalizedVoiceMode(audioConfig?.interactionMode);
    setVoiceInteractionMode(currentMode === "coding" ? "conversation" : "coding");
  };
  const toggleMap = () => {
    navigateInActiveTab(isMapView ? {
      kind: "workspace"
    } : {
      kind: "map"
    });
  };
  const toggleFiles = () => {
    navigateInActiveTab(isFilesView ? {
      kind: "workspace"
    } : {
      kind: "files"
    });
  };
  const handleAddBrowser = () => {
    if (!activeWorkspace) return;
    if (isFilesView || isMapView) navigateInActiveTab({
      kind: "workspace"
    });
    addPane({
      kind: "browser",
      cwd: activeWorkspace,
      url: detectedUrl ?? "about:blank"
    });
  };
  const handleAddTerminal = () => {
    if (!activeWorkspace) return;
    if (isFilesView || isMapView) navigateInActiveTab({
      kind: "workspace"
    });
    window.codeBrainApp?.pty.spawn({
      agent: "shell",
      cwd: activeWorkspace
    }).then(result => {
      if (!result?.ok || !result.paneId) {
        console.error("[handleAddTerminal] spawn failed:", result?.error);
        window.codeBrainApp?.notify?.("Erro ao abrir terminal", result?.error ?? "spawn retornou erro");
        return;
      }
      addPane({
        id: result.paneId,
        agent: "shell",
        cwd: activeWorkspace,
        workspacePath: activeWorkspace,
        externallySpawned: true
      });
    }).catch(err => {
      console.error("[handleAddTerminal] spawn exception:", err);
      window.codeBrainApp?.notify?.("Erro ao abrir terminal", String(err));
    });
  };
  const [permissionMode, setPermissionMode] = React.useState(() => {
    return localStorage.getItem("codebrain.permissionMode") ?? "bypassPermissions";
  });
  const [favoritePane, setFavoritePane] = React.useState(null);
  React.useEffect(() => {
    localStorage.setItem("codebrain.permissionMode", permissionMode);
  }, [permissionMode]);
  React.useEffect(() => {
    if (!activeWorkspace) {
      setFavoritePane(null);
      return;
    }
    let cancelled = false;
    window.codeBrainApp?.workspaceConfig?.get(activeWorkspace).then(cfg => {
      if (!cancelled) setFavoritePane(cfg?.favoritePane ?? null);
    }).catch(() => {
      if (!cancelled) setFavoritePane(null);
    });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace]);
  const handleAddPane = (providerId, model) => {
    if (!activeWorkspace) return;
    const explicit = providerId !== void 0 || model !== void 0;
    const nextProviderId = explicit ? providerId : favoritePane?.providerId;
    const nextModel = explicit ? model : favoritePane?.model;
    const provider = nextProviderId ? providers.find(p => p.id === nextProviderId) : null;
      const agent = explicit ? provider?.host ?? "openclaude" : favoritePane?.agent ?? provider?.host ?? "openclaude";
    // Only pass non-secret hints in env — backend reads full provider.env via listFull().
    // Passing provider.env from frontend would include masked "********" secrets (listPublic())
    // which would override the real keys in the backend. See: provider-store.ts maskProvider().
    const spawnEnv: Record<string, string> = {
      ...(nextModel ? { ANTHROPIC_MODEL: nextModel, MODEL: nextModel } : {}),
    };
    window.codeBrainApp?.pty.spawn({
      agent,
      cwd: activeWorkspace,
      providerId: nextProviderId,
      model: nextModel,
      permissionMode,
      ...(Object.keys(spawnEnv).length > 0 ? { env: spawnEnv } : {}),
    }).then(result => {
      if (!result?.ok || !result.paneId) {
        console.error("[handleAddPane] spawn failed:", result?.error);
        window.codeBrainApp?.notify?.("Erro ao abrir pane", result?.error ?? "spawn retornou erro");
        return;
      }
      addPane({
        id: result.paneId,
        agent,
        cwd: activeWorkspace,
        workspacePath: activeWorkspace,
        providerId: nextProviderId,
        model: nextModel,
        permissionMode,
        externallySpawned: true
      });
    }).catch(err => {
      console.error("[handleAddPane] spawn exception:", err);
      window.codeBrainApp?.notify?.("Erro ao abrir pane", String(err));
    });
  };
  React.useEffect(() => {
    if (!showAccount) return;
    const handler = e => {
      if (accountRef.current && !accountRef.current.contains(e.target)) {
        setShowAccount(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showAccount]);
  React.useEffect(() => {
    if (!showAccount) return;
    const fn = window.codeBrainApp?.auth?.profile;
    if (!fn) return;
    fn().then(p => {
      setProfile({
        plan: p.plan,
        status: p.status,
        periodEnd: p.periodEnd
      });
    }).catch(() => {});
  }, [showAccount]);
  React.useEffect(() => {
    if (!showPaneMenu) return;
    const handler = e => {
      if (paneMenuRef.current && !paneMenuRef.current.contains(e.target)) {
        setShowPaneMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPaneMenu]);
  React.useEffect(() => {
    if (!showPaneMenu || !activeWorkspace) return;
    const loadSaved = window.codeBrainApp?.session?.loadAll;
    if (!loadSaved) {
      setSavedPanes([]);
      return;
    }
    Promise.all([loadSaved(activeWorkspace).catch(() => []), window.codeBrainApp?.claude?.sessions?.(activeWorkspace).catch(() => []) ?? Promise.resolve([])]).then(([saved, claudeSessions]) => {
      const panes = [];
      for (const session of saved) {
        for (const pane of session.panes) panes.push({
          ...pane,
          savedAt: session.savedAt
        });
      }
      for (const s of claudeSessions) {
        panes.push({
          id: s.paneId ?? s.sessionId,
          agent: "openclaude",
          cwd: s.cwd,
          lastLines: s.summary ? [s.summary] : [],
          session: s.session ?? {
            provider: "claude",
            id: s.sessionId,
            capturedAt: s.savedAt ?? s.lastUsedAt ?? s.firstSeenAt,
            confidence: "high",
            source: "transcript-file"
          },
          claudeSessionId: s.sessionId,
          providerId: s.providerId,
          model: s.model,
          summary: s.summary,
          savedAt: s.savedAt ?? s.lastUsedAt ?? s.firstSeenAt
        });
      }
      const byKey = new Map();
      for (const pane of panes) {
        const session = pane.session ?? (pane.claudeSessionId ? {
          provider: "claude",
          id: pane.claudeSessionId
        } : void 0);
        const key = session ? `${session.provider}:${session.id}` : `${pane.agent}:${pane.id}`;
        const existing = byKey.get(key);
        if (!existing || pane.savedAt > existing.savedAt) byKey.set(key, pane);
      }
      setSavedPanes([...byKey.values()].sort((a, b) => b.savedAt - a.savedAt));
    }).catch(() => setSavedPanes([]));
  }, [showPaneMenu, activeWorkspace]);
  const handleRestorePane = async pane => {
    if (!activeWorkspace) return;
    setShowPaneMenu(false);
    if (pane.session?.confidence === "high") {
      const existing = usePanesStore.getState().panes.find(p => p.session?.provider === pane.session?.provider && p.session?.id === pane.session?.id);
      if (existing) {
        usePanesStore.getState().setActive(existing.id);
        return;
      }
    }
    const restoreProvider = pane.providerId ? providers.find(p => p.id === pane.providerId) : null;
    const restoreEnv: Record<string, string> = {
      ...(restoreProvider?.env ?? {}),
      ...(pane.model ? { ANTHROPIC_MODEL: pane.model, MODEL: pane.model } : {}),
    };
    const result = await window.codeBrainApp?.pty.spawn({
      paneId: pane.id,
      agent: pane.agent,
      cwd: pane.cwd,
      args: pane.args,
      session: pane.session,
      claudeSessionId: pane.claudeSessionId,
      providerId: pane.providerId,
      model: pane.model,
      ...(Object.keys(restoreEnv).length > 0 ? { env: restoreEnv } : {}),
    });
    if (result?.ok && result.paneId) {
      addPane({
        id: result.paneId,
        agent: pane.agent,
        cwd: pane.cwd,
        args: pane.args,
        workspacePath: activeWorkspace,
        session: pane.session,
        claudeSessionId: pane.claudeSessionId,
        lastLines: pane.lastLines,
        providerId: pane.providerId,
        model: pane.model,
        externallySpawned: true
      });
    }
  };
  const handleNewPaneWithProvider = (providerId, model) => {
    setShowPaneMenu(false);
    handleAddPane(providerId, model);
  };
  const handleSaveSnapshot = async () => {
    if (!activeWorkspace || snapshotBusy) return;
    setSnapshotBusy(true);
    try {
      const result = await window.codeBrainApp?.session?.saveSnapshot(activeWorkspace);
      if (result?.ok) {
        window.codeBrainApp?.notify("Sessao salva", "Snapshot salvo com sucesso.");
      }
    } finally {
      setSnapshotBusy(false);
    }
  };
  const handleRestoreSnapshot = async () => {
    if (!activeWorkspace || snapshotBusy) return;
    setSnapshotBusy(true);
    try {
      const result = await window.codeBrainApp?.session?.loadSnapshot(activeWorkspace);
      if (!result?.ok || !result.snapshot) return;
      setShowPaneMenu(false);
      const snapshot = result.snapshot;
      // Spawn orchestrator with session resume context
      const orchResult = await window.codeBrainApp?.pty?.spawn({
        agent: "openclaude",
        cwd: activeWorkspace,
        role: "orchestrator",
        permissionMode,
        sessionContext: snapshot.orchestratorPrompt,
      });
      if (orchResult?.ok && orchResult.paneId) {
        addPane({
          id: orchResult.paneId,
          agent: "openclaude",
          cwd: activeWorkspace,
          workspacePath: activeWorkspace,
          providerId: undefined,
          model: undefined,
          externallySpawned: true,
        });
      }
    } finally {
      setSnapshotBusy(false);
    }
  };
  const resolveValidModel = (providerId: string, requestedModel?: string): string | undefined => {
    const provider = providers.find(p => p.id === providerId);
    if (!provider) return undefined;
    const models = provider.models ?? [];
    if (models.length === 0) return undefined;
    if (requestedModel && models.includes(requestedModel)) return requestedModel;
    return models[0];
  };
  const handleSpawnSquad = async squad => {
    if (!activeWorkspace) return;
    const activityId = nanoid(8);
    // Support both old format (single worker) and new format (workers array)
    const workers = squad.workers ?? (squad.worker ? [squad.worker] : []);
    const workerPaneIds = [];
    // Spawn all workers
    for (const w of workers) {
      const provider = providers.find(p => p.id === w.providerId);
      const agent = w.agent ?? provider?.host ?? "openclaude";
      const validModel = resolveValidModel(w.providerId, w.model);
      const workerResult = await window.codeBrainApp?.pty.spawn({
        agent,
        cwd: activeWorkspace,
        activityId,
        providerId: w.providerId,
        model: validModel,
        permissionMode
      });
      if (!workerResult?.ok || !workerResult.paneId) continue;
      workerPaneIds.push(workerResult.paneId);
      addPane({
        id: workerResult.paneId,
        agent,
        cwd: activeWorkspace,
        workspacePath: activeWorkspace,
        activityId,
        providerId: w.providerId,
        model: validModel,
        externallySpawned: true
      });
    }
    if (workerPaneIds.length === 0) return;
    // Spawn orchestrator with worker IDs
    const orchProvider = providers.find(p => p.id === squad.orchestrator.providerId);
    const orchAgent = squad.orchestrator.agent ?? orchProvider?.host ?? "openclaude";
    const validOrchModel = resolveValidModel(squad.orchestrator.providerId, squad.orchestrator.model);
    const orchResult = await window.codeBrainApp?.pty.spawn({
      agent: orchAgent,
      cwd: activeWorkspace,
      activityId,
      providerId: squad.orchestrator.providerId,
      model: validOrchModel,
      permissionMode,
      env: {
        SQUAD_WORKER_IDS: workerPaneIds.join(","),
        SQUAD_ACTIVITY_ID: activityId
      }
    });
    if (orchResult?.ok && orchResult.paneId) {
      addPane({
        id: orchResult.paneId,
        agent: orchAgent,
        cwd: activeWorkspace,
        workspacePath: activeWorkspace,
        activityId,
        providerId: squad.orchestrator.providerId,
        model: validOrchModel,
        externallySpawned: true
      });
    }
  };
  return <div className="flex items-stretch bg-[#040408] border-b border-white/[0.06] shrink-0 overflow-x-auto scrollbar-none" style={{
    WebkitAppRegion: "drag"
  }}>
      {/* ── Brand / Home ─────────────────────────────────────── */}
      <button className={`shrink-0 px-3 flex items-center gap-2 border-r border-white/[0.06] transition-all focus:outline-none group ${onHome ? "bg-indigo-500/[0.05]" : "hover:bg-white/[0.02]"}`} style={{
      WebkitAppRegion: "no-drag",
      minWidth: 116
    }} onClick={goHome} title="CodeBrain Home">
        <Logo size={15} />
        <span className={`font-mono text-[9px] font-bold tracking-[0.2em] transition-colors ${onHome ? "text-indigo-400" : "text-gray-600 group-hover:text-indigo-300"}`}>
          CODEBRAIN
        </span>
      </button>
      {/* ── Tabs ─────────────────────────────────────────────── */}
      <div className="flex items-stretch min-w-0" style={{
      WebkitAppRegion: "no-drag"
    }}>
        {tabs.map((tab, i) => {
        const isActive = !onHome && i === activeTabIndex;
        const label = tabLabel(tab);
        const isMissing = tab.missing === true;
        const isDragging = dragIndex === i;
        const isDropTarget = dropIndex === i && dragIndex !== null && dragIndex !== i;
        return <div key={tab.id ?? i} draggable onDragStart={e => {
          setDragIndex(i);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(i));
        }} onDragOver={e => {
          if (dragIndex === null) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (dropIndex !== i) setDropIndex(i);
        }} onDragLeave={() => {
          if (dropIndex === i) setDropIndex(null);
        }} onDrop={e => {
          e.preventDefault();
          if (dragIndex !== null && dragIndex !== i) moveTab(dragIndex, i);
          setDragIndex(null);
          setDropIndex(null);
        }} onDragEnd={() => {
          setDragIndex(null);
          setDropIndex(null);
        }} className={`
                group relative flex items-center gap-1.5 px-3.5 cursor-pointer shrink min-w-0
                border-r border-white/[0.06] transition-all select-none
                ${isActive ? "text-gray-100 bg-indigo-500/[0.04] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-gradient-to-r after:from-indigo-500 after:to-violet-500" : isMissing ? "text-gray-700 hover:text-gray-600 hover:bg-white/[0.01]" : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.02]"}
                ${isDragging ? "opacity-40" : ""}
                ${isDropTarget ? "bg-indigo-500/10" : ""}
              `} style={{
          height: 38
        }} onClick={() => setActiveTab(i)} title={tab.workspacePath}>
              <span className="font-mono text-[10px] font-medium truncate max-w-[130px]">
                {isMissing ? `${label} ×` : label}
              </span>
              <button className="shrink-0 ml-0.5 w-3.5 h-3.5 rounded flex items-center justify-center transition-all focus:outline-none opacity-0 group-hover:opacity-50 hover:!opacity-100 hover:bg-white/10 text-gray-600 hover:text-gray-200" onClick={e => {
            e.stopPropagation();
            closeTab(i);
          }} title={`Fechar ${label}`}>
                <X$1 size={10} strokeWidth={1.5} />
              </button>
            </div>;
      })}
      </div>
      <div className="flex-1" />
      {/* ── Right toolbar ────────────────────────────────────── */}
      <div className="flex items-stretch shrink-0" style={{
      WebkitAppRegion: "no-drag"
    }}>
        {/* Tasks — with count badge */}
        <button className={`relative px-2.5 flex items-center justify-center transition-all focus:outline-none border-l border-white/[0.06] ${tasksVisible ? "text-indigo-400 bg-indigo-500/10" : "text-gray-600 hover:text-gray-300 hover:bg-white/[0.02]"}`} onClick={toggleTasks} title="Tasks">
          <ListTodo size={14} strokeWidth={1.5} />
          {tasksCount > 0 && <span className="absolute top-1.5 right-1 font-mono text-[7px] font-bold bg-indigo-500 text-white rounded-full min-w-[13px] h-[13px] flex items-center justify-center px-0.5">
            {tasksCount > 9 ? "9+" : tasksCount}
          </span>}
        </button>
        {/* Map — Activity icon */}
        {activeWorkspace && <button className={`px-2.5 flex items-center justify-center border-l border-white/[0.06] transition-all focus:outline-none ${isMapView ? "text-indigo-400 bg-indigo-500/10" : "text-gray-600 hover:text-gray-300 hover:bg-white/[0.02]"}`} onClick={toggleMap} title="Session Map">
            <Activity size={14} strokeWidth={1.5} />
          </button>}
        {/* Files — FolderOpen icon */}
        {activeWorkspace && <button className={`px-2.5 flex items-center justify-center border-l border-white/[0.06] transition-all focus:outline-none ${isFilesView ? "text-indigo-400 bg-indigo-500/10" : "text-gray-600 hover:text-gray-300 hover:bg-white/[0.02]"}`} onClick={toggleFiles} title="Files">
            <FolderOpen size={14} strokeWidth={1.5} />
          </button>}
        {/* Save — Save icon */}
        {activeWorkspace && <button className={`px-2.5 flex items-center justify-center border-l border-white/[0.06] transition-all focus:outline-none ${snapshotBusy ? "text-gray-700 cursor-wait" : "text-gray-600 hover:text-emerald-400 hover:bg-emerald-500/5"}`} onClick={handleSaveSnapshot} disabled={snapshotBusy} title="Save session">
            <Save size={14} strokeWidth={1.5} />
          </button>}
        {/* Restore — RotateCcw icon */}
        {activeWorkspace && <button className={`px-2.5 flex items-center justify-center border-l border-white/[0.06] transition-all focus:outline-none ${snapshotBusy ? "text-gray-700 cursor-wait" : "text-gray-600 hover:text-violet-400 hover:bg-violet-500/5"}`} onClick={handleRestoreSnapshot} disabled={snapshotBusy} title="Restore session">
            <RotateCcw size={14} strokeWidth={1.5} />
          </button>}
        {/* Voice — compact waveform + mode toggle */}
        {activeWorkspace && audioConfig && <div className={`flex items-stretch border-l border-white/[0.06] ${audioModeBusy ? "opacity-60" : ""}`}>
            {false ? null : <React.Fragment>
                <div className={`flex items-center gap-1.5 px-2.5 border-r border-white/[0.06] transition-colors duration-200 ${voiceStats.phase === "error" ? "text-indigo-300 bg-indigo-500/10" : voiceStats.phase === "listening" ? "text-cyan-300 bg-cyan-500/10" : voiceStats.phase === "transcribing" ? "text-yellow-300 bg-yellow-500/10" : "text-gray-600"}`} title={voiceStats.error ?? "BrainVoice — volume"}>
                  <div className="flex items-end gap-[2px] h-3 w-8" aria-hidden="true">
                    {voiceStats.levels.slice(-8).map((level, i) => <span key={i} className={`w-[2px] rounded-full transition-all duration-75 ${voiceStats.phase === "error" ? "bg-red-400/70" : voiceStats.phase === "listening" ? "bg-cyan-400/70" : "bg-gray-700"}`} style={{
                height: `${Math.max(2, Math.round(level * 12))}px`
              }} />)}
                  </div>
                </div>
                {voiceCancelable && <button className="px-2 flex items-center justify-center text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/15 transition-all focus:outline-none border-r border-white/[0.06]" onClick={requestVoiceCancel} title="Cancelar BrainVoice" aria-label="Cancelar BrainVoice">
                    <X$1 size={11} strokeWidth={1.7} />
                  </button>}
                <button className="px-3 flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-widest transition-all duration-200 focus:outline-none text-gray-500 hover:text-white hover:bg-white/5" onClick={toggleVoiceInteractionMode} title={normalizedVoiceMode(audioConfig.interactionMode) === "coding" ? "Modo coding. Clique para CHAT." : "Modo conversa. Clique para CODE."}>
                  <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${normalizedVoiceMode(audioConfig.interactionMode) === "coding" ? "bg-red-500" : "bg-indigo-500"}`} />
                  {normalizedVoiceMode(audioConfig.interactionMode) === "coding" ? "CODE" : "CHAT"}
                </button>
              </React.Fragment>}
          </div>}
        {activeWorkspace && <div ref={paneMenuRef} className="border-l border-white/[0.06]">
            <button className="h-full px-3 flex items-center gap-1.5 font-mono text-[10px] font-bold text-indigo-400/70 hover:text-indigo-300 hover:bg-indigo-500/[0.06] transition-all focus:outline-none" onClick={() => setShowPaneMenu(v2 => !v2)} title="Novo pane ou restaurar">
              <Plus size={11} strokeWidth={2.5} />
              <span className="tracking-widest">PANE</span>
            </button>
            {showPaneMenu && <div className="fixed top-[39px] right-2 w-72 max-h-[calc(100vh-60px)] bg-[#0c0c14] border border-white/[0.08] rounded-xl shadow-2xl z-[10000] overflow-y-auto overflow-x-hidden">
                <p className="px-3 pt-1.5 pb-0.5 font-mono text-[9px] text-gray-600 uppercase tracking-widest">
                  Mode
                </p>
                <div className="flex gap-1 px-3 pb-2">
                  {[{
              id: "bypassPermissions",
              label: "Danger",
              color: "red"
            }, {
              id: "auto",
              label: "Auto",
              color: "green"
            }, {
              id: "default",
              label: "Pend",
              color: "gray"
            }, {
              id: "plan",
              label: "Plan",
              color: "blue"
            }].map(m => {
              const active = permissionMode === m.id;
              const tone = m.color === "red" ? active ? "bg-rose-500/20 text-rose-300 border-rose-500/40" : "border-white/10 text-gray-500 hover:text-rose-400" : m.color === "green" ? active ? "bg-green-500/20 text-green-300 border-green-500/40" : "border-white/10 text-gray-500 hover:text-green-400" : m.color === "blue" ? active ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/40" : "border-white/10 text-gray-500 hover:text-indigo-400" : active ? "bg-white/10 text-gray-200 border-white/20" : "border-white/10 text-gray-500 hover:text-gray-300";
              return <button key={m.id} onClick={() => setPermissionMode(m.id)} className={`flex-1 px-1.5 py-1 rounded border font-mono text-[9px] font-bold uppercase tracking-wider ${tone}`}>
                        {m.label}
                      </button>;
            })}
                </div>
                <p className="px-3 pt-1.5 pb-0.5 font-mono text-[9px] text-gray-600 uppercase tracking-widest border-t border-white/5">
                  Tipo
                </p>
                <button className="w-full text-left px-3 py-1.5 font-mono text-[10px] transition-all border-b border-white/5 text-gray-300 hover:text-gray-200 hover:bg-white/5" onClick={() => {
            setShowPaneMenu(false);
            handleAddTerminal();
          }}>
                  Terminal
                </button>
                <button className={`w-full text-left px-3 py-1.5 font-mono text-[10px] transition-all border-b border-white/5 ${detectedUrl ? "text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10" : "text-gray-300 hover:text-gray-200 hover:bg-white/5"}`} onClick={() => {
            setShowPaneMenu(false);
            handleAddBrowser();
          }}>
                  Browser{" "}
                  {detectedUrl && <span className="text-[9px] text-indigo-500/60 ml-1 truncate">{detectedUrl}</span>}
                </button>
                <p className="px-3 pt-1.5 pb-0.5 font-mono text-[9px] text-gray-600 uppercase tracking-widest">
                  Novo pane
                </p>
                {providers.map(p => {
            const pid = p.id === "claude-oauth" ? void 0 : p.id;
            const models = p.models ?? [];
            const host = p.host ?? "openclaude";
            const hostLabel = "OpenClaude";
            const isBuiltinCli = p.id === "claude-oauth";
            const mix = isBuiltinCli ? hostLabel : `${hostLabel} ← ${p.label}`;
            return <div key={p.id} className="border-b border-white/5">
                      <div className="px-3 pt-1.5 pb-0.5 flex items-center justify-between">
                        <span className="font-mono text-[10px] font-bold text-indigo-400 uppercase tracking-widest">
                          {mix}
                        </span>
                        <span className="font-mono text-[9px] text-gray-600">
                          {p.type === "oauth" ? "OAuth" : p.type === "anthropic-compat" ? "Anthropic-compat" : p.type === "openai-compat" ? "OpenAI-compat" : "custom"}
                        </span>
                      </div>
                      {models.length === 0 ? <button className="w-full text-left px-3 py-1 font-mono text-[10px] text-gray-300 hover:text-indigo-300 hover:bg-indigo-500/10" onClick={() => handleNewPaneWithProvider(pid)}>
                          + default
                        </button> : models.map(m => <button key={m} className="w-full text-left px-5 py-1 font-mono text-[10px] text-gray-300 hover:text-indigo-300 hover:bg-indigo-500/10" onClick={() => handleNewPaneWithProvider(pid, m)}>
                            + {m}
                          </button>)}
                    </div>;
          })}
                <button className="w-full text-left px-3 py-1.5 font-mono text-[10px] text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-all border-b border-white/5" onClick={() => {
            setShowPaneMenu(false);
            setProvidersInitialStep("pickTemplate");
            setShowProvidersModal(true);
          }}>
                  ⚙ Configurar providers…
                </button>
                <p className="px-3 pt-1.5 pb-0.5 font-mono text-[9px] text-gray-600 uppercase tracking-widest border-t border-white/5">
                  Sessão
                </p>
                <button className={`w-full text-left px-3 py-1.5 font-mono text-[10px] transition-all border-b border-white/5 ${snapshotBusy ? "text-gray-600 cursor-wait" : "text-gray-300 hover:text-gray-200 hover:bg-white/5"}`} onClick={handleSaveSnapshot} disabled={snapshotBusy}>
                  {snapshotBusy ? "Salvando…" : "Salvar Sessão"}
                </button>
                <button className={`w-full text-left px-3 py-1.5 font-mono text-[10px] transition-all border-b border-white/5 ${snapshotBusy ? "text-gray-600 cursor-wait" : "text-gray-300 hover:text-gray-200 hover:bg-white/5"}`} onClick={handleRestoreSnapshot} disabled={snapshotBusy}>
                  {snapshotBusy ? "Restaurando…" : "Restaurar Sessão"}
                </button>
                {savedPanes.length > 0 && <React.Fragment>
                    <p className="px-3 pt-1.5 pb-0.5 font-mono text-[9px] text-gray-600 uppercase tracking-widest">
                      Restaurar
                    </p>
                    <div className="max-h-72 overflow-y-auto">
                      {savedPanes.map(p => {
                const preview = p.summary || "(sem mensagens ainda)";
                const ago = new Date(p.savedAt).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit"
                });
                return <button className="w-full text-left px-3 py-1 hover:bg-white/5 transition-all" onClick={() => handleRestorePane(p)} title={`${p.session?.confidence === "high" ? "Resume conversation" : "Reopen pane (new session)"} ${p.id}`}>
                            <div className="flex items-center justify-between gap-2 leading-tight">
                              <span className="font-mono text-[10px] truncate flex-1 text-gray-300">
                                {preview}
                              </span>
                              <span className="font-mono text-[9px] text-gray-600 shrink-0">
                                {ago}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2 leading-tight">
                              <span className="font-mono text-[9px] text-gray-600">
                                {p.agent}:{p.id}
                              </span>
                              <span className="font-mono text-[9px] text-gray-600 truncate">
                                {p.session?.confidence === "high" ? "Resume conversation" : "Reopen pane (new session)"}
                              </span>
                            </div>
                            <div className="flex items-center justify-end leading-tight">
                              {p.session ? <span className="font-mono text-[9px] text-indigo-500/60 truncate">
                                  {p.session.provider}:{p.session.id.slice(0, 8)}
                                </span> : <span className="font-mono text-[9px] text-gray-700 truncate">
                                  fresh
                                </span>}
                            </div>
                          </button>;
              })}
                    </div>
                  </React.Fragment>}
              </div>}
          </div>}
        <div ref={accountRef} className="border-l border-white/[0.06]">
          <button className="h-full px-2.5 flex items-center gap-1.5 text-gray-600 hover:text-gray-300 hover:bg-white/[0.03] transition-all focus:outline-none" style={{
          WebkitAppRegion: "no-drag"
        }} onClick={() => setShowAccount(v2 => !v2)} title="Conta">
            <div className="w-6 h-6 rounded-full bg-indigo-500/20 border border-indigo-500/25 flex items-center justify-center">
              <span className="font-mono text-[9px] font-bold text-indigo-400">
                {authEmail?.slice(0, 1).toUpperCase() ?? "?"}
              </span>
            </div>
          </button>
          {showAccount && <div className="fixed top-[39px] right-2 w-64 bg-[#0c0c14] border border-white/[0.08] rounded-xl shadow-2xl z-[10000] overflow-hidden">
              <div className="px-3 py-2.5 border-b border-white/5">
                <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-0.5">
                  Conta
                </p>
                <p className="font-mono text-[11px] text-gray-300 truncate">{authEmail}</p>
              </div>
              <div className="px-3 py-2.5 border-b border-white/5 space-y-1">
                <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest">
                  Assinatura
                </p>
                {profile === null ? <p className="font-mono text-[11px] text-gray-600 animate-pulse">carregando…</p> : profile.plan ? <React.Fragment>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] text-gray-300 capitalize">
                        {profile.plan}
                      </span>
                      <span className={`font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded ${profile.status === "active" || profile.status === "trialing" ? "text-green-400 bg-green-500/10 border border-green-500/20" : "text-amber-400 bg-amber-500/10 border border-amber-500/20"}`}>
                        {profile.status ?? "—"}
                      </span>
                    </div>
                    {profile.periodEnd && <p className="font-mono text-[10px] text-gray-600">
                        renova {new Date(profile.periodEnd).toLocaleDateString("pt-BR")}
                      </p>}
                  </React.Fragment> : <p className="font-mono text-[11px] text-amber-400">sem plano ativo</p>}
              </div>
              <button className="w-full text-left px-3 py-2.5 font-mono text-[11px] text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-all border-b border-white/5" onClick={() => {
            setShowAccount(false);
            window.codeBrainApp?.auth?.openBilling?.();
          }}>
                Gerenciar assinatura →
              </button>
              {activeWorkspace && <button className="w-full text-left px-3 py-2.5 font-mono text-[11px] text-gray-400 hover:text-indigo-400 hover:bg-indigo-500/5 transition-all border-b border-white/5 flex items-center gap-2" onClick={() => {
            setShowAccount(false);
            setShowSquadModal(true);
          }}>
                  <span className="text-indigo-500/70">+</span> Squad
                </button>}
              <button className="w-full text-left px-3 py-2.5 font-mono text-[11px] text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-all border-b border-white/5 flex items-center gap-2" onClick={() => {
            setShowAccount(false);
            setProvidersInitialStep("pickTemplate");
            setShowProvidersModal(true);
          }}>
                <Settings size={12} strokeWidth={1.5} /> Providers
              </button>
              <button className="w-full text-left px-3 py-2.5 font-mono text-[11px] text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-all border-b border-white/5 flex items-center gap-2" onClick={() => {
            setShowAccount(false);
            setShowSettingsModal(true);
          }}>
                <Settings size={12} strokeWidth={1.5} /> Configurações
              </button>
              <button className="w-full text-left px-3 py-2.5 font-mono text-[11px] text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-all border-b border-white/5 flex items-center gap-2" onClick={() => {
            setShowAccount(false);
            setShowDiagnosticsModal(true);
          }}>
                <Activity size={12} strokeWidth={1.5} /> Diagnostico
              </button>
              <button className="w-full text-left px-3 py-2.5 font-mono text-[11px] text-gray-500 hover:text-rose-400 hover:bg-rose-500/5 transition-all" onClick={() => {
            setShowAccount(false);
            window.codeBrainApp?.auth?.logout?.();
          }}>
                Sair
              </button>
            </div>}
        </div>
      </div>
      <ProvidersModal open={showProvidersModal} initialStep={providersInitialStep} onClose={() => {
      setShowProvidersModal(false);
      setProvidersInitialStep("list");
    }} />
      <SquadModal open={showSquadModal} onClose={() => setShowSquadModal(false)} onSpawn={handleSpawnSquad} />
      <SettingsModal open={showSettingsModal} onClose={() => setShowSettingsModal(false)} />
      <DiagnosticsModal open={showDiagnosticsModal} activeWorkspace={activeWorkspace} onClose={() => setShowDiagnosticsModal(false)} />
    </div>;
}