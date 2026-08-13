import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bot, Check, ChevronRight, Cpu, LoaderCircle, Plus, X } from "lucide-react";
import { notify } from "../../lib/notify";
import { HOST_LABELS, resolveSpawnTarget } from "../../lib/resolve-spawn-target";
import { useNavStore } from "../../stores/nav-store";
import { usePaneLauncherStore } from "../../stores/pane-launcher-store";
import { usePanesStore } from "../../stores/panes-store";
import { useProvidersStore } from "../../stores/providers-store";

interface ProviderLike {
  id: string;
  label?: string;
  host?: string;
  type?: string;
  models?: string[];
  baseUrl?: string;
  env?: Record<string, string>;
}

export function PaneLauncher() {
  const open = usePaneLauncherStore((state) => state.open);
  const close = usePaneLauncherStore((state) => state.close);
  const providers = useProvidersStore((state: any) => state.providers) as ProviderLike[];
  const loadProviders = useProvidersStore((state: any) => state.load) as () => Promise<void>;
  const addPane = usePanesStore((state: any) => state.addPane);
  const tabs = useNavStore((state) => state.tabs) as Array<{ workspacePath: string }>;
  const activeTabIndex = useNavStore((state) => state.activeTabIndex);
  const workspace = tabs[activeTabIndex]?.workspacePath;
  const [providerId, setProviderId] = useState<string | null>(null);
  const [spawning, setSpawning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const availableProviders = useMemo(() => providers.filter((provider) => (provider.models?.length ?? 0) > 0), [providers]);
  const provider = availableProviders.find((item) => item.id === providerId) ?? null;

  useEffect(() => {
    if (!open) return;
    setProviderId(null);
    setError(null);
    void loadProviders();
  }, [loadProviders, open]);

  if (!open) return null;

  const spawn = async (model: string) => {
    if (!workspace || !provider) return;
    setSpawning(model);
    setError(null);
    const target = resolveSpawnTarget({ providerId: provider.id, model, providers, explicit: true });
    try {
      const permissionMode = localStorage.getItem("codebrain.permissionMode") ?? "bypassPermissions";
      const result = await window.codeBrainApp.pty.spawn({
        agent: target.agent,
        cwd: workspace,
        providerId: target.providerId,
        model: target.model,
        permissionMode,
        ...(Object.keys(target.env).length ? { env: target.env } : {}),
      });
      if (!result?.ok || !result.paneId) throw new Error(result?.error ?? "spawn retornou erro");
      addPane({
        id: result.paneId,
        agent: target.agent,
        cwd: workspace,
        workspacePath: workspace,
        providerId: target.providerId,
        model: target.model,
        permissionMode,
        externallySpawned: true,
      });
      close();
      notify("Pane aberto", `${provider.label ?? provider.id} · ${target.model}`, "success");
    } catch (spawnError) {
      setError(spawnError instanceof Error ? spawnError.message : String(spawnError));
    } finally {
      setSpawning(null);
    }
  };

  return <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Novo pane">
    <button className="absolute inset-0" onClick={close} aria-label="Fechar seletor"/>
    <section className="relative w-[min(680px,94vw)] max-h-[min(720px,90vh)] flex flex-col overflow-hidden border border-cb-line-1 rounded-lg bg-cb-bg-1 shadow-2xl">
      <header className="h-14 px-4 flex items-center gap-3 border-b border-cb-line-0">
        {provider && <button onClick={() => { setProviderId(null); setError(null); }} className="p-1 text-cb-fg-3 hover:text-cb-fg-0" aria-label="Voltar aos providers"><ArrowLeft size={15}/></button>}
        <div className="h-8 w-8 rounded-cb-1 border border-cb-accent/30 bg-cb-accent/10 flex items-center justify-center"><Plus size={15} className="text-cb-accent"/></div>
        <div className="flex-1"><h2 className="text-sm text-cb-fg-0">Novo pane de IA</h2><p className="text-2xs text-cb-fg-3">{provider ? "2 de 2 · escolha um modelo compatível" : "1 de 2 · escolha o provider primeiro"}</p></div>
        <button onClick={close} className="p-1 text-cb-fg-3 hover:text-cb-fg-0" aria-label="Fechar"><X size={15}/></button>
      </header>

      <div className="px-4 pt-3 flex items-center gap-2">
        <div className={`h-1 flex-1 rounded-full ${provider ? "bg-cb-success" : "bg-cb-accent"}`}/>
        <div className={`h-1 flex-1 rounded-full ${provider ? "bg-cb-accent" : "bg-cb-line-1"}`}/>
      </div>

      <div className="cb-scroll overflow-auto p-4">
        {!workspace ? <div className="py-12 text-center"><p className="text-sm text-cb-fg-1">Abra um workspace antes de criar um pane.</p><p className="mt-1 text-2xs text-cb-fg-3">O agente sempre inicia no projeto ativo.</p></div> : !provider ? <>
          <div className="mb-3"><div className="cb-label">providers disponíveis</div><p className="mt-1 text-2xs text-cb-fg-3">Cada provider abre somente a CLI e os modelos que ele suporta.</p></div>
          {availableProviders.length === 0 ? <div className="py-12 text-center"><Bot size={24} className="mx-auto mb-2 text-cb-fg-3"/><p className="text-xs text-cb-fg-1">Nenhum provider com modelos configurado.</p><p className="mt-1 text-2xs text-cb-fg-3">Configure um provider em Configurações → Providers.</p></div> : <div className="grid grid-cols-2 gap-2">
            {availableProviders.map((item) => <button key={item.id} onClick={() => setProviderId(item.id)} className="group min-h-24 p-3 text-left border border-cb-line-1 rounded-cb-1 bg-cb-bg-0 hover:border-cb-accent/60 hover:bg-cb-accent/5 transition-colors">
              <div className="flex items-start gap-3"><div className="h-8 w-8 shrink-0 rounded-cb-1 bg-cb-bg-2 border border-cb-line-0 flex items-center justify-center text-2xs text-cb-accent font-semibold">{(item.label ?? item.id).slice(0, 2).toUpperCase()}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-1 text-xs text-cb-fg-0"><span className="truncate">{item.label ?? item.id}</span><ChevronRight size={12} className="ml-auto text-cb-fg-3 group-hover:text-cb-accent"/></div><div className="mt-1 text-2xs text-cb-fg-3">{HOST_LABELS[item.host ?? ""] ?? item.host ?? "OpenClaude"}</div><div className="mt-2 text-[9px] text-cb-fg-3">{item.models?.length} modelo{item.models?.length === 1 ? "" : "s"}</div></div></div>
            </button>)}
          </div>}
        </> : <>
          <div className="mb-3 flex items-center gap-3"><div className="h-9 w-9 rounded-cb-1 bg-cb-accent/10 border border-cb-accent/30 flex items-center justify-center"><Cpu size={15} className="text-cb-accent"/></div><div><div className="text-xs text-cb-fg-0">{provider.label ?? provider.id}</div><div className="text-2xs text-cb-fg-3">{HOST_LABELS[provider.host ?? ""] ?? provider.host} · somente modelos compatíveis</div></div></div>
          <div className="space-y-2">{(provider.models ?? []).map((model, index) => <button key={model} disabled={Boolean(spawning)} onClick={() => void spawn(model)} className="w-full min-h-12 px-3 flex items-center gap-3 text-left border border-cb-line-1 rounded-cb-1 bg-cb-bg-0 hover:border-cb-accent/60 hover:bg-cb-accent/5 disabled:opacity-50">
            <div className="h-6 w-6 rounded-full border border-cb-line-1 flex items-center justify-center">{spawning === model ? <LoaderCircle size={12} className="animate-spin text-cb-accent"/> : index === 0 ? <Check size={11} className="text-cb-success"/> : <Cpu size={11} className="text-cb-fg-3"/>}</div>
            <div className="flex-1 min-w-0"><div className="text-xs text-cb-fg-0 truncate">{model}</div>{index === 0 && <div className="text-[9px] text-cb-success">recomendado pelo provider</div>}</div>
            <ChevronRight size={13} className="text-cb-fg-3"/>
          </button>)}</div>
        </>}
        {error && <div className="mt-3 px-3 py-2 border border-cb-danger/30 rounded-cb-1 bg-cb-danger/5 text-2xs text-cb-danger">{error}</div>}
      </div>

      <footer className="px-4 py-3 border-t border-cb-line-0 flex items-center gap-2 text-2xs text-cb-fg-3"><Bot size={12}/><span>provider → CLI correta → modelo compatível</span></footer>
    </section>
  </div>;
}
