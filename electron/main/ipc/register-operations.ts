import { ipcMain } from "electron";
import type { AppContext } from "../context";
import { safeSend } from "../context";
import { getOperationsSnapshot } from "../services/operations";

export function registerOperationsHandlers(ctx: AppContext): void {
  ipcMain.handle("operations:snapshot", async (_event, args?: { workspace?: string; limit?: number }) => {
    try {
      return getOperationsSnapshot(ctx, args?.workspace, args?.limit ?? 100);
    } catch (error) {
      return {
        ok: false,
        workspace: args?.workspace || ctx.currentWorkspacePath,
        generatedAt: Date.now(),
        missions: [], actors: [], tasks: [], handoffs: [], messages: [], activities: [],
        totals: { actors: 0, running: 0, attention: 0, tasks: 0, handoffs: 0, messages: 0 },
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const emitUpdated = (workspace?: string) => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      safeSend(ctx, "operations:updated", { workspace: workspace || ctx.currentWorkspacePath, at: Date.now() });
    }, 80);
    timer.unref?.();
  };

  // The hooks manager is the Codebrain event bus. The board is therefore
  // refreshed by actual lifecycle/message/task events, not by a visual timer.
  const events = [
    "pane_spawned", "pane_exited", "pane_idle", "session_started", "session_ended",
    "message_sent", "message_received", "task_started", "task_completed", "work_reported",
    "worker_started", "worker_stopped", "worker_alert", "memory_written",
  ];
  for (const eventType of events) {
    ctx.hooksManager.on(eventType, (event: any) => {
      const workspace = event?.data?.workspace
        || event?.data?.cwd
        || (event?.paneId ? ctx.paneConfigs.get(event.paneId)?.cwd : undefined);
      emitUpdated(workspace);
    });
  }
  ctx.ptyManager.on("output", (paneId) => emitUpdated(ctx.paneConfigs.get(paneId)?.cwd));
  ctx.ptyManager.on("exit", (paneId) => emitUpdated(ctx.paneConfigs.get(paneId)?.cwd));
}
