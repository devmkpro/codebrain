import { Plus, SquareTerminal } from "lucide-react";
import { usePaneLauncherStore } from "../../stores/pane-launcher-store";

export function WorkspaceEmptyState() {
  const openPaneLauncher = usePaneLauncherStore(state => state.show);

  return (
    <div className="flex-1 flex items-center justify-center select-none bg-cb-bg-0">
      <div className="flex w-full max-w-[420px] flex-col items-center px-6 text-center">
        <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-cb-2 border border-cb-line-1 bg-cb-bg-1 text-cb-fg-2">
          <SquareTerminal size={18} strokeWidth={1.5} />
        </div>
        <p className="text-sm font-bold text-cb-fg-0">Nenhum agente aberto</p>
        <p className="mt-2 max-w-sm text-xs leading-relaxed text-cb-fg-2">
          Abra um pane, escolha o provider e depois um modelo compatível.
        </p>
        <button
          type="button"
          onClick={openPaneLauncher}
          className="mt-5 inline-flex h-cell-lg items-center gap-2 rounded-cb-1 border border-cb-accent-dim bg-cb-accent-wash-strong px-4 text-xs font-bold text-cb-accent-bright transition-colors hover:bg-cb-accent-wash focus-visible:outline-none"
        >
          <Plus size={13} strokeWidth={2} />
          pane
        </button>
        <p className="mt-4 text-2xs text-cb-fg-3">
          ou pressione <kbd className="cb-kbd ml-1">Ctrl T</kbd>
        </p>
      </div>
    </div>
  );
}
