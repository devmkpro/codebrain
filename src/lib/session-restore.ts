/**
 * Deterministic session restore — spawns ALL panes from a snapshot directly,
 * with the correct agent, model, provider, and role. No LLM guessing required.
 */

export interface SnapshotPane {
  id: string;
  agent: string;
  providerId?: string;
  model?: string;
  role?: string;
  cwd: string;
  lastLines?: string[];
}

export interface SessionSnapshot {
  id: string;
  workspacePath: string;
  savedAt: number;
  panes: SnapshotPane[];
  orchestratorPrompt?: string;
}

export interface RestoreResult {
  restored: number;
  skipped: number;
  errors: string[];
}

interface PTYService {
  list(): Promise<{ paneId: string }[]>;
  spawn(opts: Record<string, unknown>): Promise<{ ok: boolean; paneId?: string }>;
}

interface PaneData {
  id: string;
  agent: string;
  cwd: string;
  workspacePath: string;
  providerId?: string;
  model?: string;
  externallySpawned: boolean;
}

const pty = (): PTYService | null => {
  if (typeof window === "undefined") return null;
  return (window as any).codeBrainApp?.pty;
};

/**
 * Extract a human-readable label from a workspace path.
 * E.g. "/Users/dev/projects/codebrain" → "codebrain"
 *      "C:\Users\Maike\Desktop\codebrain" → "codebrain"
 */
export function workspaceLabel(wsPath: string): string {
  if (!wsPath) return "Untitled Workspace";
  // Remove trailing slashes before splitting
  const normalized = wsPath.replace(/[\\/]+$/, "");
  const parts = normalized.replace(/\\/g, "/").split("/");
  const name = parts[parts.length - 1];
  return name || "Untitled Workspace";
}

/**
 * Check if a path looks like a valid project directory by checking for project markers.
 * Looks for the presence of common project indicator files/folders.
 * E.g. "/path/to/project/.git" → true
 *      "/path/with/package.json" → true
 */
export function isProjectDir(dirPath: string): boolean {
  const projectMarkers = [".git", "package.json", "pyproject.toml", "Cargo.toml"];
  return projectMarkers.some(marker => dirPath.includes(marker));
}

/**
 * Build a short sessionContext for a worker pane from its last output.
 */
function workerSessionContext(pane: SnapshotPane): string {
  const lines = (pane.lastLines ?? []).slice(-15);
  if (lines.length === 0) return "Restaurando sessão anterior. Continue o trabalho.";
  return [
    "Restaurando sessão anterior.",
    "Suas últimas linhas de saída foram:",
    "```",
    ...lines,
    "```",
    "Continue de onde parou.",
  ].join("\n");
}

/**
 * Build a sessionContext for the orchestrator that tells it workers are
 * already being restored by the system.
 */
function orchestratorSessionContext(snapshot: SessionSnapshot): string {
  const workers = snapshot.panes.filter(p => p.role !== "orchestrator");
  const lines = [
    "Sessão restaurada pelo sistema.",
    "",
    `**${workers.length} worker(s) foram restaurados automaticamente.**`,
    "Use `pane_list()` para ver os panes ativos.",
    "NÃO recrie workers que já existem — eles foram restaurados pelo sistema.",
    "",
    "Resuma o trabalho anterior e continue a partir de onde a sessão parou.",
  ];

  if (workers.length > 0) {
    lines.push("", "Workers restaurados:");
    for (const w of workers) {
      lines.push(`- ${w.role ?? "worker"} (${w.model ?? w.agent}) em ${w.cwd}`);
    }
  }

  // Include orchestrator's own last output if available
  const orch = snapshot.panes.find(p => p.role === "orchestrator");
  if (orch?.lastLines?.length) {
    lines.push("", "Últimas linhas do orchestrator:");
    lines.push("```");
    lines.push(...orch.lastLines.slice(-10));
    lines.push("```");
  }

  return lines.join("\n");
}

/**
 * Deterministically restore all panes from a snapshot.
 * Orchestrator spawns first, then workers sequentially.
 */
export async function deterministicRestore(
  snapshot: SessionSnapshot,
  addPane: (p: PaneData) => void,
  permissionMode?: string
): Promise<RestoreResult> {
  const result: RestoreResult = { restored: 0, skipped: 0, errors: [] };
  const p = pty();
  if (!p) {
    result.errors.push("PTY API not available");
    return result;
  }

  const panes = snapshot.panes ?? [];
  if (panes.length === 0) return result;

  // Separate orchestrator from workers
  const orchestrator = panes.find(pane => pane.role === "orchestrator");
  const workers = panes.filter(pane => pane.role !== "orchestrator");

  // Check which panes are already running
  let livePaneIds = new Set<string>();
  try {
    const livePanes = await p.list();
    livePaneIds = new Set(livePanes.map((lp: { paneId: string }) => lp.paneId));
  } catch { /* ignore */ }

  // Spawn orchestrator first
  if (orchestrator && !livePaneIds.has(orchestrator.id)) {
    try {
      const sessionContext = orchestratorSessionContext(snapshot);
      const r = await p.spawn({
        agent: orchestrator.agent,
        cwd: orchestrator.cwd,
        role: "orchestrator",
        providerId: orchestrator.providerId,
        model: orchestrator.model,
        permissionMode,
        sessionContext,
      });
      if (r?.ok && r.paneId) {
        addPane({
          id: r.paneId,
          agent: orchestrator.agent,
          cwd: orchestrator.cwd,
          workspacePath: snapshot.workspacePath,
          providerId: orchestrator.providerId,
          model: orchestrator.model,
          externallySpawned: true,
        });
        result.restored++;
      }
    } catch (err) {
      result.errors.push(`Orchestrator: ${err instanceof Error ? err.message : String(err)}`);
      result.skipped++;
    }
  }

  // Spawn workers sequentially
  for (const worker of workers) {
    if (livePaneIds.has(worker.id)) {
      result.skipped++;
      continue;
    }
    try {
      const r = await p.spawn({
        agent: worker.agent,
        cwd: worker.cwd,
        role: worker.role ?? "worker",
        providerId: worker.providerId,
        model: worker.model,
        permissionMode,
        sessionContext: workerSessionContext(worker),
      });
      if (r?.ok && r.paneId) {
        addPane({
          id: r.paneId,
          agent: worker.agent,
          cwd: worker.cwd,
          workspacePath: snapshot.workspacePath,
          providerId: worker.providerId,
          model: worker.model,
          externallySpawned: true,
        });
        result.restored++;
      }
    } catch (err) {
      result.errors.push(`${worker.role ?? "worker"} (${worker.model ?? worker.agent}): ${err instanceof Error ? err.message : String(err)}`);
      result.skipped++;
    }
  }

  return result;
}
