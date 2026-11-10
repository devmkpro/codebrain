import { nativeResumeConfig, resumeIdentity, type ResumePane } from "./native-resume";

export interface SnapshotPane extends ResumePane { id: string; lastLines?: string[] }
export interface SessionSnapshot {
  id: string;
  workspacePath: string;
  savedAt: number;
  panes: SnapshotPane[];
  orchestratorPrompt?: string;
}
export interface RestoreResult { restored: number; skipped: number; errors: string[] }

export function workspaceLabel(wsPath: string): string {
  return wsPath?.replace(/[\\/]+$/, "").replace(/\\/g, "/").split("/").pop() || "Untitled Workspace";
}
export function isProjectDir(dirPath: string): boolean {
  return [".git", "package.json", "pyproject.toml", "Cargo.toml"].some(marker => dirPath.includes(marker));
}

/** Resume exact native conversations. A terminal preview is not context. */
export async function deterministicRestore(snapshot: SessionSnapshot, addPane: (pane: any) => void, _permissionMode?: string): Promise<RestoreResult> {
  const result: RestoreResult = { restored: 0, skipped: 0, errors: [] };
  const pty = typeof window === "undefined" ? undefined : window.codeBrainApp?.pty;
  if (!pty) { result.errors.push("PTY API not available"); return result; }
  let live: any[];
  try {
    const response: any = await pty.list();
    live = Array.isArray(response) ? response : response.panes;
    if (!Array.isArray(live)) throw new Error("Lista de panes inválida.");
  } catch { result.errors.push("Não foi possível conferir os panes ativos; nenhuma conversa foi duplicada."); return result; }
  const panes = [...(snapshot.panes ?? [])].sort((a, b) => Number(b.role === "orchestrator") - Number(a.role === "orchestrator"));
  for (const pane of panes) {
    if (live.some(item => item.paneId === pane.id || (resumeIdentity(pane) && resumeIdentity(item) === resumeIdentity(pane)))) {
      result.skipped++; continue;
    }
    try {
      const config = nativeResumeConfig(pane, snapshot.workspacePath);
      const response = await pty.spawn(config);
      if (!response?.ok || !response.paneId) throw new Error(response?.error ?? "O harness recusou a retomada.");
      addPane({ ...config, id: response.paneId, externallySpawned: true });
      live.push({ ...config, paneId: response.paneId });
      result.restored++;
    } catch (err) {
      result.skipped++;
      result.errors.push(`${pane.agent}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}
