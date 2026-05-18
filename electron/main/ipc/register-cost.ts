import { ipcMain } from "electron";
import type { AppContext } from "../context";

export function registerCostIpc(ctx: AppContext): void {
  const tracker = ctx.costTracker;
  if (!tracker) return;

  ipcMain.handle("cost:summary", async (_evt, opts?: Record<string, unknown>) => {
    return tracker.summary({
      workspace: opts?.workspace as string | undefined,
      sessionId: opts?.sessionId as string | undefined,
      period: (opts?.period as "today" | "week" | "month" | "all") || "all",
    });
  });

  ipcMain.handle("cost:setBudget", async (_evt, opts: Record<string, unknown>) => {
    return tracker.setBudget({
      workspace: opts.workspace as string,
      dailyLimit: opts.dailyLimit as number | undefined,
      monthlyLimit: opts.monthlyLimit as number | undefined,
    });
  });

  ipcMain.handle("cost:getBudget", async (_evt, opts: Record<string, unknown>) => {
    return tracker.getBudget({ workspace: opts.workspace as string });
  });

  ipcMain.handle("cost:getAlerts", async (_evt, opts?: Record<string, unknown>) => {
    return tracker.getAlerts({
      limit: (opts?.limit as number) || 50,
      type: opts?.type as string | undefined,
    });
  });

  ipcMain.handle("cost:listModels", async () => {
    return tracker.listModels();
  });

  ipcMain.handle("cost:estimate", async (_evt, opts: Record<string, unknown>) => {
    return tracker.estimateCost({
      model: opts.model as string,
      inputTokens: opts.inputTokens as number,
      outputTokens: opts.outputTokens as number,
    });
  });

  ipcMain.handle("cost:reset", async (_evt, opts?: Record<string, unknown>) => {
    return tracker.reset({
      confirm: true,
      workspace: opts?.workspace as string | undefined,
    });
  });

  ipcMain.handle("cost:taskSummary", async (_evt, opts?: Record<string, unknown>) => {
    return tracker.taskSummary({
      workspace: opts?.workspace as string | undefined,
      period: (opts?.period as "today" | "week" | "month" | "all") || "all",
    });
  });
}
