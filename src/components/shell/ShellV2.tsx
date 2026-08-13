import React from "react";
import { RouterProvider, useRouter } from "../../lib/router";
import { useNavStore } from "../../stores/nav-store";
import { DashboardPage } from "../../views/home/DashboardPage";
import { SettingsPage } from "../../views/home/SettingsPage";
import { WorkspacesPage } from "../../views/home/WorkspacesPage";
import { ClarifyPrompt } from "../clarify/ClarifyPrompt";
import { ConversationPanel } from "../conversation/ConversationPanel";
import { SpecPanel } from "../spec/SpecPanel";
import { CronPanel } from "../cron/CronPanel";
import { MemoryPanel } from "../memory/MemoryPanel";
import { CommandPalette } from "../palette/CommandPalette";
import RecipeSuggestionPanel from "../recipe/RecipeSuggestionPanel";
import { RemotePlaybackPanel } from "../remote/RemotePlaybackPanel";
import { SessionHistoryPanel } from "../session/SessionHistoryPanel";
import { TasksSidebar } from "../tasks/TasksSidebar";
import { WorkspaceView } from "../workspace/WorkspaceView";
import { AgentRail } from "./AgentRail";
import { CommandBar } from "./CommandBar";
import { StatusBar } from "./StatusBar";

/* ═══════════════════════════════════════════════════════════════════════════
   SHELL V2 — TERMINAL-FIRST
   ═══════════════════════════════════════════════════════════════════════════

   O casco novo. Atrás da flag `shellV2`.

   Layout:

       ┌──────────────────────────────────────────────┐
       │ ❯ workspace          histórico    [Ctrl+K]   │  CommandBar
       ├────────┬─────────────────────────────────────┤
       │ rail   │                                     │
       │ de     │  conteúdo (grade de panes / home)   │
       │ agentes│                                     │
       ├────────┴─────────────────────────────────────┤
       │ 3 agentes · 1 trabalhando      normal  v1.15 │  StatusBar
       └──────────────────────────────────────────────┘

   O que muda em relação ao shell antigo:

   • O header de 15 ícones vira uma linha com caminho, histórico e busca.
   • Os agentes ganham uma coluna própria, com estado visível de relance.
   • Tudo que sumiu da barra continua alcançável — por nome — no Ctrl+K.

   O que **não** muda: o conteúdo. `WorkspaceView` e as páginas de home são
   reaproveitadas inteiras. Esta fase troca o cromo em volta, não os terminais
   — que são a parte que precisa continuar funcionando exatamente como antes.

   As abas de workspace continuam todas montadas, só escondidas por `display`.
   É o que preserva o processo de terminal de cada aba ao alternar entre elas;
   desmontar mataria os PTYs.
   ═══════════════════════════════════════════════════════════════════════════ */

function HomePages() {
  const { route } = useRouter();
  return (
    <div className="flex-1 flex overflow-hidden">
      {route === "/" && <DashboardPage />}
      {route === "/workspaces" && <WorkspacesPage />}
      {route === "/settings" && <SettingsPage />}
    </div>
  );
}

interface Props {
  appVersion: string | null;
}

export function ShellV2({ appVersion }: Props) {
  const onHome = useNavStore((state) => state.onHome);
  const tabs = useNavStore((state) => state.tabs) as {
    id?: string;
    workspacePath: string;
    view: unknown;
  }[];
  const activeTabIndex = useNavStore((state) => state.activeTabIndex);

  const showHome = onHome || tabs.length === 0;

  return (
    <RouterProvider>
      <div className="flex flex-col h-full bg-cb-bg-0 text-cb-fg-1 overflow-hidden">
        <CommandBar />

        <div className="flex flex-1 overflow-hidden">
          <AgentRail />

          <main className="flex-1 relative overflow-hidden" style={{ zIndex: 0 }}>
            <div
              className="absolute inset-0 flex flex-col"
              style={{ display: showHome ? "flex" : "none" }}
            >
              <HomePages />
            </div>

            {tabs.map((tab, index) => (
              <div
                key={tab.id ?? index}
                className="absolute inset-0 flex flex-col"
                style={{
                  display: !showHome && index === activeTabIndex ? "flex" : "none",
                }}
              >
                <WorkspaceView workspacePath={tab.workspacePath} view={tab.view} />
              </div>
            ))}

            {/* Painéis globais — continuam os mesmos componentes; no shell v2
                eles são abertos pelo palette em vez de por ícone no header. */}
            <TasksSidebar />
            <CronPanel />
            <RemotePlaybackPanel />
            <RecipeSuggestionPanel />
            <MemoryPanel />
            <SessionHistoryPanel />
            <ConversationPanel />
            <SpecPanel />
          </main>
        </div>

        <StatusBar appVersion={appVersion} />
      </div>

      <CommandPalette />
      <ClarifyPrompt />
    </RouterProvider>
  );
}
