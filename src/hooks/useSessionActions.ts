import React from "react";
import { usePanesStore } from "../stores/panes-store";
import { resumeIdentity, resumeSavedPane } from "../lib/native-resume";
import { deterministicRestore, type SessionSnapshot } from "../lib/session-restore";

export function useSessionActions(activeWorkspace: string | undefined, permissionMode: string, addPane: (p: any) => void) {
  const [snapshotBusy, setSnapshotBusy] = React.useState(false);
  const [savedPanes, setSavedPanes] = React.useState<any[]>([]);

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
        const key = resumeIdentity(pane) ?? `${pane.agent}:${pane.id}`;
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
      const snapshot = await window.codeBrainApp?.session?.loadSnapshot(activeWorkspace);
      if (!snapshot?.ok || !snapshot.snapshot) return;
      const result = await deterministicRestore(snapshot.snapshot as SessionSnapshot, addPane);
      window.codeBrainApp?.notify("Retomada de conversas", `${result.restored} retomada(s). ${result.errors.join(" ")}`);
    } finally { setSnapshotBusy(false); }
  };

  const handleRestorePane = async (pane: any) => {
    if (!activeWorkspace) return;
    try {
      const identity = resumeIdentity(pane);
      const existing = identity ? usePanesStore.getState().panes.find(p => resumeIdentity(p) === identity && p.status !== "exited") : undefined;
      if (existing) { usePanesStore.getState().setActive(existing.id); return; }
      await resumeSavedPane(pane, activeWorkspace, addPane);
    } catch (error) { window.codeBrainApp?.notify("Não foi possível retomar", error instanceof Error ? error.message : String(error)); }
  };

  return { snapshotBusy, savedPanes, loadSavedPanes, handleSaveSnapshot, handleRestoreSnapshot, handleRestorePane };
}
