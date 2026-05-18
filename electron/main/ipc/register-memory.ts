import { ipcMain } from "electron";
import type { AppContext } from "../context";

export function registerMemoryIpc(ctx: AppContext): void {
  const store = ctx.memoryStore;
  if (!store) return;

  ipcMain.handle("memory:list", async (_evt, opts?: Record<string, unknown>) => {
    return store.list({
      type: opts?.type as string | undefined,
      agent_id: opts?.agent_id as string | undefined,
      workspace: opts?.workspace as string | undefined,
      limit: (opts?.limit as number) || 100,
      offset: (opts?.offset as number) || 0,
    });
  });

  ipcMain.handle("memory:search", async (_evt, opts: Record<string, unknown>) => {
    return store.search({
      query: opts.query as string,
      type: opts.type as string | undefined,
      workspace: opts.workspace as string | undefined,
      limit: (opts.limit as number) || 20,
    });
  });

  ipcMain.handle("memory:read", async (_evt, opts: Record<string, unknown>) => {
    return store.read({
      id: opts?.id as string | undefined,
      key: opts?.key as string | undefined,
      workspace: opts?.workspace as string | undefined,
    });
  });

  ipcMain.handle("memory:delete", async (_evt, opts: Record<string, unknown>) => {
    return store.delete({
      id: opts?.id as string | undefined,
      key: opts?.key as string | undefined,
    });
  });

  ipcMain.handle("memory:stats", async () => {
    return store.stats();
  });

  ipcMain.handle("memory:listPatterns", async (_evt, opts?: Record<string, unknown>) => {
    return store.listPatterns({
      pattern_type: opts?.pattern_type as string | undefined,
      limit: (opts?.limit as number) || 50,
    });
  });

  ipcMain.handle("memory:deletePattern", async (_evt, opts: Record<string, unknown>) => {
    return store.deletePattern({ id: opts.id as string });
  });
}
