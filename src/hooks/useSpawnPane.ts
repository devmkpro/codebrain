import React from "react";
import { useProvidersStore } from "../stores/providers-store";
import { usePanesStore } from "../stores/panes-store";
import { useBrowserStore } from "../stores/browser-store";
import { useNavStore } from "../stores/nav-store";

export function useSpawnPane(activeWorkspace: string | undefined) {
  const addPane = usePanesStore(s => s.addPane);
  const navigateInActiveTab = useNavStore(s => s.navigateInActiveTab);
  const providers = useProvidersStore(s => s.providers);
  const detectedUrl = useBrowserStore(s => s.detectedUrl);

  const [permissionMode, setPermissionMode] = React.useState(() => {
    return localStorage.getItem("codebrain.permissionMode") ?? "bypassPermissions";
  });
  const [favoritePane, setFavoritePane] = React.useState<any>(null);

  React.useEffect(() => {
    localStorage.setItem("codebrain.permissionMode", permissionMode);
  }, [permissionMode]);

  React.useEffect(() => {
    if (!activeWorkspace) { setFavoritePane(null); return; }
    let cancelled = false;
    window.codeBrainApp?.workspaceConfig?.get(activeWorkspace).then(cfg => {
      if (!cancelled) setFavoritePane(cfg?.favoritePane ?? null);
    }).catch(() => { if (!cancelled) setFavoritePane(null); });
    return () => { cancelled = true; };
  }, [activeWorkspace]);

  const resolveValidModel = (providerId: string, requestedModel?: string): string | undefined => {
    const provider = providers.find(p => p.id === providerId);
    if (!provider) return undefined;
    const models = provider.models ?? [];
    if (models.length === 0) return undefined;
    if (requestedModel && models.includes(requestedModel)) return requestedModel;
    return models[0];
  };

  const handleAddPane = (providerId?: string, model?: string) => {
    if (!activeWorkspace) return;
    const explicit = providerId !== undefined || model !== undefined;
    let nextProviderId = explicit ? providerId : favoritePane?.providerId;
    const nextModel = explicit ? model : favoritePane?.model;

    // If model is given but provider is not, resolve provider from the model name.
    // This prevents falling back to MIMO when the user picks a Claude/Gemini model
    // but the providerId is undefined (e.g. claude-oauth virtual provider).
    if (nextModel && !nextProviderId) {
      const lowerModel = nextModel.toLowerCase();
      for (const p of providers) {
        if (p.models?.includes(nextModel)) {
          nextProviderId = p.id;
          break;
        }
      }
      // Fallback by model prefix if not found in any provider's model list
      if (!nextProviderId) {
        if (lowerModel.startsWith("claude-") || lowerModel.startsWith("opus-") || lowerModel.startsWith("sonnet-") || lowerModel.startsWith("haiku-")) {
          const anthropic = providers.find(p => p.type === "anthropic-compat" || p.type === "oauth");
          if (anthropic) nextProviderId = anthropic.id;
        } else if (lowerModel.startsWith("gemini-")) {
          const gemini = providers.find(p => p.type === "gemini-compat");
          if (gemini) nextProviderId = gemini.id;
        } else if (lowerModel.startsWith("mimo-")) {
          const mimo = providers.find(p => p.type === "mimo-compat");
          if (mimo) nextProviderId = mimo.id;
        } else if (lowerModel.startsWith("gpt-") || lowerModel.startsWith("o")) {
          const openai = providers.find(p => p.type === "openai-compat");
          if (openai) nextProviderId = openai.id;
        }
      }
    }

    const provider = nextProviderId ? providers.find(p => p.id === nextProviderId) : null;
    const agent = explicit
      ? provider?.host ?? (provider?.type === "oauth" ? "claude" : "openclaude")
      : favoritePane?.agent ?? provider?.host ?? "openclaude";
    const spawnEnv: Record<string, string> = {
      ...(nextModel ? { ANTHROPIC_MODEL: nextModel, MODEL: nextModel } : {}),
    };
    window.codeBrainApp?.pty.spawn({
      agent,
      cwd: activeWorkspace,
      providerId: nextProviderId,
      model: nextModel,
      permissionMode,
      ...(Object.keys(spawnEnv).length > 0 ? { env: spawnEnv } : {}),
    }).then(result => {
      if (!result?.ok || !result.paneId) {
        window.codeBrainApp?.notify?.("Erro ao abrir pane", result?.error ?? "spawn retornou erro");
        return;
      }
      addPane({ id: result.paneId, agent, cwd: activeWorkspace, workspacePath: activeWorkspace, providerId: nextProviderId, model: nextModel, permissionMode, externallySpawned: true });
    }).catch(err => {
      window.codeBrainApp?.notify?.("Erro ao abrir pane", String(err));
    });
  };

  const handleAddTerminal = (isFilesView: boolean, isMapView: boolean) => {
    if (!activeWorkspace) return;
    if (isFilesView || isMapView) navigateInActiveTab({ kind: "workspace" });
    window.codeBrainApp?.pty.spawn({ agent: "shell", cwd: activeWorkspace }).then(result => {
      if (!result?.ok || !result.paneId) {
        window.codeBrainApp?.notify?.("Erro ao abrir terminal", result?.error ?? "spawn retornou erro");
        return;
      }
      addPane({ id: result.paneId, agent: "shell", cwd: activeWorkspace, workspacePath: activeWorkspace, externallySpawned: true });
    }).catch(err => { window.codeBrainApp?.notify?.("Erro ao abrir terminal", String(err)); });
  };

  const handleAddBrowser = (isFilesView: boolean, isMapView: boolean) => {
    if (!activeWorkspace) return;
    if (isFilesView || isMapView) navigateInActiveTab({ kind: "workspace" });
    addPane({ kind: "browser", cwd: activeWorkspace, url: detectedUrl ?? "about:blank" } as any);
  };

  const handleSpawnSquad = async (squad: any) => {
    if (!activeWorkspace) return;
    const { nanoid } = await import("nanoid");
    const activityId = nanoid(8);
    const workers = squad.workers ?? (squad.worker ? [squad.worker] : []);
    const workerPaneIds: string[] = [];

    for (const w of workers) {
      const provider = providers.find(p => p.id === w.providerId);
      const agent = w.agent ?? provider?.host ?? "openclaude";
      const validModel = resolveValidModel(w.providerId, w.model);
      const workerResult = await window.codeBrainApp?.pty.spawn({ agent, cwd: activeWorkspace, activityId, providerId: w.providerId, model: validModel, permissionMode });
      if (!workerResult?.ok || !workerResult.paneId) continue;
      workerPaneIds.push(workerResult.paneId);
      addPane({ id: workerResult.paneId, agent, cwd: activeWorkspace, workspacePath: activeWorkspace, activityId, providerId: w.providerId, model: validModel, externallySpawned: true } as any);
    }

    if (workerPaneIds.length === 0) return;

    const orchProvider = providers.find(p => p.id === squad.orchestrator.providerId);
    const orchAgent = squad.orchestrator.agent ?? orchProvider?.host ?? "openclaude";
    const validOrchModel = resolveValidModel(squad.orchestrator.providerId, squad.orchestrator.model);
    const orchResult = await window.codeBrainApp?.pty.spawn({
      agent: orchAgent, cwd: activeWorkspace, activityId, providerId: squad.orchestrator.providerId,
      model: validOrchModel, permissionMode, env: { SQUAD_WORKER_IDS: workerPaneIds.join(","), SQUAD_ACTIVITY_ID: activityId },
    });
    if (orchResult?.ok && orchResult.paneId) {
      addPane({ id: orchResult.paneId, agent: orchAgent, cwd: activeWorkspace, workspacePath: activeWorkspace, activityId, providerId: squad.orchestrator.providerId, model: validOrchModel, externallySpawned: true } as any);
    }
  };

  return { permissionMode, setPermissionMode, favoritePane, resolveValidModel, handleAddPane, handleAddTerminal, handleAddBrowser, handleSpawnSquad, detectedUrl };
}
