import React from "react";
import { deterministicRestore, SessionSnapshot } from "../lib/session-restore";
import { usePanesStore } from "../stores/panes-store";

/**
 * Hook that auto-restores a session snapshot on startup.
 * Fires 2s after mount (after reconcileLivePanes settles) if:
 *  1. A snapshot exists for the workspace
 *  2. No live panes were found
 *  3. The workspace hasn't been auto-restored yet this session
 *  4. The autoRestore config is not disabled
 */
export function useSessionRestore(
  workspace: string | undefined,
  addPane: (p: any) => void
) {
  const [restoring, setRestoring] = React.useState(false);
  const [restored, setRestored] = React.useState(false);
  const restoredRef = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    if (!workspace) return;
    if (restoredRef.current.has(workspace)) return;

    const timer = setTimeout(async () => {
      // Condition: no live panes
      const currentPanes = usePanesStore.getState().panes;
      if (currentPanes.length > 0) return;

      // Condition: autoRestore not disabled
      try {
        const cfg = await (window as any).codeBrainApp?.appConfig?.get?.();
        if (cfg?.autoRestore === false) return;
      } catch { /* default to true */ }

      // Condition: snapshot exists
      const result = await (window as any).codeBrainApp?.session?.loadSnapshot(workspace);
      if (!result?.ok || !result.snapshot?.panes?.length) return;

      restoredRef.current.add(workspace);
      setRestoring(true);

      try {
        const snapshot: SessionSnapshot = result.snapshot;
        const restoreResult = await deterministicRestore(snapshot, addPane);

        if (restoreResult.restored > 0) {
          setRestored(true);
          // Set active pane to the first one (usually orchestrator)
          const panes = usePanesStore.getState().panes;
          if (panes.length > 0) {
            usePanesStore.getState().setActive(panes[0].id);
          }
          window.codeBrainApp?.notify?.(
            "Sessão restaurada",
            `${restoreResult.restored} pane(s) restaurado(s).` +
              (restoreResult.skipped > 0 ? ` ${restoreResult.skipped} pulado(s).` : "")
          );
        }
      } catch (err) {
        console.error("Auto-restore failed:", err);
      } finally {
        setRestoring(false);
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [workspace, addPane]);

  return { restoring, restored };
}
