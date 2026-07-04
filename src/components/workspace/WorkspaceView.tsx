import React from "react";
import { isPathWithin } from "../layout/DropTarget";
import { CODEBRAIN_FILE_DRAG_TYPE } from "../session/SessionMap";
import { sessionKey, timeSince, highConfidenceLabel } from "../files/Editor";

// WorkspaceView
import { usePanesStore } from "../../stores/panes-store";
import { useNavStore } from "../../stores/nav-store";
import { SessionMap } from "../session/SessionMap";
import { FileTree } from "../files/FileTree";
import { useEditorStore } from "../../stores/editor-store";
import { Editor } from "../files/Editor";
import { Grid } from "../layout/Grid";
import { FloatingFileWindow } from "./FloatingFileWindow";
export function WorkspaceView({
  workspacePath,
  view
}) {
  const addPane = usePanesStore(s => s.addPane);
  const panes = usePanesStore(s => s.panes);
  const navigateInActiveTab = useNavStore(s => s.navigateInActiveTab);
  const [sessions, setSessions] = React.useState(null);
  const [sessionsLoading, setSessionsLoading] = React.useState(false);
  const [sessionsSlow, setSessionsSlow] = React.useState(false);
  const [floatingFiles, setFloatingFiles] = React.useState([]);
  const rootRef = React.useRef(null);
  const zRef = React.useRef(50);
  const folderName = workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? workspacePath;
  const workspacePanes = panes.filter(p => isPathWithin(workspacePath, p.cwd));
  const favoritePaneRef = React.useRef<any>(null);
  const configLoadedRef = React.useRef(false); // true once getWorkspaceConfig resolved
  React.useEffect(() => {
    let cancelled = false;
    const getWorkspaceConfig = window.codeBrainApp?.workspaceConfig?.get;
    if (!getWorkspaceConfig) return () => {
      cancelled = true;
    };
    getWorkspaceConfig(workspacePath).then(cfg => {
      if (cancelled) return;
      favoritePaneRef.current = cfg?.favoritePane ?? null;
      configLoadedRef.current = true;
      // Auto-spawn removed — user must explicitly open a pane via +SHELL or Squad
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);
  React.useEffect(() => {
    let cancelled = false;
    let slowTimer = null;
    let fallbackTimer = null;
    if (workspacePanes.length > 0) {
      setSessions(null);
      setSessionsLoading(false);
      setSessionsSlow(false);
      return;
    }
    setSessions(null);
    setSessionsLoading(true);
    setSessionsSlow(false);
    slowTimer = setTimeout(() => {
      if (!cancelled) setSessionsSlow(true);
    }, 1200);
    fallbackTimer = setTimeout(() => {
      if (!cancelled) {
        setSessions([]);
        setSessionsLoading(false);
      }
    }, 8e3);
    const loadSavedSessions = window.codeBrainApp?.session?.loadAll;
    if (!loadSavedSessions) {
      setSessions([]);
      setSessionsLoading(false);
      setSessionsSlow(false);
      return () => {
        cancelled = true;
        if (slowTimer) clearTimeout(slowTimer);
        if (fallbackTimer) clearTimeout(fallbackTimer);
      };
    }
    Promise.all([loadSavedSessions(workspacePath).catch(() => []), window.codeBrainApp?.claude?.sessions?.(workspacePath).catch(() => []) ?? Promise.resolve([])]).then(([saved, claudeSessions]) => {
      if (cancelled) return;
      const synth = (claudeSessions ?? []).map(cs => ({
        id: cs.sessionId,
        workspacePath,
        savedAt: cs.savedAt ?? cs.lastUsedAt ?? cs.firstSeenAt,
        panes: [{
          id: cs.paneId ?? cs.sessionId,
          agent: "claude",
          cwd: cs.cwd,
          lastLines: cs.summary ? [cs.summary] : [],
          session: cs.session ?? {
            provider: "claude",
            id: cs.sessionId,
            capturedAt: cs.savedAt ?? cs.lastUsedAt ?? cs.firstSeenAt,
            confidence: "high",
            source: "transcript-file"
          },
          claudeSessionId: cs.sessionId,
          providerId: cs.providerId,
          model: cs.model
        }]
      }));
      const byKey = new Map();
      for (const item of [...saved, ...synth]) {
        const pane = item.panes[0];
        const key = pane ? sessionKey(pane) ?? `${pane.agent}:${pane.id}` : item.id;
        const existing = byKey.get(key);
        if (!existing || item.savedAt > existing.savedAt) byKey.set(key, item);
      }
      setSessions([...byKey.values()].sort((a, b) => b.savedAt - a.savedAt));
    }).catch(() => {
      if (!cancelled) setSessions([]);
    }).finally(() => {
      if (cancelled) return;
      if (slowTimer) clearTimeout(slowTimer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      setSessionsLoading(false);
      setSessionsSlow(false);
    });
    return () => {
      cancelled = true;
      if (slowTimer) clearTimeout(slowTimer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
    };
  }, [workspacePath, workspacePanes.length]);
  const handleResumeSingle = React.useCallback(async pane => {
    setSessions(null);
    const result = await window.codeBrainApp?.pty.spawn({
      paneId: pane.id,
      agent: pane.agent,
      cwd: pane.cwd,
      args: pane.args,
      session: pane.session,
      claudeSessionId: pane.claudeSessionId,
      providerId: pane.providerId,
      model: pane.model
    });
    if (result?.ok && result.paneId) {
      addPane({
        id: result.paneId,
        agent: pane.agent,
        cwd: pane.cwd,
        args: pane.args,
        session: pane.session,
        claudeSessionId: pane.claudeSessionId,
        lastLines: pane.lastLines,
        providerId: pane.providerId,
        model: pane.model
      });
    }
  }, [addPane]);
  const handleNew = React.useCallback(async () => {
    setSessions(null);
    if (view?.kind === "map") navigateInActiveTab({ kind: "workspace" });
    // Wait for workspace config to load if not done yet (race condition on fast clicks)
    if (!configLoadedRef.current) {
      try {
        const cfg = await window.codeBrainApp?.workspaceConfig?.get(workspacePath);
        favoritePaneRef.current = cfg?.favoritePane ?? null;
        configLoadedRef.current = true;
      } catch {}
    }
    const fav = favoritePaneRef.current;
    if (fav?.providerId) {
      // Use favoritePane config (respects default spawn setting)
      window.codeBrainApp?.pty.spawn({
        agent: fav.agent ?? "openclaude",
        cwd: workspacePath,
        providerId: fav.providerId,
        model: fav.model || undefined,
      }).then((result: any) => {
        if (result?.ok && result.paneId) {
          addPane({
            id: result.paneId,
            agent: fav.agent ?? "openclaude",
            cwd: workspacePath,
            workspacePath,
            providerId: fav.providerId,
            model: fav.model || undefined,
            externallySpawned: true,
          });
        }
      }).catch(() => {});
    } else {
      // No favoritePane configured — fallback: let main process decide
      window.codeBrainApp?.pty.spawn({
        cwd: workspacePath,
      }).then((result: any) => {
        if (result?.ok && result.paneId) {
          addPane({
            id: result.paneId,
            agent: "openclaude",
            cwd: workspacePath,
            workspacePath,
            externallySpawned: true,
          });
        }
      }).catch(() => {
        // last resort: add a pane directly
        addPane({ agent: "claude", cwd: workspacePath });
      });
    }
  }, [workspacePath, addPane, view, navigateInActiveTab]);
  const handleDelete = React.useCallback(async (e, sessionId) => {
    e.stopPropagation();
    await window.codeBrainApp?.session?.deleteOne(workspacePath, sessionId);
    setSessions(prev => prev?.filter(s => s.id !== sessionId) ?? []);
  }, [workspacePath]);
  // Listen for panes spawned by the MCP orchestrator
  React.useEffect(() => {
    const unsub = window.codeBrainApp?.pty?.onPaneAdded?.((info: any) => {
      if (!info?.paneId) return;
      addPane({
        id: info.paneId,
        agent: info.agent || "openclaude",
        cwd: info.cwd || workspacePath,
        workspacePath: workspacePath,
        providerId: info.providerId,
        model: info.model,
        externallySpawned: true,
      });
    });
    return () => { unsub?.(); };
  }, [addPane, workspacePath]);
  const bringFloatingFileToFront = React.useCallback(id => {
    const nextZ = ++zRef.current;
    setFloatingFiles(prev => prev.map(f => f.id === id ? {
      ...f,
      z: nextZ
    } : f));
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
    const id = `${relPath}-${Date.now()}`;
    setFloatingFiles(prev => [...prev, {
      id,
      workspacePath,
      relPath,
      content: res.content,
      dirty: false,
      x,
      y,
      w: 520,
      h: 360,
      z: ++zRef.current
    }]);
  }, [bringFloatingFileToFront, floatingFiles, workspacePath]);
  const updateFloatingFile = React.useCallback((id, patch) => {
    setFloatingFiles(prev => prev.map(f => f.id === id ? {
      ...f,
      ...patch
    } : f));
  }, []);
  const closeFloatingFile = React.useCallback(id => {
    setFloatingFiles(prev => prev.filter(f => f.id !== id));
  }, []);
  const saveFloatingFile = React.useCallback(async file => {
    const res = await window.codeBrainApp?.files?.write(file.workspacePath, file.relPath, file.content);
    if (res?.ok) updateFloatingFile(file.id, {
      dirty: false
    });
  }, [updateFloatingFile]);
  const showPicker = sessions !== null && workspacePanes.length === 0 && view?.kind !== "map" && view?.kind !== "files";
  const showSessionLoading = sessionsLoading && workspacePanes.length === 0 && view?.kind !== "map" && view?.kind !== "files";

  return <div ref={rootRef} className="flex flex-col h-full cb-surface" onDragOver={e => {
    if (!e.dataTransfer.types.includes(CODEBRAIN_FILE_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }} onDrop={e => {
    const relPath = e.dataTransfer.getData(CODEBRAIN_FILE_DRAG_TYPE);
    if (!relPath) return;
    e.preventDefault();
    void openFloatingFile(relPath, { x: e.clientX, y: e.clientY });
  }}>

    {/* ── Sessions loading ──────────────────────────────────── */}
    {showSessionLoading && (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 px-6 text-center">
          <div className="w-6 h-6 rounded-full border-2 border-[#5855e5]/20 border-t-[#5855e5] animate-spin" />
          <p className="font-mono text-[11px] text-slate-500 uppercase tracking-widest">
            Carregando sessões…
          </p>
          {sessionsSlow && (
            <div className="flex flex-col items-center gap-3 mt-2">
              <p className="font-mono text-[10px] text-slate-400 max-w-sm leading-relaxed">
                Este workspace tem muitas transcrições. Você pode abrir um pane novo sem esperar.
              </p>
              <button
                onClick={handleNew}
                className="px-4 py-2 rounded-lg bg-[#5855e5] text-white text-[11px] font-bold uppercase tracking-widest hover:bg-[#4a47d6] transition-colors cursor-pointer"
              >
                Abrir pane agora
              </button>
            </div>
          )}
        </div>
      </div>
    )}

    {/* ── Session picker (no panes open yet) ───────────────── */}
    {showPicker && (
      <div className="flex-1 overflow-y-auto relative" style={{ scrollbarWidth: 'thin' }}>
        {/* Subtle grid background */}
        <div className="absolute inset-0 opacity-[0.025] pointer-events-none" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

        <div className="max-w-2xl mx-auto px-6 py-8">
          {/* Header */}
          <div className="mb-8">
            <p className="font-mono text-[10px] bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent uppercase tracking-[0.25em] mb-2">
              Workspace
            </p>
            <h2 className="text-xl font-bold text-white tracking-tight">{folderName}</h2>
            <p className="text-[11px] text-slate-400 mt-1 font-mono">{workspacePath}</p>
          </div>

          {sessions.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center py-16 gap-6">
              <div className="relative">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/10 to-indigo-500/10 border border-violet-500/15 flex items-center justify-center">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(139,92,246,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(139,92,246,0.7)" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                </div>
              </div>
              <div className="text-center">
                <p className="text-[14px] font-bold text-slate-400">Nenhuma sessão salva</p>
                <p className="text-[11px] text-slate-400 mt-2 max-w-xs leading-relaxed">
                  Use <span className="font-bold text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded mx-0.5">+ SHELL</span>
                  no header para abrir uma sessão com um provider.
                </p>
              </div>
              <button
                onClick={handleNew}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-[11px] font-bold uppercase tracking-widest hover:from-violet-500 hover:to-indigo-500 hover:shadow-[0_0_20px_rgba(139,92,246,0.25)] transition-all cursor-pointer"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                Nova Sessão
              </button>
            </div>
          ) : (
            /* Sessions list */
            <div>
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  Sessões salvas — {sessions.reduce((n, s) => n + s.panes.length, 0)}
                </p>
                <button
                  onClick={handleNew}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#5855e5]/10 border border-[#5855e5]/20 text-indigo-400 text-[10px] font-bold uppercase tracking-widest hover:bg-[#5855e5]/20 transition-all cursor-pointer"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                  Nova
                </button>
              </div>

              <div className="space-y-2">
                {sessions.flatMap(session =>
                  session.panes.map(pane => {
                    const preview = pane.lastLines.filter(Boolean).slice(-1)[0];
                    const ago     = timeSince(session.savedAt);
                    const isHigh  = pane.session?.confidence === 'high' || highConfidenceLabel(pane);
                    return (
                      <button
                        key={pane.id}
                        onClick={() => handleResumeSingle(pane)}
                        className="group w-full text-left p-4 rounded-xl border border-white/5 bg-[#0A0A0B]/60 hover:border-[#5855e5]/30 hover:bg-[#5855e5]/5 transition-all cursor-pointer"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-[10px] font-bold text-indigo-400 uppercase">{pane.agent}</span>
                            {pane.model && <span className="font-mono text-[10px] text-slate-400">{pane.model}</span>}
                            {isHigh && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase">resumível</span>}
                            {pane.cwd && <span className="font-mono text-[10px] text-slate-400">{pane.cwd.split(/[\\/]/).pop()}</span>}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-mono text-[10px] text-slate-500">{ago}</span>
                            <span
                              onClick={e => handleDelete(e, session.id)}
                              className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400 transition-all cursor-pointer"
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                            </span>
                          </div>
                        </div>
                        {preview && (
                          <p className="font-mono text-[10px] text-slate-400 truncate leading-relaxed group-hover:text-slate-300 transition-colors">
                            {preview}
                          </p>
                        )}
                        {(pane.claudeSessionId || pane.session) && (
                          <p className="font-mono text-[9px] text-slate-800 mt-1.5 truncate">
                            {pane.session?.provider ?? 'claude'}:{(pane.claudeSessionId ?? pane.session?.id ?? '').slice(0, 12)}…
                          </p>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    )}

    {/* ── Session Map ───────────────────────────────────────── */}
    {!showPicker && view?.kind === "map" && (
      <div className="flex-1 min-h-0 flex">
        <SessionMap workspacePath={workspacePath} />
      </div>
    )}

    {/* ── Files view ────────────────────────────────────────── */}
    {!showPicker && view?.kind === "files" && (
      <div className="flex-1 min-h-0 flex">
        <div style={{ width: 260, flexShrink: 0 }} className="h-full border-r border-white/5">
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

    {/* ── Terminal Grid ─────────────────────────────────────── */}
    {!showPicker && !showSessionLoading && (
      <div className="flex-1 min-h-0" style={{ display: view?.kind === "map" || view?.kind === "files" ? "none" : "flex" }}>
        <Grid workspacePath={workspacePath} />
      </div>
    )}

    {/* ── Floating file windows ─────────────────────────────── */}
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
}