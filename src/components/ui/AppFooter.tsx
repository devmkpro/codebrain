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
    <footer className="h-9 shrink-0 relative">
      {/* Gradient accent line */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-violet-500/20 to-transparent" />
      <div className="h-full border-t border-white/[0.06] bg-gradient-to-r from-[#0B0B0E] via-[#0D0D14] to-[#0B0B0E] flex items-center px-6 justify-between text-[10px] font-mono text-slate-500 uppercase tracking-[0.15em]">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_6px_rgba(16,185,129,0.4)]" />
            <span className="font-bold bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent">Encrypted</span>
          </div>
          {folderName && <span className="text-slate-400 hover:text-slate-300 transition-colors cursor-default">{folderName}</span>}
          {activePanes > 0 && (
            <span className="text-emerald-400/70 flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-emerald-400/80" />
              {activePanes} running
            </span>
          )}
        </div>
        <div className="flex gap-5 items-center">
          {appZoom !== 1 && <span className="text-yellow-400/70 bg-yellow-400/8 px-1.5 py-0.5 rounded">zoom {(appZoom * 100).toFixed(0)}%</span>}
          <span className={`${theme === 'light' ? 'text-sky-600 bg-sky-50' : 'text-slate-400'} px-1.5 py-0.5 rounded`}>
            {theme === 'light' ? 'light' : 'dark'}
          </span>
          <span className="text-slate-500">© 2026 CODEBRAIN</span>
        </div>
      </div>
    </footer>
  );
}
