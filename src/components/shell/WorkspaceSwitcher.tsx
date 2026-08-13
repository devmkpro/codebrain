import React from "react";
import { Check, ChevronDown, FolderOpen, FolderPlus, LayoutGrid, LoaderCircle, Search, Unlink, X } from "lucide-react";
import { navigate } from "../../lib/router";
import { useNavStore } from "../../stores/nav-store";
import { useWorkspaceStore } from "../../stores/workspace-store";

function basename(path: string): string {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? path;
}

function normalized(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

export function WorkspaceSwitcher() {
  const tabs = useNavStore((state) => state.tabs) as Array<{ workspacePath: string }>;
  const activeIndex = useNavStore((state) => state.activeTabIndex);
  const onHome = useNavStore((state) => state.onHome);
  const openWorkspace = useNavStore((state) => state.openWorkspace);
  const setActiveTab = useNavStore((state) => state.setActiveTab);
  const closeTab = useNavStore((state) => state.closeTab);
  const goHome = useNavStore((state) => state.goHome);
  const setWorkspacePath = useWorkspaceStore((state) => state.setPath);

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [recents, setRecents] = React.useState<string[]>([]);
  const [unlinking, setUnlinking] = React.useState<string | null>(null);
  const [unlinkError, setUnlinkError] = React.useState<string | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const current = !onHome ? tabs[activeIndex]?.workspacePath : undefined;

  const loadRecents = React.useCallback(async () => {
    try {
      const result = await window.codeBrainApp.workspaces.recent();
      setRecents(Array.isArray(result) ? result : []);
    } catch {
      setRecents([]);
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    void loadRecents();
    searchRef.current?.focus();
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, loadRecents]);

  const activate = React.useCallback(async (path: string) => {
    setWorkspacePath(path);
    openWorkspace(path);
    setOpen(false);
    setQuery("");
    try {
      await Promise.all([
        window.codeBrainApp.workspace.set(path),
        window.codeBrainApp.workspaces.touch(path),
      ]);
    } catch {
      // A navegação local continua válida mesmo se a persistência falhar.
    }
  }, [openWorkspace, setWorkspacePath]);

  const chooseFolder = async () => {
    const selected = await window.codeBrainApp.workspace.open();
    if (selected) await activate(selected);
  };

  const unlink = async (path: string, tabIndex?: number) => {
    if (unlinking) return;
    setUnlinking(path);
    setUnlinkError(null);
    try {
      const result = await window.codeBrainApp.workspaces.remove(path);
      if (!result.ok) throw new Error(result.error || "Não foi possível desvincular o workspace");
      if (tabIndex !== undefined) closeTab(tabIndex);
      setRecents((items) => items.filter((item) => normalized(item) !== normalized(path)));
    } catch (error) {
      setUnlinkError(error instanceof Error ? error.message : "Não foi possível desvincular o workspace");
    } finally {
      setUnlinking(null);
    }
  };

  const openedPaths = new Set(tabs.map((tab) => normalized(tab.workspacePath)));
  const recentOnly = recents.filter((path) => !openedPaths.has(normalized(path)));
  const matches = (path: string) => {
    const needle = normalized(query.trim());
    return !needle || normalized(path).includes(needle) || basename(path).toLowerCase().includes(needle);
  };
  const openMatches = tabs.map((tab, index) => ({ path: tab.workspacePath, index })).filter((item) => matches(item.path));
  const recentMatches = recentOnly.filter(matches);

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1 app-region-no-drag">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="group flex items-center gap-2 min-w-0 max-w-full h-cell px-2 -ml-2 rounded-cb-1 hover:bg-cb-bg-2 border border-transparent hover:border-cb-line-1"
        title="Trocar workspace"
      >
        <span className="text-cb-accent text-sm select-none shrink-0" aria-hidden>❯</span>
        {current ? (
          <>
            <span className="text-sm font-semibold text-cb-fg-0 truncate">{basename(current)}</span>
            <span className="text-2xs text-cb-fg-3 truncate hidden md:inline">{current}</span>
          </>
        ) : <span className="text-sm text-cb-fg-2">selecionar workspace</span>}
        <ChevronDown size={12} className={`shrink-0 text-cb-fg-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] w-[min(460px,calc(100vw-24px))] bg-cb-bg-1 border border-cb-line-2 rounded-cb-1 shadow-2xl overflow-hidden" style={{ zIndex: "var(--cb-z-popover)" }} role="dialog" aria-label="Trocar workspace">
          <div className="flex items-center gap-2 p-2 border-b border-cb-line-0">
            <Search size={12} className="text-cb-fg-3" />
            <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar workspace por nome ou caminho…" className="flex-1 bg-transparent text-xs text-cb-fg-0 outline-none placeholder:text-cb-fg-3" />
            {query && <button onClick={() => setQuery("")} aria-label="Limpar busca" className="text-cb-fg-3 hover:text-cb-fg-0"><X size={12} /></button>}
          </div>
          {unlinkError && <div role="alert" className="px-3 py-2 text-2xs text-cb-danger bg-cb-danger-wash border-b border-cb-line-0">{unlinkError}</div>}

          <div className="cb-scroll max-h-[min(460px,70vh)] overflow-auto py-1">
            {openMatches.length > 0 && <div className="cb-label px-3 py-1.5">abertos · {openMatches.length}</div>}
            {openMatches.map(({ path, index }) => (
              <div key={path} className="group flex items-center hover:bg-cb-bg-2">
                <button onClick={() => { setActiveTab(index); void activate(path); }} className="cb-row min-w-0 flex-1 text-left pl-3 pr-1 py-2">
                  <FolderOpen size={13} className={normalized(path) === normalized(current ?? "") ? "text-cb-accent" : "text-cb-fg-3"} />
                  <span className="min-w-0 flex-1"><span className="block text-xs text-cb-fg-0 truncate">{basename(path)}</span><span className="block text-2xs text-cb-fg-3 truncate">{path}</span></span>
                  {normalized(path) === normalized(current ?? "") && <Check size={12} className="text-cb-success" />}
                </button>
                <button type="button" onClick={() => void unlink(path, index)} disabled={unlinking !== null} className="mx-2 p-1.5 rounded-cb-1 text-cb-fg-2 hover:text-cb-danger hover:bg-cb-danger-wash disabled:opacity-40" title="Desvincular da lista — não apaga arquivos" aria-label={`Desvincular ${basename(path)}`}>
                  {normalized(unlinking ?? "") === normalized(path) ? <LoaderCircle size={12} className="animate-spin" /> : <Unlink size={12} />}
                </button>
              </div>
            ))}

            {recentMatches.length > 0 && <div className="cb-label px-3 pt-3 pb-1.5 border-t border-cb-line-0 mt-1">recentes · {recentMatches.length}</div>}
            {recentMatches.map((path) => (
              <div key={path} className="group flex items-center hover:bg-cb-bg-2">
                <button onClick={() => void activate(path)} className="cb-row min-w-0 flex-1 text-left pl-3 pr-1 py-2">
                  <FolderOpen size={13} className="text-cb-fg-3" />
                  <span className="min-w-0 flex-1"><span className="block text-xs text-cb-fg-0 truncate">{basename(path)}</span><span className="block text-2xs text-cb-fg-3 truncate">{path}</span></span>
                </button>
                <button type="button" onClick={() => void unlink(path)} disabled={unlinking !== null} className="mx-2 p-1.5 rounded-cb-1 text-cb-fg-2 hover:text-cb-danger hover:bg-cb-danger-wash disabled:opacity-40" title="Desvincular da lista — não apaga arquivos" aria-label={`Desvincular ${basename(path)}`}>
                  {normalized(unlinking ?? "") === normalized(path) ? <LoaderCircle size={12} className="animate-spin" /> : <Unlink size={12} />}
                </button>
              </div>
            ))}
            {openMatches.length === 0 && recentMatches.length === 0 && <p className="px-3 py-5 text-xs text-cb-fg-3 text-center">Nenhum workspace encontrado.</p>}
          </div>

          <div className="grid grid-cols-2 border-t border-cb-line-1">
            <button onClick={() => void chooseFolder()} className="flex items-center justify-center gap-2 h-cell-lg text-xs text-cb-fg-1 hover:bg-cb-bg-2 hover:text-cb-accent"><FolderPlus size={13} /> abrir pasta…</button>
            <button onClick={() => { goHome(); navigate("/workspaces"); setOpen(false); }} className="flex items-center justify-center gap-2 h-cell-lg text-xs text-cb-fg-1 hover:bg-cb-bg-2 hover:text-cb-accent border-l border-cb-line-1"><LayoutGrid size={13} /> gerenciar</button>
          </div>
        </div>
      )}
    </div>
  );
}
