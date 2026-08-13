import React from "react";
import {
  ArrowRight,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  SquareTerminal,
  Unlink,
  X,
} from "lucide-react";
import { useNavStore } from "../../stores/nav-store";
import { usePanesStore } from "../../stores/panes-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { ensureWorkspaceUnlinked } from "../../lib/workspace-unlink";

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

function PaneSummary({ pane }: { pane: PaneLike }) {
  const running = pane.status === "running" || pane.status === "working";
  return (
    <div className="flex min-w-0 items-center gap-2 h-cell px-2 border-t border-cb-line-0 first:border-t-0">
      <span
        className="cb-dot"
        data-pulse={running}
        style={{ "--cb-dot-color": running ? "var(--cb-agent-running)" : "var(--cb-agent-idle)" } as React.CSSProperties}
      />
      <span className="text-2xs text-cb-fg-1 truncate">{pane.agent || "shell"}</span>
      {pane.model && <span className="text-2xs text-cb-fg-3 truncate">{pane.model}</span>}
      <span className="ml-auto text-2xs text-cb-fg-3 shrink-0">{pane.id.slice(0, 4)}</span>
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
  const running = workspacePanes.filter((pane) => pane.status === "running" || pane.status === "working").length;

  return (
    <article className="relative flex flex-col min-w-0 border border-cb-line-1 bg-cb-bg-1 rounded-cb-1 hover:border-cb-line-2 transition-colors">
      <div className="absolute left-0 top-0 bottom-0 w-px bg-cb-accent" aria-hidden />
      <header className="flex items-start gap-3 px-3 py-3 border-b border-cb-line-0">
        <div className="w-7 h-7 shrink-0 flex items-center justify-center border border-cb-line-1 bg-cb-bg-2 rounded-cb-1">
          <FolderOpen size={13} className="text-cb-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-semibold text-cb-fg-0 truncate">{name}</h3>
          <p className="text-2xs text-cb-fg-3 truncate mt-0.5" title={tab.workspacePath}>{tab.workspacePath}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" onClick={() => onClose(index)} className="p-1 text-cb-fg-2 hover:text-cb-fg-0 rounded-cb-1 hover:bg-cb-bg-3" title="Fechar — mantém nos recentes" aria-label={`Fechar ${name}`}><X size={12} /></button>
          <button type="button" onClick={() => onUnlink(tab.workspacePath, index)} className="p-1 text-cb-fg-2 hover:text-cb-danger rounded-cb-1 hover:bg-cb-danger-wash" title="Desvincular — não apaga arquivos" aria-label={`Desvincular ${name}`}><Unlink size={12} /></button>
        </div>
      </header>

      <div className="flex items-center gap-4 h-cell-lg px-3 border-b border-cb-line-0 text-2xs">
        <span className="text-cb-fg-3">panes <strong className="text-cb-fg-1 font-medium">{workspacePanes.length}</strong></span>
        <span className="text-cb-fg-3">ativos <strong className="text-cb-success font-medium">{running}</strong></span>
        <span className="text-cb-fg-3 truncate">view <strong className="text-cb-fg-1 font-medium">{tab.view?.kind || "workspace"}</strong></span>
      </div>

      <div className="min-h-[44px] bg-cb-bg-0/40">
        {workspacePanes.length === 0
          ? <p className="px-3 h-[44px] flex items-center text-2xs text-cb-fg-3">Nenhum agente aberto neste workspace.</p>
          : workspacePanes.slice(0, 3).map((pane) => <PaneSummary key={pane.id} pane={pane} />)}
        {workspacePanes.length > 3 && <p className="h-cell px-2 flex items-center text-2xs text-cb-fg-3 border-t border-cb-line-0">+ {workspacePanes.length - 3} agentes</p>}
      </div>

      <button type="button" onClick={() => onOpen(index)} className="flex items-center justify-between h-cell-lg px-3 border-t border-cb-line-1 text-xs text-cb-fg-1 hover:text-cb-accent hover:bg-cb-bg-2">
        <span>abrir workspace</span><ArrowRight size={12} />
      </button>
    </article>
  );
}

function RecentWorkspaceRow({ path, onOpen, onUnlink, busy }: { path: string; onOpen: (path: string) => void; onUnlink: (path: string) => void; busy: boolean }) {
  const name = folderName(path);
  return (
    <div className="group flex items-center min-w-0 border-t border-cb-line-0 first:border-t-0 hover:bg-cb-bg-2">
      <button type="button" onClick={() => onOpen(path)} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left">
        <FolderOpen size={13} className="text-cb-fg-2 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-cb-fg-0 truncate">{name}</span>
          <span className="block text-2xs text-cb-fg-3 truncate mt-0.5" title={path}>{path}</span>
        </span>
        <span className="text-2xs text-cb-fg-3 group-hover:text-cb-accent shrink-0">abrir</span>
        <ArrowRight size={11} className="text-cb-fg-3 group-hover:text-cb-accent shrink-0" />
      </button>
      <button type="button" onClick={() => onUnlink(path)} disabled={busy} className="mx-2 p-1.5 text-cb-fg-2 hover:text-cb-danger hover:bg-cb-danger-wash rounded-cb-1 disabled:opacity-40" title="Desvincular — não apaga arquivos" aria-label={`Desvincular ${name}`}><Unlink size={12} /></button>
    </div>
  );
}

export function WorkspacesPage() {
  const [recents, setRecents] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [launching, setLaunching] = React.useState(false);
  const [unlinking, setUnlinking] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const tabs = useNavStore((state) => state.tabs) as WorkspaceTab[];
  const closeTab = useNavStore((state) => state.closeTab);
  const setActiveTab = useNavStore((state) => state.setActiveTab);
  const openWorkspace = useNavStore((state) => state.openWorkspace);
  const panes = usePanesStore((state) => state.panes) as PaneLike[];
  const setWorkspacePath = useWorkspaceStore((state) => state.setPath);

  React.useEffect(() => {
    let cancelled = false;
    window.codeBrainApp.workspaces.recent()
      .then((items) => { if (!cancelled) setRecents(Array.isArray(items) ? items : []); })
      .catch(() => { if (!cancelled) setError("Não foi possível carregar os workspaces recentes."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

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
      setRecents((items) => [selected, ...items.filter((item) => normalized(item) !== normalized(selected))]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir o workspace.");
    } finally {
      setLaunching(false);
    }
  }, [launching, openWorkspace, setWorkspacePath]);

  const unlink = React.useCallback(async (path: string, tabIndex?: number) => {
    if (unlinking) return;
    setUnlinking(path);
    setError(null);
    try {
      const result = await window.codeBrainApp?.workspaces?.remove?.(path);
      ensureWorkspaceUnlinked(result);
      if (tabIndex !== undefined) closeTab(tabIndex);
      setRecents((items) => items.filter((item) => normalized(item) !== normalized(path)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível desvincular o workspace.");
    } finally {
      setUnlinking(null);
    }
  }, [closeTab, unlinking]);

  const recentOnly = recents.filter((path) => !tabs.some((tab) => normalized(tab.workspacePath) === normalized(path)));
  const runningAgents = panes.filter((pane) => pane.status === "running" || pane.status === "working").length;

  return (
    <section className="relative flex-1 overflow-y-auto bg-cb-bg-0 cb-scroll">
      <div className="absolute inset-0 pointer-events-none opacity-40" style={{ backgroundImage: "linear-gradient(var(--cb-line-0) 1px, transparent 1px), linear-gradient(90deg, var(--cb-line-0) 1px, transparent 1px)", backgroundSize: "44px 44px" }} />
      <div className="relative max-w-[1120px] mx-auto px-5 py-5">
        <header className="flex items-start justify-between gap-5 pb-4 border-b border-cb-line-1">
          <div>
            <span className="cb-label text-cb-accent">workspace registry</span>
            <h1 className="text-base font-semibold text-cb-fg-0 mt-1">Workspaces</h1>
            <p className="text-2xs text-cb-fg-3 mt-1">Abra projetos e mantenha cada agente no contexto certo.</p>
          </div>
          <button type="button" onClick={() => void openPath()} disabled={launching} className="h-cell-lg px-3 flex items-center gap-2 border border-cb-accent bg-cb-accent-wash text-xs text-cb-accent-bright hover:bg-cb-accent-wash-strong rounded-cb-1 disabled:opacity-50">
            {launching ? <LoaderCircle size={12} className="animate-spin" /> : <FolderPlus size={12} />}
            {launching ? "abrindo…" : "abrir pasta"}
          </button>
        </header>

        <div className="grid grid-cols-3 border-b border-cb-line-1">
          {[
            ["abertos", tabs.length],
            ["recentes", recents.length],
            ["agentes ativos", runningAgents],
          ].map(([label, value], index) => (
            <div key={label} className={`h-12 px-3 flex flex-col justify-center ${index > 0 ? "border-l border-cb-line-0" : ""}`}>
              <span className="text-sm text-cb-fg-0 tabular-nums">{value}</span>
              <span className="cb-label">{label}</span>
            </div>
          ))}
        </div>

        {error && <div role="alert" className="mt-3 px-3 py-2 border border-cb-danger bg-cb-danger-wash text-xs text-cb-danger rounded-cb-1">{error}</div>}

        <div className="mt-5 flex items-center justify-between">
          <h2 className="cb-label">abertos · {tabs.length}</h2>
          <span className="text-2xs text-cb-fg-3">fechar mantém no histórico · desvincular remove da lista</span>
        </div>

        {tabs.length === 0 ? (
          <div className="mt-2 min-h-40 flex items-center justify-center border border-cb-line-1 bg-cb-bg-1/80 rounded-cb-1">
            <div className="text-center px-5 py-7">
              <div className="w-10 h-10 mx-auto flex items-center justify-center border border-cb-line-1 bg-cb-bg-2 rounded-cb-1"><SquareTerminal size={17} className="text-cb-fg-2" /></div>
              <p className="text-xs text-cb-fg-1 mt-3">Nenhum workspace aberto</p>
              <p className="text-2xs text-cb-fg-3 mt-1">Escolha uma pasta abaixo ou abra um novo projeto.</p>
              <button type="button" onClick={() => void openPath()} className="mt-3 h-cell-lg px-3 border border-cb-line-1 text-xs text-cb-fg-1 hover:text-cb-accent hover:border-cb-accent rounded-cb-1">abrir workspace</button>
            </div>
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-2">
            {tabs.map((tab, index) => (
              <OpenWorkspaceRow key={tab.workspacePath} tab={tab} index={index} panes={panes} onOpen={setActiveTab} onClose={closeTab} onUnlink={(path, tabIndex) => void unlink(path, tabIndex)} />
            ))}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between pb-2 border-b border-cb-line-1">
          <h2 className="cb-label">recentes · {recentOnly.length}</h2>
          <span className="text-2xs text-cb-fg-3">clique na linha para abrir</span>
        </div>

        <div className="mt-2 border border-cb-line-1 bg-cb-bg-1 rounded-cb-1 overflow-hidden">
          {loading ? (
            <div className="h-20 flex items-center justify-center gap-2 text-xs text-cb-fg-3"><LoaderCircle size={12} className="animate-spin" /> carregando workspaces…</div>
          ) : recentOnly.length === 0 ? (
            <div className="h-20 flex items-center justify-center text-xs text-cb-fg-3">Nenhum workspace recente fora dos abertos.</div>
          ) : recentOnly.map((path) => (
            <RecentWorkspaceRow key={path} path={path} onOpen={(item) => void openPath(item)} onUnlink={(item) => void unlink(item)} busy={unlinking !== null} />
          ))}
        </div>
      </div>
    </section>
  );
}
