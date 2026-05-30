import React from 'react';
import { RouterProvider, useRouter } from '../../lib/router';
import { AppHeader }     from './AppHeader';
import { AppFooter }     from './AppFooter';
import { DashboardPage } from '../../views/home/DashboardPage';
import { WorkspacesPage } from '../../views/home/WorkspacesPage';
import { LogsPage }      from '../../views/home/LogsPage';
import { SettingsPage }  from '../../views/home/SettingsPage';
import { WorkspaceView } from '../workspace/WorkspaceView';
import { TasksSidebar }  from '../tasks/TasksSidebar';
import { MemoryPanel }   from '../memory/MemoryPanel';
import { UsageSidebar }  from '../settings/UsageSidebar';
import { SessionHistoryPanel } from '../session/SessionHistoryPanel';
import { WhatsNewModal } from '../navigation/WhatsNewModal';
import { useNavStore }   from '../../stores/nav-store';

interface Props {
  whatsNewOpen: boolean;
  closeWhatsNew: () => void;
  appVersion: string | null;
  workspaceToast: string | null;
}

function HomePages() {
  const { route } = useRouter();
  return (
    <div className="flex-1 flex overflow-hidden">
      {route === '/'           && <DashboardPage />}
      {route === '/workspaces' && <WorkspacesPage />}
      {route === '/logs'       && <LogsPage />}
      {route === '/settings'   && <SettingsPage />}
    </div>
  );
}

export function AppShell({ whatsNewOpen, closeWhatsNew, appVersion, workspaceToast }: Props) {
  const onHome       = useNavStore(s => s.onHome);
  const tabs         = useNavStore(s => s.tabs) as any[];
  const activeTabIdx = useNavStore(s => s.activeTabIndex);

  return (
    <RouterProvider>
      <div className="flex flex-col bg-[#0B0B0E] text-slate-200 overflow-hidden" style={{ height: '100%', background: 'linear-gradient(180deg, #0F0F13 0%, #0B0B0E 100%)' }}>

        {/*
          ── HEADER ────────────────────────────────────────────────────────────
          z-index: 200 no wrapper garante que os menus `fixed` do AppHeader
          (dropdowns, modais) apareçam acima da área de conteúdo (z-index: 0).
          Sem esse isolamento o stacking context do conteúdo poderia cobrir
          os menus mesmo com z-[10000].
        */}
        <div className="relative shrink-0" style={{ zIndex: 200 }}>
          <AppHeader />
        </div>

        {/*
          ── CONTEÚDO ──────────────────────────────────────────────────────────
          z-index: 0 deixa o conteúdo abaixo do header.
          As views são absolute inset-0 dentro deste container.
        */}
        <div className="flex-1 overflow-hidden relative" style={{ zIndex: 0 }}>

          {/* Home / Dashboard */}
          <div
            className="absolute inset-0 flex flex-col"
            style={{ display: onHome || tabs.length === 0 ? 'flex' : 'none' }}
          >
            <HomePages />
          </div>

          {/* Workspace tabs (mantidos no DOM para preservar terminais) */}
          {tabs.map((tab: any, i: number) => (
            <div
              key={tab.id ?? i}
              className="absolute inset-0 flex flex-col"
              style={{ display: !onHome && i === activeTabIdx ? 'flex' : 'none' }}
            >
              <WorkspaceView workspacePath={tab.workspacePath} view={tab.view} />
            </div>
          ))}

          <TasksSidebar />
          <MemoryPanel />
          <UsageSidebar />
          <SessionHistoryPanel />
        </div>

        <AppFooter />
      </div>

      {/* Modais globais (fora do stacking context do conteúdo) */}
      <WhatsNewModal open={whatsNewOpen} onClose={closeWhatsNew} currentVersion={appVersion} />

      {workspaceToast && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-[9999] animate-in fade-in zoom-in-95 duration-200">
          <div className="px-5 py-3 bg-[#0c0c14]/95 border border-violet-500/20 rounded-xl shadow-[0_0_30px_rgba(139,92,246,0.15)] backdrop-blur-md">
            <span className="font-mono text-[13px] font-bold text-slate-200 tracking-wide">
              {workspaceToast}
            </span>
          </div>
        </div>
      )}
    </RouterProvider>
  );
}
