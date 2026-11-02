import React from "react";
import {
  LayoutDashboard,
  Terminal,
  CheckSquare,
  History,
  Brain,
  Timer,
  Settings,
  Plus,
  X,
  MessageSquare,
  GripVertical,
  ChevronLeft,
  DollarSign,
} from "lucide-react";
import { usePanesStore } from "../../stores/panes-store";
import { useShellStore } from "../../stores/shell-store";
import { statusPresentation, toPaneStatus } from "./pane-status";
import { useConversationStore } from "../../stores/conversation-store";
import { usePaneLauncherStore } from "../../stores/pane-launcher-store";
import { useCronStore } from "../../stores/cron-store";
import { useMemoryStore } from "../../stores/memory-store";
import { useSessionHistoryStore } from "../../stores/session-history-store";
import { useTasksStore } from "../../stores/tasks-store";
import { useCostStore } from "../../stores/cost-store";
import { useRouter } from "../../lib/router";
import { CODEBRAIN_PANE_DRAG_TYPE } from "../../lib/pane-drag";

/* ═══════════════════════════════════════════════════════════════════════════
   NAV RAIL — ATTOS-STYLE DUAL-COLUMN SIDEBAR
   ═══════════════════════════════════════════════════════════════════════════

   Tira de ícones (48px) + painel de panes (196px colapsável).

   MUTEX: abrir qualquer painel overlay (Tasks, Cron, Memory, Sessions)
   fecha os demais — painéis têm z-20 fixo e não se empilham visualmente.
   ═══════════════════════════════════════════════════════════════════════════ */

type OverlayPanel = "tasks" | "cron" | "memory" | "sessions" | "cost";

interface PaneLike {
  id: string;
  agent?: string;
  title?: string;
  status?: string;
  kind?: string;
  cwd?: string;
}

// ── Ícone de nav ─────────────────────────────────────────────────────────────

interface NavIconButtonProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  badge?: number;
  badgeVariant?: "accent" | "danger" | "warn";
  onClick: () => void;
}

function NavIconButton({
  icon,
  label,
  active,
  badge,
  badgeVariant = "accent",
  onClick,
}: NavIconButtonProps) {
  const badgeColor =
    badgeVariant === "danger"
      ? "var(--cb-danger)"
      : badgeVariant === "warn"
        ? "var(--cb-warn)"
        : "var(--cb-accent)";

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      data-active={active ? "true" : undefined}
      className="cb-nav-icon"
    >
      {icon}
      {badge != null && badge > 0 && (
        <span
          className="cb-nav-badge"
          style={{ background: badgeColor }}
          aria-hidden
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}

// ── Linha de pane ─────────────────────────────────────────────────────────────

function AgentRow({
  pane,
  active,
  onSelect,
  onConversation,
  onClose,
  onDragStart,
  onDragEnd,
  dragging,
}: {
  pane: PaneLike;
  active: boolean;
  onSelect: () => void;
  onConversation: () => void;
  onClose: () => void;
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  dragging: boolean;
}) {
  const presentation = statusPresentation(pane.status);
  const label = pane.title || pane.agent || "shell";

  return (
    <div
      role="option"
      aria-selected={active}
      aria-grabbed={dragging}
      aria-label={`${label} — ${presentation.label}`}
      title="Arraste para dividir a tela"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`cb-row cb-rail w-full text-left h-cell group cursor-grab active:cursor-grabbing ${dragging ? "opacity-40" : ""}`}
      style={
        {
          "--cb-rail-color": active ? "var(--cb-accent)" : presentation.color,
        } as React.CSSProperties
      }
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex flex-1 min-w-0 items-center gap-2"
        aria-label={`${label} — ${presentation.label}`}
      >
        <span
          className="cb-dot"
          data-pulse={presentation.pulse}
          style={{ "--cb-dot-color": presentation.color } as React.CSSProperties}
          aria-hidden
        />
        <span className="flex-1 min-w-0 truncate text-xs">{label}</span>
      </button>

      <GripVertical size={10} className="text-cb-fg-3 shrink-0" aria-hidden />
      <span className="text-2xs text-cb-fg-3 shrink-0 tabular-nums">
        {pane.id.slice(0, 4)}
      </span>
      <button
        type="button"
        data-pane-action
        draggable={false}
        onClick={onConversation}
        className="opacity-0 group-hover:opacity-100 text-cb-fg-3 hover:text-cb-accent"
        aria-label={`Conversar com ${label}`}
        title="Abrir conversa"
      >
        <MessageSquare size={11} />
      </button>
      <button
        type="button"
        data-pane-action
        draggable={false}
        onClick={onClose}
        className="opacity-60 group-hover:opacity-100 text-cb-fg-2 hover:text-cb-danger"
        aria-label={`Encerrar ${label}`}
        title="Encerrar agente"
      >
        <X size={11} />
      </button>
    </div>
  );
}

// ── Hook: mutex de painéis overlay ────────────────────────────────────────────

function useOverlayMutex() {
  const toggleTasks = useTasksStore((s: any) => s.toggle);
  const toggleCron = useCronStore((s) => s.toggle);
  const toggleMemory = useMemoryStore((s) => s.toggle);
  const toggleSessions = useSessionHistoryStore((s) => s.toggle);
  const toggleCost = useCostStore((s) => s.toggle);

  const taskVisible = useTasksStore((s: any) => s.visible as boolean);
  const cronVisible = useCronStore((s) => s.visible);
  const memoryVisible = useMemoryStore((s) => s.visible);
  const sessionsVisible = useSessionHistoryStore((s) => s.visible);
  const costVisible = useCostStore((s) => s.visible);

  const closeAll = React.useCallback(
    (except?: OverlayPanel) => {
      if (except !== "tasks" && taskVisible) toggleTasks();
      if (except !== "cron" && cronVisible) toggleCron();
      if (except !== "memory" && memoryVisible) toggleMemory();
      if (except !== "sessions" && sessionsVisible) toggleSessions();
      if (except !== "cost" && costVisible) toggleCost();
    },
    [taskVisible, cronVisible, memoryVisible, sessionsVisible, costVisible,
     toggleTasks, toggleCron, toggleMemory, toggleSessions, toggleCost],
  );

  const open = React.useCallback(
    (panel: OverlayPanel) => {
      const isOpen =
        panel === "tasks" ? taskVisible :
        panel === "cron" ? cronVisible :
        panel === "memory" ? memoryVisible :
        panel === "sessions" ? sessionsVisible :
        costVisible;

      if (isOpen) {
        // Já aberto → fecha
        if (panel === "tasks") toggleTasks();
        else if (panel === "cron") toggleCron();
        else if (panel === "memory") toggleMemory();
        else if (panel === "sessions") toggleSessions();
        else toggleCost();
      } else {
        // Fecha todos os outros, abre o alvo
        closeAll(panel);
        if (panel === "tasks") toggleTasks();
        else if (panel === "cron") toggleCron();
        else if (panel === "memory") toggleMemory();
        else if (panel === "sessions") toggleSessions();
        else toggleCost();
      }
    },
    [taskVisible, cronVisible, memoryVisible, sessionsVisible, costVisible,
     toggleTasks, toggleCron, toggleMemory, toggleSessions, toggleCost, closeAll],
  );

  return {
    open,
    active: {
      tasks: taskVisible,
      cron: cronVisible,
      memory: memoryVisible,
      sessions: sessionsVisible,
      cost: costVisible,
    },
  };
}

// ── NavRail ───────────────────────────────────────────────────────────────────

export function NavRail() {
  const panes = usePanesStore((state) => state.panes) as PaneLike[];
  const activePaneId = usePanesStore((state) => state.activePaneId);
  const setActive = usePanesStore((state) => state.setActive);
  const removePane = usePanesStore((state) => state.removePane);

  const panelCollapsed = useShellStore((state) => state.railCollapsed);
  const toggleRail = useShellStore((state) => state.toggleRail);

  const openConversation = useConversationStore((state) => state.openFor);
  const openPaneLauncher = usePaneLauncherStore((state) => state.show);

  const { navigate, route } = useRouter();
  const { open: openOverlay, active: overlayActive } = useOverlayMutex();

  const [draggingPaneId, setDraggingPaneId] = React.useState<string | null>(null);

  // Contagem de panes ativos para badge no ícone de agentes.
  const runningCount = React.useMemo(() => {
    return panes.filter((p) => {
      const s = toPaneStatus(p.status);
      return s === "running" || s === "booting";
    }).length;
  }, [panes]);

  // Contagem de tarefas pendentes para badge no ícone Tasks.
  const taskCount = useTasksStore((s: any) => (s.list as unknown[])?.length ?? 0);

  const closePane = React.useCallback(
    (paneId: string) => {
      void window.codeBrainApp?.pty.kill(paneId);
      removePane(paneId);
      const conv = useConversationStore.getState();
      if (conv.paneId === paneId) conv.close();
    },
    [removePane],
  );

  const startPaneDrag = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>, pane: PaneLike) => {
      if ((event.target as HTMLElement).closest("[data-pane-action]")) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(CODEBRAIN_PANE_DRAG_TYPE, pane.id);
      event.dataTransfer.setData("text/plain", pane.title || pane.agent || "agente");
      setDraggingPaneId(pane.id);
    },
    [],
  );

  const anyOverlayActive =
    overlayActive.tasks || overlayActive.cron || overlayActive.memory ||
    overlayActive.sessions || overlayActive.cost;

  return (
    <aside aria-label="Navegação" className="flex min-h-0 shrink-0">
      {/* ── Tira de ícones (48px) ───────────────────────────────────────── */}
      <div
        className="cb-glass flex flex-col items-center py-2 shrink-0"
        style={{ width: "var(--cb-nav-strip-width)" }}
      >
        <nav className="flex flex-col items-center gap-0.5 flex-1" aria-label="Seções">
          <NavIconButton
            icon={<LayoutDashboard size={16} strokeWidth={1.5} />}
            label="Início"
            active={!anyOverlayActive && (route === "/" || route === "")}
            onClick={() => { navigate("/"); }}
          />

          <NavIconButton
            icon={<Terminal size={16} strokeWidth={1.5} />}
            label={`Agentes (${panes.length})`}
            active={!panelCollapsed}
            badge={runningCount > 0 ? runningCount : undefined}
            onClick={toggleRail}
          />

          <NavIconButton
            icon={<CheckSquare size={16} strokeWidth={1.5} />}
            label="Tarefas"
            active={overlayActive.tasks}
            badge={taskCount > 0 ? taskCount : undefined}
            onClick={() => openOverlay("tasks")}
          />

          <NavIconButton
            icon={<History size={16} strokeWidth={1.5} />}
            label="Sessões"
            active={overlayActive.sessions}
            onClick={() => openOverlay("sessions")}
          />

          <NavIconButton
            icon={<Brain size={16} strokeWidth={1.5} />}
            label="Memória"
            active={overlayActive.memory}
            onClick={() => openOverlay("memory")}
          />

          <NavIconButton
            icon={<Timer size={16} strokeWidth={1.5} />}
            label="Cron"
            active={overlayActive.cron}
            onClick={() => openOverlay("cron")}
          />

          <NavIconButton
            icon={<DollarSign size={16} strokeWidth={1.5} />}
            label="Custos / Uso"
            active={overlayActive.cost}
            onClick={() => openOverlay("cost")}
          />
        </nav>

        <div
          className="w-5 h-px mb-1"
          style={{ background: "var(--cb-glass-border)" }}
          aria-hidden
        />

        <NavIconButton
          icon={<Settings size={16} strokeWidth={1.5} />}
          label="Configurações"
          active={!anyOverlayActive && route === "/settings"}
          onClick={() => { navigate("/settings"); }}
        />
      </div>

      {/* ── Painel de panes (196px, colapsável) ────────────────────────── */}
      <div
        className="flex flex-col min-h-0 shrink-0 bg-cb-bg-1 border-r border-cb-line-0 transition-[width,opacity] overflow-hidden"
        style={{
          width: panelCollapsed ? "0px" : "var(--cb-nav-panel-width)",
          opacity: panelCollapsed ? 0 : 1,
          pointerEvents: panelCollapsed ? "none" : undefined,
          transitionDuration: "var(--cb-duration-normal)",
          transitionTimingFunction: "var(--cb-ease)",
        }}
        aria-hidden={panelCollapsed}
      >
        <div className="flex items-center h-cell-lg px-2 border-b border-cb-line-0 shrink-0">
          <span className="cb-label flex-1 truncate">
            agentes · {panes.length}
          </span>
          <button
            type="button"
            onClick={toggleRail}
            aria-label="Recolher painel"
            title="Recolher"
            className="p-1 text-cb-fg-3 hover:text-cb-fg-1 rounded-cb-1"
          >
            <ChevronLeft size={13} />
          </button>
        </div>

        <div className="cb-scroll flex-1 py-1 px-1" role="listbox" aria-label="Panes">
          {panes.length === 0 ? (
            <p className="px-3 py-4 text-2xs text-cb-fg-3 leading-relaxed">
              Nenhum agente.{" "}
              <span className="text-cb-fg-2">Ctrl+T</span> abre um.
            </p>
          ) : (
            panes.map((pane) => (
              <AgentRow
                key={pane.id}
                pane={pane}
                active={pane.id === activePaneId}
                onSelect={() => setActive(pane.id)}
                onConversation={() => openConversation(pane.id)}
                onClose={() => closePane(pane.id)}
                onDragStart={(e) => startPaneDrag(e, pane)}
                onDragEnd={() => setDraggingPaneId(null)}
                dragging={draggingPaneId === pane.id}
              />
            ))
          )}
        </div>

        <button
          type="button"
          onClick={openPaneLauncher}
          aria-label="Novo pane"
          title="Novo pane — Ctrl+T"
          className="flex items-center gap-2 h-cell-lg px-3 border-t border-cb-line-0 text-cb-fg-2 hover:text-cb-accent hover:bg-cb-bg-2 shrink-0"
        >
          <Plus size={13} strokeWidth={1.5} />
          <span className="text-xs">+ pane</span>
        </button>
      </div>
    </aside>
  );
}
