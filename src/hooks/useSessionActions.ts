import React from "react";
import { usePanesStore } from "../stores/panes-store";
import { useProvidersStore } from "../stores/providers-store";

export function useSessionActions(activeWorkspace: string | undefined, permissionMode: string, addPane: (p: any) => void) {
  const [snapshotBusy, setSnapshotBusy] = React.useState(false);
  const [savedPanes, setSavedPanes] = React.useState<any[]>([]);
  const providers = useProvidersStore(s => s.providers);

  const loadSavedPanes = React.useCallback(async () => {
    if (!activeWorkspace) { setSavedPanes([]); return; }
    const loadSaved = window.codeBrainApp?.session?.loadAll;
    if (!loadSaved) { setSavedPanes([]); return; }
    try {
      const [saved, claudeSessions] = await Promise.all([
        loadSaved(activeWorkspace).catch(() => []),
        window.codeBrainApp?.claude?.sessions?.(activeWorkspace).catch(() => []) ?? Promise.resolve([]),
      ]);
      const panes: any[] = [];
      for (const session of saved) {
        for (const pane of session.panes) panes.push({ ...pane, savedAt: session.savedAt });
      }
      for (const s of claudeSessions) {
        panes.push({ id: s.paneId ?? s.sessionId, agent: "openclaude", cwd: s.cwd, lastLines: s.summary ? [s.summary] : [], session: s.session ?? { provider: "claude", id: s.sessionId, capturedAt: s.savedAt ?? s.lastUsedAt ?? s.firstSeenAt, confidence: "high", source: "transcript-file" }, claudeSessionId: s.sessionId, providerId: s.providerId, model: s.model, summary: s.summary, savedAt: s.savedAt ?? s.lastUsedAt ?? s.firstSeenAt });
      }
      const byKey = new Map<string, any>();
      for (const pane of panes) {
        const session = pane.session ?? (pane.claudeSessionId ? { provider: "claude", id: pane.claudeSessionId } : undefined);
        const key = session ? `${session.provider}:${session.id}` : `${pane.agent}:${pane.id}`;
        const existing = byKey.get(key);
        if (!existing || pane.savedAt > existing.savedAt) byKey.set(key, pane);
      }
      setSavedPanes([...byKey.values()].sort((a, b) => b.savedAt - a.savedAt));
    } catch { setSavedPanes([]); }
  }, [activeWorkspace]);

  const handleSaveSnapshot = async () => {
    if (!activeWorkspace || snapshotBusy) return;
    setSnapshotBusy(true);
    try {
      const result = await window.codeBrainApp?.session?.saveSnapshot(activeWorkspace);
      if (result?.ok) window.codeBrainApp?.notify("Sessao salva", "Snapshot salvo com sucesso.");
    } finally { setSnapshotBusy(false); }
  };

  const handleRestoreSnapshot = async () => {
    if (!activeWorkspace || snapshotBusy) return;
    setSnapshotBusy(true);
    try {
      const result = await window.codeBrainApp?.session?.loadSnapshot(activeWorkspace);
      if (!result?.ok || !result.snapshot) return;
      const snapshot = result.snapshot;
      const orchResult = await window.codeBrainApp?.pty?.spawn({ agent: "openclaude", cwd: activeWorkspace, role: "orchestrator", permissionMode, sessionContext: snapshot.orchestratorPrompt });
      if (orchResult?.ok && orchResult.paneId) {
        addPane({ id: orchResult.paneId, agent: "openclaude", cwd: activeWorkspace, workspacePath: activeWorkspace, externallySpawned: true });
      }
    } finally { setSnapshotBusy(false); }
  };

  const handleRestorePane = async (pane: any) => {
    if (!activeWorkspace) return;
    if (pane.session?.confidence === "high") {
      const existing = usePanesStore.getState().panes.find(p => p.session?.provider === pane.session?.provider && p.session?.id === pane.session?.id);
      if (existing) { usePanesStore.getState().setActive(existing.id); return; }
    }
    const restoreProvider = pane.providerId ? providers.find(p => p.id === pane.providerId) : null;
    const restoreEnv: Record<string, string> = { ...(restoreProvider?.env ?? {}), ...(pane.model ? { ANTHROPIC_MODEL: pane.model, MODEL: pane.model } : {}) };
    const result = await window.codeBrainApp?.pty.spawn({ paneId: pane.id, agent: pane.agent, cwd: pane.cwd, args: pane.args, session: pane.session, claudeSessionId: pane.claudeSessionId, providerId: pane.providerId, model: pane.model, ...(Object.keys(restoreEnv).length > 0 ? { env: restoreEnv } : {}) });
    if (result?.ok && result.paneId) {
      addPane({ id: result.paneId, agent: pane.agent, cwd: pane.cwd, args: pane.args, workspacePath: activeWorkspace, session: pane.session, claudeSessionId: pane.claudeSessionId, lastLines: pane.lastLines, providerId: pane.providerId, model: pane.model, externallySpawned: true });
    }
  };

  return { snapshotBusy, savedPanes, loadSavedPanes, handleSaveSnapshot, handleRestoreSnapshot, handleRestorePane };
}
