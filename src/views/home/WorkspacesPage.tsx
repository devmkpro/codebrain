import React from "react";
import { ArrowRight, FolderPlus, LoaderCircle, Unlink, X } from "lucide-react";
import { useNavStore } from "../../stores/nav-store";
import { usePanesStore } from "../../stores/panes-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { ensureWorkspaceUnlinked } from "../../lib/workspace-unlink";
import { useWorkspaceRegistry } from "../../components/operations/useWorkspaceRegistry";
import { activityPresentation, derivePaneActivity } from "../../components/shell/pane-status";
import { StatusGlyph } from "../../components/shell/pane-status-glyph";
import { Button, Prompt, SectionRule } from "../../components/ui/primitives";

interface WorkspaceTab {
  workspacePath: string;
  view?: { kind?: string };
}

interface PaneLike {
  id: string;
  agent?: string;
  model?: string;
  status?: string;
  cwd?: string;
  workspacePath?: string;
  kind?: string;
  label?: string;
}

function folderName(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;
}

function normalized(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function belongsToWorkspace(pane: PaneLike, workspacePath: string): boolean {
  const root = normalized(workspacePath);
  const candidate = normalized(pane.workspacePath || pane.cwd || "");
  return candidate === root || candidate.startsWith(`${root}/`);
}

function isWorking(pane: PaneLike): boolean {
  const activity = derivePaneActivity(pane);
  return activity === "thinking" || activity === "running";
}

function PaneSummary({ pane }: { pane: PaneLike }) {
  const activity = derivePaneActivity(pane);
  return (
    <div className="cb-row min-w-0">
      <StatusGlyph activity={activity} />
      <span className="text-sm text-cb-fg-0 truncate">{pane.label || pane.agent || "shell"}</span>
      {pane.model && <span className="text-sm text-cb-fg-2 truncate hidden sm:inline">{pane.model}</span>}
      <span className="ml-auto text-xs text-cb-fg-2 shrink-0">{activityPresentation(activity).label}</span>
    </div>
  );
}

function OpenWorkspaceRow({
  tab,
  index,
  panes,
  onOpen,
  onClose,
  onUnlink,
}: {
  tab: WorkspaceTab;
  index: number;
  panes: PaneLike[];
  onOpen: (index: number) => void;
  onClose: (index: number) => void;
  onUnlink: (path: string, index: number) => void;
}) {
  const name = folderName(tab.workspacePath);
  const workspacePanes = panes.filter((pane) => belongsToWorkspace(pane, tab.workspacePath));
  const working = workspacePanes.filter(isWorking).length;

  return (
    <article className="cb-rail min-w-0" style={{ "--cb-rail-color": "var(--cb-accent)" } as React.CSSProperties}>
      <header className="flex items-start gap-3">
        <button type="button" onClick={() => onOpen(index)} className="min-w-0 flex-1 text-left group/open">
          <span className="flex items-center gap-2">
            <span className="text-md font-medium text-cb-fg-0 truncate group-hover/open:text-cb-accent">{name}</span>
            <ArrowRight size={12} className="shrink-0 text-cb-fg-2 group-hover/open:text-cb-accent" />
          </span>
          <span className="block text-xs text-cb-fg-2 truncate mt-0.5" title={tab.workspacePath}>{tab.workspacePath}</span>
        </button>
        <div className="flex items-center gap-0.5 shrink-0">
          <button type="button" onClick={() => onClose(index)} className="cb-btn cb-btn--ghost cb-btn--sm cb-btn--icon" title="Fechar: mantém nos recentes" aria-label={`Fechar ${name}`}><X size={12} /></button>
          <button type="button" onClick={() => onUnlink(tab.workspacePath, index)} className="cb-btn cb-btn--ghost cb-btn--sm cb-btn--icon hover:!text-cb-danger" title="Desvincular: não apaga arquivos" aria-label={`Desvincular ${name}`}><Unlink size={12} /></button>
        </div>
      </header>

      <p className="mt-1 text-xs text-cb-fg-2 tabular-nums">
        <span className="text-cb-fg-1">{workspacePanes.length}</span> {workspacePanes.length === 1 ? "agente" : "agentes"}
        {" · "}
        <span className={working > 0 ? "text-cb-agent-running" : "text-cb-fg-1"}>{working}</span> em ação
        {tab.view?.kind && tab.view.kind !== "workspace" ? ` · ${tab.view.kind}` : ""}
      </p>

      <div className="mt-1 -ml-2">
        {workspacePanes.length === 0
          ? <p className="px-2 min-h-cell flex items-center text-sm text-cb-fg-2">Nenhum agente aberto neste workspace.</p>
          : workspacePanes.slice(0, 3).map((pane) => <PaneSummary key={pane.id} pane={pane} />)}
        {workspacePanes.length > 3 && <p className="px-2 min-h-cell flex items-center text-xs text-cb-fg-2">+ {workspacePanes.length - 3} agentes</p>}
      </div>
    </article>
  );
}

function RecentWorkspaceRow({ path, onOpen, onUnlink, busy }: { path: string; onOpen: (path: string) => void; onUnlink: (path: string) => void; busy: boolean }) {
  const name = folderName(path);
  return (
    <div className="group flex items-center min-w-0 rounded-cb-1 hover:bg-cb-bg-2">
      <button type="button" onClick={() => onOpen(path)} className="flex min-w-0 flex-1 items-center gap-3 px-2 py-1.5 text-left">
        <span className="min-w-0 flex-1">
          <span className="block text-base text-cb-fg-0 truncate">{name}</span>
          <span className="block text-xs text-cb-fg-2 truncate" title={path}>{path}</span>
        </span>
        <span className="text-cb-accent opacity-0 group-hover:opacity-100 shrink-0" aria-hidden>❯</span>
      </button>
      <button type="button" onClick={() => onUnlink(path)} disabled={busy} className="cb-btn cb-btn--ghost cb-btn--sm cb-btn--icon mx-1 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:!text-cb-danger" title="Desvincular: não apaga arquivos" aria-label={`Desvincular ${name}`}><Unlink size={12} /></button>
    </div>
  );
}

export function WorkspacesPage() {
  const { recents, loaded, error: registryError, refresh } = useWorkspaceRegistry();
  const loading = !loaded;
  const [launching, setLaunching] = React.useState(false);
  const [unlinking, setUnlinking] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const tabs = useNavStore((state) => state.tabs) as WorkspaceTab[];
  const closeTab = useNavStore((state) => state.closeTab);
  const setActiveTab = useNavStore((state) => state.setActiveTab);
  const openWorkspace = useNavStore((state) => state.openWorkspace);
  const panes = usePanesStore((state) => state.panes) as PaneLike[];
  const setWorkspacePath = useWorkspaceStore((state) => state.setPath);

  const openPath = React.useCallback(async (path?: string) => {
    if (launching) return;
    setLaunching(true);
    setError(null);
    try {
      const selected = path || await window.codeBrainApp.workspace.open();
      if (!selected) return;
      setWorkspacePath(selected);
      await window.codeBrainApp.workspaces.touch(selected);
      openWorkspace(selected);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir o workspace.");
    } finally {
      setLaunching(false);
    }
  }, [launching, openWorkspace, setWorkspacePath, refresh]);

  const unlink = React.useCallback(async (path: string, tabIndex?: number) => {
    if (unlinking) return;
    setUnlinking(path);
    setError(null);
    try {
      const result = await window.codeBrainApp?.workspaces?.remove?.(path);
      ensureWorkspaceUnlinked(result);
      // Compare at completion, not by the index captured before awaiting IPC:
      // other windows/actions may have reordered tabs while unlinking.
      const nav = useNavStore.getState() as any;
      for (let index = nav.tabs.length - 1; index >= 0; index--) {
        if (normalized(nav.tabs[index].workspacePath) === normalized(path)) closeTab(index);
      }
      const workspace = useWorkspaceStore.getState() as any;
      if (workspace.path && normalized(workspace.path) === normalized(path)) {
        const next = useNavStore.getState() as any;
        setWorkspacePath(next.tabs[next.activeTabIndex]?.workspacePath || null);
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível desvincular o workspace.");
    } finally {
      setUnlinking(null);
    }
  }, [closeTab, unlinking, refresh, setWorkspacePath]);

  const recentOnly = recents.filter((path) => !tabs.some((tab) => normalized(tab.workspacePath) === normalized(path)));
  const working = panes.filter(isWorking).length;

  return (
    <section className="flex-1 min-h-0 cb-scroll bg-cb-bg-0">
      <div className="max-w-[1040px] mx-auto px-5 py-5 flex flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-[1_1_280px]">
            <h1 className="text-xl font-bold text-cb-fg-0 leading-snug"><Prompt>workspaces</Prompt></h1>
            <p className="mt-1 text-sm text-cb-fg-2 tabular-nums">
              {tabs.length} {tabs.length === 1 ? "aberto" : "abertos"} · {recents.length} {recents.length === 1 ? "recente" : "recentes"} · {working} {working === 1 ? "agente" : "agentes"} em ação
            </p>
          </div>
          <Button variant="primary" size="lg" onClick={() => void openPath()} disabled={launching}>
            {launching ? <LoaderCircle size={14} className="animate-spin" /> : <FolderPlus size={14} />}
            {launching ? "abrindo…" : "abrir pasta"}
          </Button>
        </header>

        {(error || registryError) && <div role="alert" className="cb-note text-cb-danger" style={{ "--cb-rail-color": "var(--cb-danger)" } as React.CSSProperties}>{error || registryError}</div>}

        <section>
          <SectionRule label="abertos" count={tabs.length} />
          {tabs.length === 0 ? (
            <div className="px-2 py-6">
              <p className="text-base text-cb-fg-0"><Prompt waiting>nenhum workspace aberto</Prompt></p>
              <p className="mt-1 text-sm text-cb-fg-2">Abra uma pasta ou escolha um recente abaixo. Cada workspace mantém seus agentes no contexto certo.</p>
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-5">
              {tabs.map((tab, index) => (
                <OpenWorkspaceRow key={tab.workspacePath} tab={tab} index={index} panes={panes} onOpen={setActiveTab} onClose={closeTab} onUnlink={(path, tabIndex) => void unlink(path, tabIndex)} />
              ))}
            </div>
          )}
        </section>

        <section>
          <SectionRule label="recentes" count={recentOnly.length} />
          <div className="mt-1">
            {loading ? (
              <div className="py-6 flex items-center justify-center gap-2 text-sm text-cb-fg-2"><LoaderCircle size={12} className="animate-spin" /> carregando workspaces…</div>
            ) : recentOnly.length === 0 ? (
              <p className="px-2 py-3 text-sm text-cb-fg-2">Nenhum workspace recente fora dos abertos.</p>
            ) : recentOnly.map((path) => (
              <RecentWorkspaceRow key={path} path={path} onOpen={(item) => void openPath(item)} onUnlink={(item) => void unlink(item)} busy={unlinking !== null} />
            ))}
          </div>
          <p className="mt-2 px-2 text-xs text-cb-fg-2">fechar mantém no histórico · desvincular remove da lista, sem apagar arquivos</p>
        </section>
      </div>
    </section>
  );
}
