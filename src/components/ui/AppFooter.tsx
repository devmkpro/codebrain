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
    <footer className="h-9 border-t border-white/5 bg-[#0B0B0E] flex items-center px-6 justify-between text-[10px] font-mono text-slate-600 uppercase tracking-[0.15em] shrink-0">
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-2 text-[#4F46E5]">
          <div className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
          <span className="font-bold">Encrypted</span>
        </div>
        {folderName && <span className="text-slate-700">{folderName}</span>}
        {activePanes > 0 && (
          <span className="text-emerald-500/60">{activePanes} running</span>
        )}
      </div>
      <div className="flex gap-5 items-center">
        {appZoom !== 1 && <span className="text-yellow-500/60">zoom {(appZoom * 100).toFixed(0)}%</span>}
        <span className={theme === 'light' ? 'text-sky-400/60' : 'text-slate-700'}>
          {theme === 'light' ? 'light' : 'dark'}
        </span>
        <span>© 2026 CODEBRAIN</span>
      </div>
    </footer>
  );
}
