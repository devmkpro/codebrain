import { ipcMain, dialog } from "electron";
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

  // ── Session Export ──────────────────────────────────────────────────────
  ipcMain.handle("session:export", async (_event, opts: { paneId?: string; format: "markdown" | "json"; includeAll?: boolean }) => {
    try {
      const { paneId, format = "markdown", includeAll = false } = opts;
      const panes = ctx.ptyManager.list();
      const targets = includeAll
        ? panes
        : paneId
          ? panes.filter((p) => p.paneId === paneId)
          : panes;

      if (targets.length === 0) {
        return { ok: false, error: "Nenhum pane ativo para exportar" };
      }

      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10);
      const timeStr = now.toTimeString().slice(0, 5);
      const wsName = path.basename(ctx.currentWorkspacePath);

      if (format === "json") {
        const data = {
          exportedAt: now.toISOString(),
          workspace: wsName,
          workspacePath: ctx.currentWorkspacePath,
          panes: targets.map((p) => {
            const cfg = ctx.paneConfigs.get(p.paneId);
            const registry = ctx.paneRegistry.get(p.paneId);
            return {
              paneId: p.paneId,
              agent: p.agent,
              model: cfg?.model,
              providerId: cfg?.providerId,
              role: cfg?.role,
              cwd: p.cwd,
              startedAt: registry?.spawnedAt,
              output: ctx.ptyManager.read(p.paneId, 500),
            };
          }),
        };

        const defaultName = `codebrain-export-${dateStr}.json`;
        const win = ctx.mainWindow;
        const result = win
          ? await dialog.showSaveDialog(win, {
              title: "Exportar Sessão (JSON)",
              defaultPath: defaultName,
              filters: [{ name: "JSON", extensions: ["json"] }],
            })
          : { canceled: false, filePath: path.join(ctx.currentWorkspacePath, defaultName) };

        if (result.canceled || !result.filePath) return { ok: false, error: "cancelado" };
        fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), "utf-8");
        return { ok: true, path: result.filePath };
      }

      // Markdown format
      let md = `# Codebrain Session Export\n`;
      md += `**Data:** ${dateStr} ${timeStr}  \n`;
      md += `**Workspace:** ${wsName}\n\n`;

      for (const p of targets) {
        const cfg = ctx.paneConfigs.get(p.paneId);
        const registry = ctx.paneRegistry.get(p.paneId);
        const label = cfg?.role || p.agent;
        const model = cfg?.model || "—";
        const startTime = registry?.spawnedAt
          ? new Date(registry.spawnedAt).toTimeString().slice(0, 5)
          : "—";
        const lines = ctx.ptyManager.read(p.paneId, 500);

        md += `## Pane: ${label}\n`;
        md += `**Modelo:** ${model} | **Agente:** ${p.agent} | **Início:** ${startTime}\n\n`;
        md += "```\n";
        md += lines.join("\n") || "(sem output)";
        md += "\n```\n\n";
      }

      const defaultName = `codebrain-export-${dateStr}.md`;
      const win = ctx.mainWindow;
      const result = win
        ? await dialog.showSaveDialog(win, {
            title: "Exportar Sessão (Markdown)",
            defaultPath: defaultName,
            filters: [{ name: "Markdown", extensions: ["md"] }],
          })
        : { canceled: false, filePath: path.join(ctx.currentWorkspacePath, defaultName) };

      if (result.canceled || !result.filePath) return { ok: false, error: "cancelado" };
      fs.writeFileSync(result.filePath, md, "utf-8");
      return { ok: true, path: result.filePath };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Session History (SQLite-backed) ──────────────────────────────────────
  ipcMain.handle("session:loadAll", async (_event, workspacePath?: string) => {
    try {
      const result = ctx.memoryStore.listSessionHistory({ workspace: workspacePath || undefined });
      return result.sessions || [];
    } catch (err) {
      log.error("[session] loadAll error:", err);
      return [];
    }
  });

  ipcMain.handle("session:deleteOne", async (_event, _workspacePath: string, sessionId: string) => {
    try {
      ctx.memoryStore.deleteSessionHistory({ id: sessionId });
      return { ok: true };
    } catch (err) {
      log.error("[session] deleteOne error:", err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("session:clear", async (_event, workspacePath?: string) => {
    try {
      ctx.memoryStore.clearSessionHistory({ workspace: workspacePath || undefined });
    } catch (err) {
      log.error("[session] clear error:", err);
    }
  });

  ipcMain.handle("session:load", async () => []);
  ipcMain.handle("claude:sessions", async () => []);
  ipcMain.handle("claude:summary", async () => "");
  ipcMain.handle("tasks:list", async (_event, opts?: { workspace?: string; mission_id?: string }) => {
    try {
      const store = ctx.memoryStore;
      if (!store?.listKanbanTasks) return { tasks: [] };
      // Resolve active mission if no mission_id provided
      let missionId = opts?.mission_id;
      const workspace = opts?.workspace || ctx.currentWorkspacePath || undefined;
      if (!missionId && store.resolveActiveMission) {
        const active = store.resolveActiveMission({ workspace });
        if (active?.ok && active.mission) missionId = active.mission.id;
      }
      const result = store.listKanbanTasks({ workspace, mission_id: missionId, limit: 100 });
      if (!result?.ok) return { tasks: [] };
      // Map kanban_tasks to Task shape for the UI
      const tasks = (result.tasks || []).map((t: any) => ({
        id: t.id,
        name: t.title,
        label: t.title,
        status: t.column_name === 'done' ? 'done' : t.column_name === 'in_progress' ? 'running' : 'pending',
        column: t.column_name,
        priority: t.priority,
        assigned_to: t.assigned_to,
        description: t.description,
        mission_id: t.mission_id,
        result: t.result,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      }));
      return { tasks, activeTaskId: null };
    } catch (err) {
      log.error("[tasks:list] error:", err);
      return { tasks: [] };
    }
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
