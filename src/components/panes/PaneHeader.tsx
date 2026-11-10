import React from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, ExternalLink, MoreHorizontal, Pencil, X, XCircle } from "lucide-react";
import { CODEBRAIN_PANE_DRAG_TYPE } from "../../lib/pane-drag";
import { usePanesStore } from "../../stores/panes-store";
import { ElapsedTime, StatusGlyph } from "../shell/pane-status-glyph";
import { derivePaneActivity, activityPresentation, formatElapsed } from "../shell/pane-status";
import { PaneIdBadge } from "./PaneIdBadge";
import { PaneTitle } from "./PaneTitle";
import {
  cliIdentity,
  deliveryBadge,
  effortLabel,
  modelShortName,
  paneDisplayName,
  pathBasename,
  roleLabel,
  type DeliveryBadge,
} from "./pane-identity";

const DELIVERY_ICONS = { ok: Check, warn: AlertTriangle, danger: XCircle } as const;

function Delivery({ badge }: { badge: DeliveryBadge }) {
  const Icon = DELIVERY_ICONS[badge.tone];
  return (
    <span className="cb-delivery" data-tone={badge.tone} title={`Entrega: ${badge.text}`} aria-label={`Entrega: ${badge.text}`}>
      <Icon size={10} strokeWidth={2} aria-hidden />
      <span className="cb-delivery-text">{badge.text}</span>
    </span>
  );
}

interface MetaItem {
  key: string;
  text: string;
  title: string;
  color?: string;
}

/**
 * Metadados em ordem de prioridade: o que vem primeiro é o último a sumir,
 * porque a linha quebra da direita para a esquerda (ver terminal.css).
 */
function metaItems(pane: any, showCli: boolean): MetaItem[] {
  const cli = cliIdentity(pane.agent);
  const role = roleLabel(pane);
  const model = modelShortName(pane.model);
  const effort = effortLabel(pane.effort);
  const directory = pathBasename(pane.cwd);
  const items: (MetaItem | false | null | undefined | "")[] = [
    role && { key: "role", text: role, title: `Papel: ${role}`, color: "var(--cb-accent)" },
    showCli && { key: "cli", text: cli.label, title: `CLI: ${cli.label}`, color: cli.color },
    model && { key: "model", text: model, title: `Modelo: ${pane.model}` },
    effort && { key: "effort", text: effort, title: `Esforço: ${effort}` },
    pane.accountLabel && { key: "account", text: `@${pane.accountLabel}`, title: `Conta: ${pane.accountLabel}` },
    pane.taskType && { key: "task", text: `#${pane.taskType}`, title: `Tipo de tarefa: ${pane.taskType}` },
    directory && { key: "cwd", text: `${directory}/`, title: pane.cwd },
  ];
  return items.filter(Boolean) as MetaItem[];
}

function PaneDetails({
  pane,
  anchor,
  onClose,
  onRename,
  onDetach,
  onKill,
}: {
  pane: any;
  anchor: DOMRect;
  onClose: () => void;
  onRename: () => void;
  onDetach: () => void;
  onKill: () => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [position, setPosition] = React.useState({ left: anchor.right - 300, top: anchor.bottom + 4 });

  React.useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setPosition({
      left: Math.max(8, Math.min(anchor.right - box.width, window.innerWidth - box.width - 8)),
      top: anchor.bottom + box.height + 8 > window.innerHeight
        ? Math.max(8, anchor.top - box.height - 4)
        : anchor.bottom + 4,
    });
    ref.current?.focus();
  }, [anchor]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [onClose]);

  const activity = derivePaneActivity(pane);
  const presentation = activityPresentation(activity);
  const { name } = paneDisplayName(pane);
  const delivery = deliveryBadge(pane);
  const rows: [string, React.ReactNode][] = [
    ["estado", `${presentation.label}${presentation.ticking && pane.activitySince ? ` há ${formatElapsed(Date.now() - pane.activitySince)}` : ""}${pane.status === "hibernated" ? " (hibernado)" : ""}`],
    ["CLI", cliIdentity(pane.agent).label],
    ["modelo", pane.model],
    ["esforço", effortLabel(pane.effort)],
    ["conta", pane.accountLabel],
    ["tarefa", pane.taskType],
    ["papel", roleLabel(pane)],
    ["entrega", delivery?.text],
    ["pasta", pane.cwd],
  ];

  return createPortal(
    <div
      ref={ref}
      className="cb-pane-details cb-float"
      style={position}
      role="dialog"
      aria-label={`Detalhes de ${name}`}
      tabIndex={-1}
      data-pane-control
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <div className="cb-pane-details-title">
        <StatusGlyph activity={activity} />
        <span>{name}</span>
      </div>
      <dl>
        {rows.filter(([, value]) => value).map(([key, value]) => (
          <React.Fragment key={key}>
            <dt>{key}</dt>
            <dd>{value}</dd>
          </React.Fragment>
        ))}
        <dt>id</dt>
        <dd><PaneIdBadge paneId={pane.id} /></dd>
      </dl>
      <div className="cb-pane-details-actions">
        <button type="button" className="cb-menu-item" onClick={onRename}><Pencil size={11} aria-hidden />Renomear</button>
        <button type="button" className="cb-menu-item" onClick={onDetach}><ExternalLink size={11} aria-hidden />Destacar em nova janela</button>
        <button type="button" className="cb-menu-item" data-danger="true" onClick={onKill}><X size={11} aria-hidden />Encerrar terminal</button>
      </div>
    </div>,
    document.body,
  );
}

interface PaneHeaderProps {
  pane: any;
  onDetach: () => void;
  onKill: () => void;
  /** Devolve o foco ao terminal quando a edição do nome termina. */
  onRenameEnd?: () => void;
}

export function PaneHeader({ pane, onDetach, onKill, onRenameEnd }: PaneHeaderProps) {
  const renamePane = usePanesStore((state: any) => state.renamePane);
  const [editing, setEditing] = React.useState(false);
  const [detailsAnchor, setDetailsAnchor] = React.useState<DOMRect | null>(null);
  const detailsButton = React.useRef<HTMLButtonElement>(null);

  const activity = derivePaneActivity(pane);
  const presentation = activityPresentation(activity);
  const { isDefault } = paneDisplayName(pane);
  const delivery = deliveryBadge(pane);
  const items = metaItems(pane, !isDefault);

  const closeDetails = React.useCallback(() => {
    setDetailsAnchor(null);
    detailsButton.current?.focus();
  }, []);

  const finishRename = (value: string | null) => {
    setEditing(false);
    if (value !== null) renamePane(pane.id, value);
    onRenameEnd?.();
  };

  const stop = (event: React.SyntheticEvent) => event.stopPropagation();

  return (
    <div
      className="cb-pane-head"
      data-editing={editing}
      draggable={!editing}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(CODEBRAIN_PANE_DRAG_TYPE, pane.id);
      }}
    >
      <StatusGlyph activity={activity} />
      <span className="cb-pane-prompt" aria-hidden>❯</span>
      <PaneTitle
        pane={pane}
        editing={editing}
        onStartEdit={() => setEditing(true)}
        onFinishEdit={finishRename}
      />

      {!editing && (
        <div className="cb-pane-meta">
          {items.map((item) => (
            <span
              key={item.key}
              className="cb-pane-meta-item"
              title={item.title}
              style={item.color ? ({ "--cb-meta-color": item.color } as React.CSSProperties) : undefined}
            >
              {item.text}
            </span>
          ))}
        </div>
      )}

      <div className="cb-pane-right">
        {delivery && <Delivery badge={delivery} />}
        <span className="cb-pane-status" aria-live="polite">
          <span className="cb-pane-status-label" data-urgent={presentation.urgent}>{presentation.label}</span>
          <ElapsedTime since={pane.activitySince} ticking={presentation.ticking} />
        </span>
        <div className="cb-pane-actions" data-pane-control draggable={false} onDragStart={stop}>
          <button
            ref={detailsButton}
            type="button"
            className="cb-pane-action"
            aria-label="Detalhes do terminal"
            aria-haspopup="dialog"
            aria-expanded={Boolean(detailsAnchor)}
            title="Detalhes"
            onClick={(event) => {
              stop(event);
              setDetailsAnchor((current) => current ? null : event.currentTarget.getBoundingClientRect());
            }}
          >
            <MoreHorizontal size={13} strokeWidth={1.5} aria-hidden />
          </button>
          <button
            type="button"
            className="cb-pane-action cb-pane-detach"
            aria-label="Destacar terminal em nova janela"
            title="Destacar em nova janela"
            onClick={(event) => { stop(event); onDetach(); }}
          >
            <ExternalLink size={11} strokeWidth={1.5} aria-hidden />
          </button>
          <button
            type="button"
            className="cb-pane-action cb-pane-close"
            data-danger="true"
            aria-label="Encerrar terminal"
            title="Encerrar (Cmd+W)"
            onClick={(event) => { stop(event); onKill(); }}
          >
            <X size={13} strokeWidth={1.5} aria-hidden />
          </button>
        </div>
      </div>

      {detailsAnchor && (
        <PaneDetails
          pane={pane}
          anchor={detailsAnchor}
          onClose={closeDetails}
          onRename={() => { setDetailsAnchor(null); setEditing(true); }}
          onDetach={() => { setDetailsAnchor(null); onDetach(); }}
          onKill={() => { setDetailsAnchor(null); onKill(); }}
        />
      )}
    </div>
  );
}
