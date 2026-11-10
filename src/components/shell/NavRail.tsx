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
  ChevronLeft,
  DollarSign,
  Server,
} from "lucide-react";
import { usePanesStore } from "../../stores/panes-store";
import { useShellStore } from "../../stores/shell-store";
import { derivePaneActivity, activityPresentation } from "./pane-status";
import { ElapsedTime, StatusGlyph } from "./pane-status-glyph";
import { cliIdentity, groupPanesForRail, modelShortName, paneDisplayName, roleLabel } from "../panes/pane-identity";
import { usePaneRuntime } from "../panes/pane-runtime";
import { useConversationStore } from "../../stores/conversation-store";
import { usePaneLauncherStore } from "../../stores/pane-launcher-store";
import { useCronStore } from "../../stores/cron-store";
import { useMemoryStore } from "../../stores/memory-store";
import { useSessionHistoryStore } from "../../stores/session-history-store";
import { useTasksStore } from "../../stores/tasks-store";
import { useCostStore } from "../../stores/cost-store";
import { useRouter } from "../../lib/router";
import { navigateHome } from "./shell-navigation";
import { CODEBRAIN_PANE_DRAG_TYPE } from "../../lib/pane-drag";

/* ═══════════════════════════════════════════════════════════════════════════
   NAV RAIL — ATTOS-STYLE DUAL-COLUMN SIDEBAR
   ═══════════════════════════════════════════════════════════════════════════

   Tira de ícones (48px) + painel de panes (196px colapsável). Cada pane é
   nome primeiro, estado depois, CLI por último; ajudantes ficam pendurados no
   piloto. Estado e glifo vêm de pane-status, os mesmos do header do terminal.

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
  label?: string;
  model?: string;
  role?: string;
  parentPaneId?: string;
  registryMissionId?: string;
  activitySince?: number;
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
  depth,
  last,
  onSelect,
  onConversation,
  onClose,
  onDragStart,
  onDragEnd,
  dragging,
}: {
  pane: PaneLike;
  active: boolean;
  depth: number;
  last: boolean;
  onSelect: () => void;
  onConversation: () => void;
  onClose: () => void;
  onDragStart: (event: React.DragEvent<HTMLLIElement>) => void;
  onDragEnd: () => void;
  dragging: boolean;
}) {
  const activity = derivePaneActivity(pane);
  const presentation = activityPresentation(activity);
  const { name, isDefault } = paneDisplayName(pane);
  const role = roleLabel(pane);
  const cli = cliIdentity(pane.agent).label;
  const model = modelShortName(pane.model);
  const secondary = [role, isDefault ? null : cli, model].filter(Boolean).join(" · ");

  return (
    <li
      title={`${name}\n${presentation.label}${secondary ? ` · ${secondary}` : ""}\nArraste sobre outro pane para dividir a tela`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="cb-agent-row group"
      data-active={active}
      data-urgent={presentation.urgent}
      data-dragging={dragging}
      data-depth={depth}
      data-last={last}
      style={{ "--cb-status-color": presentation.color } as React.CSSProperties}
    >
      {depth > 0 && <span className="cb-agent-guide" aria-hidden />}
      <button
        type="button"
        onClick={onSelect}
        className="cb-agent-main"
        aria-current={active ? "true" : undefined}
        aria-label={`${name}, ${presentation.label}${secondary ? `, ${secondary}` : ""}`}
      >
        <span className="cb-agent-line">
          <StatusGlyph activity={activity} />
          <span className="cb-agent-name" data-default={isDefault}>{name}</span>
        </span>
        <span className="cb-agent-sub">
          <span className="cb-agent-state" data-urgent={presentation.urgent}>{presentation.label}</span>
          <ElapsedTime since={pane.activitySince} ticking={presentation.ticking} />
          {secondary && <span className="cb-agent-cli">{secondary}</span>}
        </span>
      </button>

      <span className="cb-agent-actions" data-pane-action>
        <button
          type="button"
          data-pane-action
          draggable={false}
          onClick={onConversation}
          className="cb-agent-action"
          aria-label={`Conversar com ${name}`}
          title="Abrir conversa"
        >
          <MessageSquare size={11} aria-hidden />
        </button>
        <button
          type="button"
          data-pane-action
          draggable={false}
          onClick={onClose}
          className="cb-agent-action"
          data-danger="true"
          aria-label={`Encerrar ${name}`}
          title="Encerrar agente"
        >
          <X size={11} aria-hidden />
        </button>
      </span>
    </li>
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
    closeAll,
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
  usePaneRuntime();

  const panes = usePanesStore((state) => state.panes) as PaneLike[];
  const activePaneId = usePanesStore((state) => state.activePaneId);
  const setActive = usePanesStore((state) => state.setActive);
  const removePane = usePanesStore((state) => state.removePane);

  const panelCollapsed = useShellStore((state) => state.railCollapsed);
  const toggleRail = useShellStore((state) => state.toggleRail);

  const openConversation = useConversationStore((state) => state.openFor);
  const openPaneLauncher = usePaneLauncherStore((state) => state.show);

  const { navigate, route, query } = useRouter();
  const { open: openOverlay, active: overlayActive, closeAll } = useOverlayMutex();

  const [draggingPaneId, setDraggingPaneId] = React.useState<string | null>(null);

  // Quem precisa do usuário vence o badge: é a contagem que importa de relance.
  const { waitingCount, workingCount } = React.useMemo(() => {
    let waiting = 0;
    let working = 0;
    for (const pane of panes) {
      const activity = derivePaneActivity(pane);
      if (activity === "waiting") waiting++;
      if (activity === "thinking" || activity === "running") working++;
    }
    return { waitingCount: waiting, workingCount: working };
  }, [panes]);
  const rows = React.useMemo(() => groupPanesForRail(panes), [panes]);

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
    (event: React.DragEvent<HTMLLIElement>, pane: PaneLike) => {
      if ((event.target as HTMLElement).closest("[data-pane-action]")) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(CODEBRAIN_PANE_DRAG_TYPE, pane.id);
      event.dataTransfer.setData("text/plain", paneDisplayName(pane).name);
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
        className="flex flex-col items-center py-2 shrink-0 bg-cb-bg-1 border-r border-cb-line-0"
        style={{ width: "var(--cb-nav-strip-width)" }}
      >
        <nav className="flex flex-col items-center gap-0.5 flex-1" aria-label="Seções">
          <NavIconButton
            icon={<LayoutDashboard size={16} strokeWidth={1.5} />}
            label="Início"
            active={!anyOverlayActive && (route === "/" || route === "")}
            onClick={() => { closeAll(); navigateHome(); }}
          />

          <NavIconButton
            icon={<Terminal size={16} strokeWidth={1.5} />}
            label={`Agentes (${panes.length})`}
            active={!panelCollapsed}
            badge={waitingCount > 0 ? waitingCount : workingCount > 0 ? workingCount : undefined}
            badgeVariant={waitingCount > 0 ? "warn" : "accent"}
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
          <NavIconButton
            icon={<Server size={16} strokeWidth={1.5} />}
            label="SSH e máquinas"
            active={!anyOverlayActive && route === "/central" && query.s === "acessos"}
            onClick={() => { closeAll(); navigate("/central", { query: { s: "acessos" } }); }}
          />
        </nav>

        <div
          className="w-5 h-px mb-1"
          style={{ background: "var(--cb-line-0)" }}
          aria-hidden
        />

        <NavIconButton
          icon={<span className="text-sm font-bold leading-none" aria-hidden>❯</span>}
          label="Central"
          active={!anyOverlayActive && route === "/central" && query.s !== "acessos"}
          onClick={() => { closeAll(); navigate("/central"); }}
        />

        <NavIconButton
          icon={<Settings size={16} strokeWidth={1.5} />}
          label="Configurações"
          active={!anyOverlayActive && route === "/settings"}
          onClick={() => { closeAll(); navigate("/settings"); }}
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
          {waitingCount > 0 && (
            <span
              className="cb-agent-waiting"
              role="status"
              aria-label={`${waitingCount} aguardando você`}
              title={`${waitingCount} aguardando você`}
            >
              {waitingCount}
            </span>
          )}
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

        <div className="cb-scroll flex-1 py-1 px-1">
          {panes.length === 0 ? (
            <p className="cb-agent-empty">
              <b>nenhum terminal</b>
              <kbd className="cb-kbd">Ctrl T</kbd> abre um.
            </p>
          ) : (
            <ul className="cb-agent-list" aria-label="Terminais">
              {rows.map(({ pane, depth, last }) => (
                <AgentRow
                  key={pane.id}
                  pane={pane}
                  active={pane.id === activePaneId}
                  depth={depth}
                  last={last}
                  onSelect={() => setActive(pane.id)}
                  onConversation={() => openConversation(pane.id)}
                  onClose={() => closePane(pane.id)}
                  onDragStart={(e) => startPaneDrag(e, pane)}
                  onDragEnd={() => setDraggingPaneId(null)}
                  dragging={draggingPaneId === pane.id}
                />
              ))}
            </ul>
          )}
        </div>

        <button
          type="button"
          onClick={openPaneLauncher}
          aria-label="Novo terminal"
          title="Novo terminal — Ctrl+T"
          className="flex items-center gap-2 h-cell-lg px-3 border-t border-cb-line-0 text-cb-fg-2 hover:text-cb-accent hover:bg-cb-bg-2 shrink-0"
        >
          <Plus size={13} strokeWidth={1.5} />
          <span className="text-xs">novo terminal</span>
        </button>
      </div>
    </aside>
  );
}
