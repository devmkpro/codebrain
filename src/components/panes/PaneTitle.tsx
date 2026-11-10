import React from "react";
import { paneDisplayName } from "./pane-identity";

interface PaneTitleProps {
  pane: { agent?: string; title?: string; label?: string };
  editing?: boolean;
  onStartEdit?: () => void;
  /** `null` cancela; string (mesmo vazia) é o nome confirmado. */
  onFinishEdit?: (name: string | null) => void;
}

/**
 * O nome do pane — o objetivo dele, o elemento principal do header.
 * Duplo clique, Enter ou F2 editam; Esc desiste; sair do campo confirma.
 */
export function PaneTitle({ pane, editing = false, onStartEdit, onFinishEdit }: PaneTitleProps) {
  const { name, isDefault } = paneDisplayName(pane);
  const finishedRef = React.useRef(false);

  if (editing) {
    finishedRef.current = false;
    const finish = (value: string | null) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      onFinishEdit?.(value);
    };
    return (
      <input
        className="cb-pane-name-input"
        defaultValue={isDefault ? "" : name}
        placeholder="objetivo deste terminal"
        aria-label="Nome do terminal"
        data-pane-control
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onBlur={(event) => finish(event.currentTarget.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") finish(event.currentTarget.value);
          if (event.key === "Escape") finish(null);
        }}
      />
    );
  }

  if (!onStartEdit) {
    return <span className="cb-pane-name" data-default={isDefault} title={name}>{name}</span>;
  }

  return (
    <span
      className="cb-pane-name"
      data-default={isDefault}
      data-pane-control
      role="button"
      tabIndex={0}
      title={`${name} — duplo clique para renomear`}
      aria-label={`${name}. Renomear terminal`}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onStartEdit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === "F2") {
          event.preventDefault();
          event.stopPropagation();
          onStartEdit();
        }
      }}
    >
      {name}
    </span>
  );
}
