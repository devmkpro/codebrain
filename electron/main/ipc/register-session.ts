import { ipcMain } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AppContext } from "../context";

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
  ipcMain.handle("tokens:byTask", async () => ({}));
  ipcMain.handle("tokens:byWorkspace", async () => ({}));
  ipcMain.handle("log:list", async () => []);
  ipcMain.handle("tasks:list", async () => ({ tasks: [] }));
  ipcMain.handle("squads:list", async () => []);
  ipcMain.handle("squads:save", async () => {});
  ipcMain.handle("squads:delete", async () => {});
}
