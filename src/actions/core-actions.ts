import {
  type Action,
  registerActions,
} from "../lib/actions";
import { navigate } from "../lib/router";
import { useCronStore } from "../stores/cron-store";
import { useMemoryStore } from "../stores/memory-store";
import { useModalsStore } from "../stores/modals-store";
import { useNavStore } from "../stores/nav-store";
import { usePanesStore } from "../stores/panes-store";
import { useRecipeStore } from "../stores/recipe-store";
import { useRemoteBridgeStore } from "../stores/remote-bridge-store";
import { useSessionHistoryStore } from "../stores/session-history-store";
import { useTasksStore } from "../stores/tasks-store";
import { useTerminalSettings } from "../stores/terminal-settings-store";
import { useSpecStore } from "../stores/spec-store";
import { useWorkspaceStore } from "../stores/workspace-store";

/* ═══════════════════════════════════════════════════════════════════════════
   AÇÕES DO NÚCLEO
   ═══════════════════════════════════════════════════════════════════════════

   Tudo que hoje só existe como ícone sem rótulo no AppHeader, declarado como
   ação pesquisável.

   Cada entrada aqui é uma capacidade que antes exigia saber onde clicar.
   Cron, Recipes, Remote Playback e Histórico de Sessão, por exemplo, são
   painéis completos alcançáveis por exatamente um botão de 15px — e quem não
   sabe que existem não os encontra. Com `keywords`, eles passam a ser
   achados pelo nome, pelo sinônimo em inglês e pelo termo da MCP tool.

   Registrado uma vez, no boot do renderer.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Caminho do workspace ativo, ou undefined quando na home. */
function activeWorkspace(): string | undefined {
  const nav = useNavStore.getState();
  return nav.tabs[nav.activeTabIndex]?.workspacePath;
}

function inWorkspace(): boolean {
  const nav = useNavStore.getState();
  return !nav.onHome && nav.tabs.length > 0;
}

const coreActions: Action[] = [
  /* ── Agentes ───────────────────────────────────────────────────────── */
  {
    id: "pane.new",
    title: "Novo pane",
    subtitle: "Abre um terminal com o agente preferido",
    group: "agentes",
    keywords: ["terminal", "spawn", "agente", "aba", "new pane", "pane_spawn"],
    shortcut: ["Ctrl", "T"],
    icon: "Terminal",
    priority: 100,
    run: () => {
      const cwd = activeWorkspace();
      usePanesStore.getState().addPane({
        agent: "openclaude",
        cwd,
        workspacePath: cwd,
      });
    },
  },
  {
    id: "pane.close",
    title: "Fechar pane ativo",
    group: "agentes",
    keywords: ["kill", "encerrar", "matar", "close"],
    shortcut: ["Ctrl", "W"],
    icon: "X",
    dangerous: true,
    enabled: () => usePanesStore.getState().activePaneId !== null,
    run: () => {
      const { activePaneId, removePane } = usePanesStore.getState();
      if (!activePaneId) return;
      window.codeBrainApp?.pty.kill(activePaneId);
      removePane(activePaneId);
    },
  },
  {
    id: "squad.wizard",
    title: "Montar squad",
    subtitle: "Orquestrador + workers especializados",
    group: "agentes",
    keywords: ["squad", "time", "equipe", "orquestrador", "worker", "multi-agente"],
    icon: "Users",
    priority: 80,
    run: () => useModalsStore.getState().setShowSquadWizard(true),
  },
  {
    id: "squad.libre",
    title: "Libre Mode",
    subtitle: "Vários panes de uma vez, entre providers",
    group: "agentes",
    keywords: ["libre", "lote", "batch", "vários", "paralelo"],
    icon: "Zap",
    run: () => useModalsStore.getState().setShowLibreWizard(true),
  },
  {
    id: "providers.open",
    title: "Providers",
    subtitle: "Chaves de API, modelos e templates",
    group: "agentes",
    keywords: ["provider", "modelo", "api key", "anthropic", "gemini", "mimo", "openclaude"],
    icon: "Cpu",
    priority: 70,
    run: () => useModalsStore.getState().openProviders("list"),
  },

  /* ── Navegação ─────────────────────────────────────────────────────── */
  {
    id: "nav.home",
    title: "Ir para a home",
    group: "navegação",
    keywords: ["início", "dashboard", "home"],
    icon: "Home",
    priority: 50,
    run: () => {
      useNavStore.getState().goHome();
      navigate("/");
    },
  },
  {
    id: "nav.workspaces",
    title: "Workspaces",
    group: "navegação",
    keywords: ["projeto", "pasta", "repositório", "workspace"],
    icon: "FolderOpen",
    run: () => {
      useNavStore.getState().goHome();
      navigate("/workspaces");
    },
  },
  {
    id: "nav.settings",
    title: "Configurações",
    group: "navegação",
    keywords: ["settings", "preferências", "opções", "ajustes"],
    icon: "Settings",
    priority: 40,
    run: () => {
      useNavStore.getState().goHome();
      navigate("/settings");
    },
  },

  /* ── Painéis ────────────────────────────────────────────────────────
     Este grupo é o motivo de o palette existir: cada um destes painéis é
     alcançável hoje por um único ícone sem rótulo.                        */
  {
    id: "panel.memory",
    title: "Memória",
    subtitle: "Memória compartilhada entre os agentes",
    group: "painéis",
    keywords: ["memory", "lembrar", "conhecimento", "memory_search", "sqlite"],
    icon: "Database",
    priority: 30,
    run: () => useMemoryStore.getState().toggle(),
  },
  {
    id: "panel.tasks",
    title: "Tarefas",
    subtitle: "Kanban compartilhado do squad",
    group: "painéis",
    keywords: ["task", "kanban", "todo", "backlog", "task_list"],
    icon: "ListTodo",
    priority: 30,
    run: () => useTasksStore.getState().toggle(),
  },
  {
    id: "panel.cron",
    title: "Cron",
    subtitle: "Tarefas autônomas agendadas",
    group: "painéis",
    keywords: ["cron", "agendar", "schedule", "periódico", "automático", "job"],
    icon: "Clock",
    run: () => useCronStore.getState().toggle(),
  },
  {
    id: "panel.recipes",
    title: "Recipes",
    subtitle: "O que dá para construir com este workspace",
    group: "painéis",
    keywords: ["recipe", "receita", "sugestão", "ideias", "o que fazer"],
    icon: "UtensilsCrossed",
    run: () => useRecipeStore.getState().toggle(),
  },
  {
    id: "panel.history",
    title: "Histórico de sessões",
    group: "painéis",
    keywords: ["histórico", "history", "sessão", "anterior", "retomar"],
    icon: "History",
    run: () => useSessionHistoryStore.getState().toggle(),
  },
  {
    id: "panel.remote",
    title: "Remote Playback",
    subtitle: "Controlar o Codebrain pelo celular",
    group: "painéis",
    keywords: ["remote", "celular", "mobile", "controle", "pareamento", "bridge"],
    icon: "Smartphone",
    run: () => useRemoteBridgeStore.getState().toggle(),
  },

  /* ── Workspace ─────────────────────────────────────────────────────── */
  {
    id: "workspace.open",
    title: "Abrir workspace…",
    subtitle: "Seleciona uma pasta e troca para ela",
    group: "workspace",
    keywords: ["abrir pasta", "trocar workspace", "projeto", "repositório"],
    shortcut: ["Ctrl", "O"],
    icon: "FolderPlus",
    priority: 60,
    run: async () => {
      const selected = await window.codeBrainApp.workspace.open();
      if (!selected) return;
      useWorkspaceStore.getState().setPath(selected);
      useNavStore.getState().openWorkspace(selected);
      await Promise.allSettled([
        window.codeBrainApp.workspace.set(selected),
        window.codeBrainApp.workspaces.touch(selected),
      ]);
    },
  },
  {
    id: "workspace.files",
    title: "Arquivos",
    group: "workspace",
    keywords: ["files", "árvore", "explorer", "pasta"],
    icon: "FolderTree",
    enabled: inWorkspace,
    run: () => useNavStore.getState().navigateInActiveTab({ kind: "files" }),
  },
  {
    id: "workspace.map",
    title: "Mapa da sessão",
    subtitle: "Topologia dos agentes e quem falou com quem",
    group: "workspace",
    keywords: ["map", "mapa", "topologia", "grafo", "sessão"],
    icon: "Map",
    enabled: inWorkspace,
    run: () => useNavStore.getState().navigateInActiveTab({ kind: "map" }),
  },
  {
    id: "workspace.specs",
    title: "Spec Kit",
    subtitle: "Especificar → planejar → decompor → implementar",
    group: "workspace",
    keywords: ["spec", "specify", "plan", "tasks", "requisitos", "feature"],
    icon: "FileCode2",
    enabled: inWorkspace,
    run: () => useSpecStore.getState().toggle(),
  },

  /* ── Aparência ─────────────────────────────────────────────────────── */
  {
    id: "appearance.theme",
    title: "Alternar tema claro/escuro",
    group: "aparência",
    keywords: ["tema", "theme", "claro", "escuro", "dark", "light"],
    icon: "Sun",
    run: () => {
      const settings = useTerminalSettings.getState() as {
        theme: string;
        setTheme?: (value: string) => void;
      };
      settings.setTheme?.(settings.theme === "light" ? "dark" : "light");
    },
  },
  {
    id: "appearance.zoom.in",
    title: "Aumentar zoom da interface",
    group: "aparência",
    keywords: ["zoom", "ampliar", "maior"],
    shortcut: ["Ctrl", "+"],
    run: () => useTerminalSettings.getState().increaseAppZoom(),
  },
  {
    id: "appearance.zoom.out",
    title: "Diminuir zoom da interface",
    group: "aparência",
    keywords: ["zoom", "reduzir", "menor"],
    shortcut: ["Ctrl", "-"],
    run: () => useTerminalSettings.getState().decreaseAppZoom(),
  },
  {
    id: "appearance.zoom.reset",
    title: "Restaurar zoom",
    group: "aparência",
    keywords: ["zoom", "resetar", "100%"],
    shortcut: ["Ctrl", "0"],
    run: () => {
      const settings = useTerminalSettings.getState();
      settings.resetAppZoom();
      settings.resetFontSize();
    },
  },

  /* ── Sistema ───────────────────────────────────────────────────────── */
  {
    id: "system.diagnostics",
    title: "Diagnóstico",
    subtitle: "Estado do MCP, providers e CLIs",
    group: "sistema",
    keywords: ["diagnóstico", "diagnostics", "saúde", "health", "debug", "problema"],
    icon: "Activity",
    run: () => useModalsStore.getState().setShowDiag(true),
  },
  {
    id: "system.perfhud",
    title: "HUD de performance",
    subtitle: "Memória e CPU por pane",
    group: "sistema",
    keywords: ["performance", "perf", "hud", "memória", "cpu", "rss"],
    shortcut: ["Ctrl", "Shift", "M"],
    icon: "Activity",
    run: () => useModalsStore.getState().togglePerfHUD(),
  },
  {
    id: "system.reload",
    title: "Recarregar a interface",
    group: "sistema",
    keywords: ["reload", "recarregar", "refresh", "atualizar"],
    icon: "RotateCcw",
    run: () => window.codeBrainApp?.app.reloadShell().catch(() => {}),
  },
];

/**
 * Registra as ações do núcleo. Chamado uma vez no boot do renderer.
 * Devolve a função de remoção, por simetria — na prática só o HMR usa.
 */
export function registerCoreActions(): () => void {
  return registerActions(...coreActions);
}
