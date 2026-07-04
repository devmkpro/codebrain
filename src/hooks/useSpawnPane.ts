import React from "react";
import { useProvidersStore } from "../stores/providers-store";
import { usePanesStore } from "../stores/panes-store";
import { useBrowserStore } from "../stores/browser-store";
import { useNavStore } from "../stores/nav-store";
import { notify } from "../lib/notify";
import { resolveSpawnTarget } from "../lib/resolve-spawn-target";

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
    const rawPid = explicit ? providerId : favoritePane?.providerId;
    const providerDefaultModels: Record<string, string> = (() => {
      try { return JSON.parse(localStorage.getItem('codebrain.providerDefaultModels') ?? '{}'); } catch { return {}; }
    })();
    const rawModel = explicit ? model : (favoritePane?.model ?? (rawPid ? providerDefaultModels[rawPid] : undefined));
    const preferredAgent = (() => { try { return localStorage.getItem('codebrain.preferredAgent') || undefined; } catch { return undefined; } })();

    const target = resolveSpawnTarget({
      providerId: rawPid,
      model: rawModel,
      providers,
      preferredAgent,
      providerDefaultModels,
      explicit,
      favoriteAgent: favoritePane?.agent,
    });

    const envKeys = Object.keys(target.env);
    window.codeBrainApp?.pty.spawn({
      agent: target.agent,
      cwd: activeWorkspace,
      providerId: target.providerId,
      model: target.model,
      permissionMode,
      ...(envKeys.length > 0 ? { env: target.env } : {}),
    }).then(result => {
      if (!result?.ok || !result.paneId) {
        notify("Erro ao abrir pane", result?.error ?? "spawn retornou erro", "error");
        return;
      }
      addPane({ id: result.paneId, agent: target.agent, cwd: activeWorkspace, workspacePath: activeWorkspace, providerId: target.providerId, model: target.model, permissionMode, externallySpawned: true });
    }).catch(err => {
      notify("Erro ao abrir pane", String(err), "error");
    });
  };

  const handleAddTerminal = (isFilesView: boolean, isMapView: boolean) => {
    if (!activeWorkspace) return;
    if (isFilesView || isMapView) navigateInActiveTab({ kind: "workspace" });
    window.codeBrainApp?.pty.spawn({ agent: "shell", cwd: activeWorkspace }).then(result => {
      if (!result?.ok || !result.paneId) {
        notify("Erro ao abrir terminal", result?.error ?? "spawn retornou erro", "error");
        return;
      }
      addPane({ id: result.paneId, agent: "shell", cwd: activeWorkspace, workspacePath: activeWorkspace, externallySpawned: true });
    }).catch(err => { notify("Erro ao abrir terminal", String(err), "error"); });
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
    const preferredAgent = (() => { try { return localStorage.getItem('codebrain.preferredAgent') || undefined; } catch { return undefined; } })();
    const providerDefaultModels: Record<string, string> = (() => { try { return JSON.parse(localStorage.getItem('codebrain.providerDefaultModels') ?? '{}'); } catch { return {}; } })();

    // Map user-defined role names to system prompt roles
    const resolveRole = (roleName: string): string | undefined => {
      const lower = (roleName || "").toLowerCase().trim();
      if (lower.includes("ui-tester") || lower.includes("ui tester") || lower.includes("tester")) return "ui-tester";
      if (lower.includes("orchestrator")) return "orchestrator";
      // backend, frontend, worker → undefined (uses default worker prompt)
      return undefined;
    };

    for (const w of workers) {
      const target = resolveSpawnTarget({
        providerId: w.providerId,
        model: resolveValidModel(w.providerId, w.model),
        providers,
        preferredAgent,
        providerDefaultModels,
      });
      const role = resolveRole(w.role);
      const workerResult = await window.codeBrainApp?.pty.spawn({ agent: target.agent, cwd: activeWorkspace, activityId, providerId: target.providerId, model: target.model, permissionMode, role });
      if (!workerResult?.ok || !workerResult.paneId) continue;
      workerPaneIds.push(workerResult.paneId);
      addPane({ id: workerResult.paneId, agent: target.agent, cwd: activeWorkspace, workspacePath: activeWorkspace, activityId, providerId: target.providerId, model: target.model, externallySpawned: true, label: w.role } as any);
    }

    if (workerPaneIds.length === 0) return;

    const orchTarget = resolveSpawnTarget({
      providerId: squad.orchestrator.providerId,
      model: resolveValidModel(squad.orchestrator.providerId, squad.orchestrator.model),
      providers,
      preferredAgent,
      providerDefaultModels,
    });

    // Build worker config JSON so the orchestrator knows each worker's provider/model.
    // Inject into sessionContext (system prompt) — LLMs can't read env vars reliably.
    const workerConfig = workers.map((w: any, i: number) => ({
      paneId: workerPaneIds[i],
      role: w.role,
      providerId: w.providerId,
      model: resolveValidModel(w.providerId, w.model),
    }));

    const sessionContext = `## SQUAD_WORKER_CONFIG — Workers Already Running

The following workers are ALREADY spawned and running. Use their paneId to \`pane_write\` tasks directly. DO NOT spawn new workers with the same roles.

\`\`\`json
${JSON.stringify(workerConfig, null, 2)}
\`\`\`

**When spawning a REPLACEMENT worker** (if one crashes), use the SAME providerId and model from the config above for that role.`;

    const orchResult = await window.codeBrainApp?.pty.spawn({
      agent: orchTarget.agent, cwd: activeWorkspace, activityId, providerId: orchTarget.providerId,
      model: orchTarget.model, permissionMode, sessionContext,
      env: {
        SQUAD_WORKER_IDS: workerPaneIds.join(","),
        SQUAD_ACTIVITY_ID: activityId,
      },
    });
    if (orchResult?.ok && orchResult.paneId) {
      addPane({ id: orchResult.paneId, agent: orchTarget.agent, cwd: activeWorkspace, workspacePath: activeWorkspace, activityId, providerId: orchTarget.providerId, model: orchTarget.model, externallySpawned: true } as any);
    }
  };

  const handleSpawnFromConfig = async (configs: Array<{ providerId: string; model?: string; count: number; label?: string }>, missionId?: string) => {
    if (!activeWorkspace) return;
    const { nanoid } = await import("nanoid");
    const activityId = nanoid(8);

    for (const config of configs) {
      if (!config.providerId) continue;
      const provider = providers.find(p => p.id === config.providerId);
      const agent = provider?.host ?? (provider?.type === "oauth" ? "claude" : "openclaude");
      const validModel = resolveValidModel(config.providerId, config.model);

      for (let i = 0; i < config.count; i++) {
        const label = config.label ? (config.count > 1 ? `${config.label} ${i + 1}` : config.label) : undefined;
        try {
          const result = await window.codeBrainApp?.pty.spawn({
            agent, cwd: activeWorkspace, activityId,
            providerId: config.providerId, model: validModel,
            permissionMode, label,
          });
          if (!result?.ok || !result.paneId) continue;
          addPane({
            id: result.paneId, agent, cwd: activeWorkspace, workspacePath: activeWorkspace,
            activityId, providerId: config.providerId, model: validModel,
            missionId, externallySpawned: true,
          } as any);
        } catch (err) {
          notify("Erro ao abrir pane", String(err), "error");
        }
      }
    }
  };

  return { permissionMode, setPermissionMode, favoritePane, resolveValidModel, handleAddPane, handleAddTerminal, handleAddBrowser, handleSpawnSquad, handleSpawnFromConfig, detectedUrl };
}
