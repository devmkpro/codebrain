import React from "react";
import { ChevronRight } from "lucide-react";

/** Cabeçalho de bloco à moda TUI: rótulo embutido numa linha, com contador. */
export function SectionRule({ label, count, tone, children, className }: {
  label: React.ReactNode;
  count?: React.ReactNode;
  /** Classe de cor do rótulo, como `text-cb-warn`. */
  tone?: string;
  /** Ações à direita da régua. */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`cb-rule ${className ?? ""}`}>
      <h2 className={`cb-label shrink-0 ${tone ?? ""}`}>{label}</h2>
      {count !== undefined && <span className="text-xs text-cb-fg-2 tabular-nums shrink-0">{count}</span>}
      {children && <div data-rule-end className="flex items-center gap-2 shrink-0">{children}</div>}
    </div>
  );
}

/** Seção recolhível. Controlada: quem usa decide o que está aberto. */
export function Section({ id, icon, title, badge, open, onToggle, children }: {
  id?: string;
  icon?: React.ReactNode;
  title: React.ReactNode;
  badge?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="cb-section" id={id}>
      <button type="button" className="cb-section__head" aria-expanded={open} onClick={onToggle}>
        {icon && <span className="text-cb-fg-2 shrink-0" aria-hidden>{icon}</span>}
        <span className="cb-section__title">{title}</span>
        {badge}
        <ChevronRight size={14} className="cb-section__chevron" aria-hidden />
      </button>
      {open && <div className="cb-section__body">{children}</div>}
    </section>
  );
}

/** Linha de ajuste: rótulo e ajuda à esquerda, controle à direita. */
export function SettingRow({ label, description, children }: {
  label: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="cb-setting">
      <div className="cb-setting__text">
        <div className="cb-setting__label">{label}</div>
        {description && <div className="cb-setting__help">{description}</div>}
      </div>
      <div className="cb-setting__control">{children}</div>
    </div>
  );
}
