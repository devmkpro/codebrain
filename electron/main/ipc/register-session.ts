import { ipcMain } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import log from "electron-log/main.js";
import type { AppContext } from "../context";

// ── Squad Persistence ──────────────────────────────────────────────────────
const SQUADS_FILE = path.join(
  process.env.APPDATA || process.env.HOME || ".",
  process.platform === "win32" ? "codebrain/squads.json" : ".codebrain/squads.json"
);

function ensureSquadsDir(): void {
  const dir = path.dirname(SQUADS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadSquads(): SquadConfig[] {
  try {
    if (!fs.existsSync(SQUADS_FILE)) return [];
    return JSON.parse(fs.readFileSync(SQUADS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveSquads(squads: SquadConfig[]): void {
  ensureSquadsDir();
  fs.writeFileSync(SQUADS_FILE, JSON.stringify(squads, null, 2), "utf-8");
}

interface SquadWorkerConfig {
  label: string;
  agent?: string;
  providerId?: string;
  model?: string;
  role?: string;
}

interface SquadConfig {
  id: string;
  name: string;
  description?: string;
  workers: SquadWorkerConfig[];
  createdAt: number;
  updatedAt: number;
}

export function registerSessionHandlers(ctx: AppContext): void {
  ipcMain.handle("session:saveSnapshot", async (_event, workspacePath: string) => {
    try {
      const panes = ctx.ptyManager.list();
      const snapshotPanes = panes.map((p) => {
        const cfg = ctx.paneConfigs.get(p.paneId);
        const lastLines = ctx.ptyManager.read(p.paneId, 50);
        return {
          id: p.paneId,
          agent: p.agent,
          providerId: cfg?.providerId,
          model: cfg?.model,
          role: cfg?.role,
          cwd: p.cwd,
          lastLines,
        };
      });

      const panesSummary = snapshotPanes.map((p) => {
        const role = p.role ?? "worker";
        const provider = p.providerId ? ` (provider: ${p.providerId}` + (p.model ? `, model: ${p.model}` : "") + ")" : "";
        const lastOutput = p.lastLines.length > 0
          ? `\n  Últimas linhas:\n    ${p.lastLines.slice(-10).join("\n    ")}`
          : "";
        return `- [${role}] ${p.agent}${provider} | cwd: ${p.cwd}${lastOutput}`;
      }).join("\n\n");

      const orchestratorPrompt = `## Contexto de Sessão Anterior

Você está retomando uma sessão que foi salva. Aqui está o estado dos panes que estavam ativos:

${panesSummary}

## Instruções

1. Primeiro, chame pane_list() para verificar se algum worker já está ativo.
2. Analise o contexto acima para entender o que cada worker estava fazendo.
3. Re-spawn SOMENTE os workers necessários que NÃO estão na pane_list — NUNCA crie duplicatas.
4. Para cada worker (novo ou existente), use mcp__codebrain__pane_write com um prompt detalhado que inclua:
   - O contexto do que ele estava fazendo antes (extraído das últimas linhas)
   - Instruções para continuar de onde parou
4. Não re-spawn workers que já completaram suas tarefas (marcados como "done").
5. Priorize workers que estavam em progresso.`;

      const snapshot = {
        id: `snap_${Date.now()}`,
        workspacePath,
        savedAt: Date.now(),
        panes: snapshotPanes,
        orchestratorPrompt,
      };

      const snapshotDir = path.join(workspacePath, ".codebrain");
      fs.mkdirSync(snapshotDir, { recursive: true });
      const snapshotPath = path.join(snapshotDir, "session-snapshot.json");
      fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");
      return { ok: true, path: snapshotPath };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("session:loadSnapshot", async (_event, workspacePath: string) => {
    try {
      const snapshotPath = path.join(workspacePath, ".codebrain", "session-snapshot.json");
      if (!fs.existsSync(snapshotPath)) return { ok: false, error: "no snapshot found" };
      const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));
      return { ok: true, snapshot };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Stubs for features not yet ported
  ipcMain.handle("session:load", async () => []);
  ipcMain.handle("session:loadAll", async () => []);
  ipcMain.handle("session:clear", async () => {});
  ipcMain.handle("session:deleteOne", async () => {});
  ipcMain.handle("claude:sessions", async () => []);
  ipcMain.handle("claude:summary", async () => "");
  ipcMain.handle("log:list", async () => []);

  // ── Token/Cost tracking — uses CostTracker singleton ─────────────────
  ipcMain.handle("tokens:byTask", async (_evt, taskId?: string) => {
    const tracker = ctx.costTracker;
    if (!tracker) return {};
    const result = tracker.taskSummary({ workspace: ctx.currentWorkspacePath });
    if (!result.ok) return {};
    if (taskId) {
      const task = result.data.tasks.find((t: any) => t.taskId === taskId);
      return task || {};
    }
    return result.data;
  });

  ipcMain.handle("tokens:byWorkspace", async (_evt, sinceMs?: number) => {
    const tracker = ctx.costTracker;
    if (!tracker) return {};
    const period = sinceMs ? "all" : "all";
    const result = tracker.summary({ workspace: ctx.currentWorkspacePath, period });
    if (!result.ok) return {};
    return result.data;
  });

  ipcMain.handle("tasks:list", async () => {
    const tracker = ctx.costTracker;
    if (!tracker) return { tasks: [] };
    const result = tracker.taskSummary({ workspace: ctx.currentWorkspacePath });
    if (!result.ok) return { tasks: [] };
    return result;
  });

  // ── Squad Persistence (real implementation) ────────────────────────────
  ipcMain.handle("squads:list", async () => {
    try {
      return loadSquads();
    } catch (err) {
      log.error("[squads] list error:", err);
      return [];
    }
  });

  ipcMain.handle("squads:save", async (_event, squad: SquadConfig) => {
    try {
      const squads = loadSquads();
      const idx = squads.findIndex((s) => s.id === squad.id);
      const now = Date.now();
      if (idx >= 0) {
        squads[idx] = { ...squads[idx], ...squad, updatedAt: now };
      } else {
        squads.push({ ...squad, id: squad.id || `squad_${now}`, createdAt: now, updatedAt: now });
      }
      saveSquads(squads);
      log.info(`[squads] saved: ${squad.name || squad.id}`);
      return { ok: true };
    } catch (err) {
      log.error("[squads] save error:", err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("squads:delete", async (_event, squadId: string) => {
    try {
      const squads = loadSquads();
      const filtered = squads.filter((s) => s.id !== squadId);
      saveSquads(filtered);
      log.info(`[squads] deleted: ${squadId}`);
      return { ok: true };
    } catch (err) {
      log.error("[squads] delete error:", err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
