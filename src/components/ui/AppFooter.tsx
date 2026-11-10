import { useNavStore } from '../../stores/nav-store';
import { usePanesStore } from '../../stores/panes-store';
import { useTerminalSettings } from '../../stores/terminal-settings-store';

export function AppFooter() {
  const onHome   = useNavStore(s => s.onHome);
  const tabs     = useNavStore(s => s.tabs) as any[];
  const panes    = usePanesStore(s => s.panes) as any[];
  const appZoom  = useTerminalSettings(s => s.appZoom);
  const theme    = useTerminalSettings(s => s.theme);

  const activeTab       = !onHome ? tabs[useNavStore.getState().activeTabIndex] : undefined;
  const activeWorkspace = activeTab?.workspacePath as string | undefined;
  const folderName      = activeWorkspace?.split(/[\\/]/).filter(Boolean).pop() ?? '';
  const activePanes     = panes.filter(p => p.status === 'running').length;

  return (
    <footer className="h-cell shrink-0 flex items-center justify-between gap-5 px-3 border-t border-cb-line-0 bg-cb-bg-1 text-xs text-cb-fg-2 whitespace-nowrap overflow-hidden">
      <div className="flex items-center gap-4 min-w-0">
        {folderName && <span className="text-cb-fg-1 truncate">{folderName}</span>}
        {activePanes > 0 && <span className="text-cb-agent-running">{activePanes} em execução</span>}
      </div>
      <div className="flex items-center gap-4 shrink-0">
        {appZoom !== 1 && <span className="text-cb-warn">zoom {(appZoom * 100).toFixed(0)}%</span>}
        <span>{theme === 'light' ? 'claro' : 'escuro'}</span>
        <span>© 2026 codebrain</span>
      </div>
    </footer>
  );
}
