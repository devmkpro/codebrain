import React from "react";
import type { Resource } from "./api";

/* Peças repetidas pelas seis seções. Mesmo cabeçalho, mesmos estados e mesmos
   controles fazem a Central ler como um instrumento só. */

export function Prompt() {
  return (
    <span className="cbc-prompt" aria-hidden>
      ❯
    </span>
  );
}

export function SectionHead({
  title,
  lead,
  actions,
}: {
  title: string;
  lead?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="cbc-head">
      <h2>
        <Prompt /> {title}
      </h2>
      {lead && <p className="cbc-lead">{lead}</p>}
      {actions && <div className="cbc-actions">{actions}</div>}
    </header>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "accent" | "danger" | "ghost" };

export const Btn = React.forwardRef<HTMLButtonElement, BtnProps>(function Btn({ tone, type, ...props }, ref) {
  return <button ref={ref} type={type ?? "button"} data-tone={tone} className="cbc-btn" {...props} />;
});

export function Tag({ color, children, title }: { color?: string; children: React.ReactNode; title?: string }) {
  return (
    <span className="cbc-tag" title={title} style={color ? ({ "--cbc-tag": color } as React.CSSProperties) : undefined}>
      {children}
    </span>
  );
}

export function Dot({ color, pulse }: { color: string; pulse?: boolean }) {
  return <span className="cb-dot" data-pulse={pulse ? "true" : undefined} style={{ "--cb-dot-color": color } as React.CSSProperties} aria-hidden />;
}

/** O que você ganha e o que arrisca, em uma linha. */
export function Tradeoff({ gain, risk }: { gain: string; risk: string }) {
  return (
    <p className="cbc-tradeoff">
      <span className="cbc-gain">ganha</span> {gain} <span aria-hidden>·</span> <span className="cbc-risk">arrisca</span> {risk}
    </p>
  );
}

export function Field({
  label,
  htmlFor,
  gain,
  risk,
  hint,
  wide,
  children,
}: {
  label: string;
  htmlFor?: string;
  gain?: string;
  risk?: string;
  hint?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`cbc-field${wide ? " cbc-field-wide" : ""}`}>
      <label className="cb-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {gain && risk && <Tradeoff gain={gain} risk={risk} />}
      {hint && <p className="cbc-tradeoff">{hint}</p>}
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function Select({
  value,
  onChange,
  options,
  ...props
}: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> & {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
}) {
  return (
    <select className="cbc-control" value={value} onChange={(event) => onChange(event.target.value)} {...props}>
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** Multi-escolha por chips. Itens fora das opções continuam visíveis para poder sair. */
export function ChipPicker({
  value,
  options,
  onChange,
  disabled,
  label,
  emptyHint,
}: {
  value: string[];
  options: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  label: string;
  emptyHint?: string;
}) {
  const all = [...new Set([...value, ...options])];
  if (!all.length) return <p className="cbc-tradeoff">{emptyHint ?? "Nada para escolher."}</p>;
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
      {all.map((option) => {
        const on = value.includes(option);
        return (
          <button
            key={option}
            type="button"
            className="cbc-chip"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(on ? value.filter((item) => item !== option) : [...value, option])}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

export function StateMessage({
  title,
  text,
  color,
  children,
  role,
}: {
  title: string;
  text?: React.ReactNode;
  color?: string;
  children?: React.ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <div className="cbc-state" role={role}>
      <p className="cbc-state-line">
        <span style={{ color: color ?? "var(--cb-accent)" }} aria-hidden>
          ❯
        </span>
        <span>{title}</span>
      </p>
      {text && <p className="cbc-state-text">{text}</p>}
      {children && <div className="cbc-actions">{children}</div>}
    </div>
  );
}

export function Skeleton({ lines = 6, label }: { lines?: number; label: string }) {
  const widths = ["62%", "88%", "45%", "74%", "53%", "81%", "38%", "67%"];
  return (
    <div className="cbc-sk" role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className="cbc-sk-line" style={{ width: widths[index % widths.length] }} />
      ))}
    </div>
  );
}

/** Os estados que não são "pronto" são iguais em toda tela. */
export function Gate<T>({
  resource,
  noun,
  children,
}: {
  resource: Resource<T>;
  noun: string;
  children: (data: T) => React.ReactNode;
}) {
  if (resource.state === "loading") return <Skeleton label={`Carregando ${noun}`} />;
  if (resource.state === "unavailable") {
    return (
      <StateMessage
        title="Ainda não disponível nesta versão"
        text={`Esta instalação do Codebrain não entrega ${noun}. Atualize o app e volte aqui.`}
        color="var(--cb-warn)"
        role="status"
      />
    );
  }
  if (resource.state === "error" || resource.data === undefined) {
    return (
      <StateMessage title={`Não deu para carregar ${noun}`} text={resource.error ?? undefined} color="var(--cb-danger)" role="alert">
        <Btn onClick={resource.reload}>tentar de novo</Btn>
      </StateMessage>
    );
  }
  return (
    <>
      {resource.stale && (
        <div className="cbc-banner" data-tone="warn" role="status">
          <span>A última atualização falhou. O que você vê pode estar atrasado.</span>
          <Btn tone="ghost" onClick={resource.reload}>
            atualizar
          </Btn>
        </div>
      )}
      {children(resource.data)}
    </>
  );
}

/** Confirmação na própria linha, sem modal: dois cliques, o segundo diz o que faz. */
export function ConfirmInline({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
}: {
  message: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => cancelRef.current?.focus(), []);
  return (
    <div className="cbc-banner" data-tone="danger" role="alertdialog" aria-label="Confirmar">
      <span className="flex-1 min-w-0">{message}</span>
      <Btn ref={cancelRef} onClick={onCancel} disabled={busy}>
        cancelar
      </Btn>
      <Btn tone="danger" onClick={onConfirm} disabled={busy}>
        {busy ? "apagando…" : confirmLabel}
      </Btn>
    </div>
  );
}

/** Setas movem entre linhas de lista; Enter e clique continuam nativos do botão. */
export function listArrowNav(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const current = event.target as HTMLElement;
  if (!current.matches("[data-list-item]")) return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-list-item]")];
  const next = items[items.indexOf(current) + (event.key === "ArrowDown" ? 1 : -1)];
  if (next) {
    event.preventDefault();
    next.focus();
  }
}
