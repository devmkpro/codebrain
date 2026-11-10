import React from "react";
import { RELEASES } from "./releases-data";
import { CodebrainMark } from "../ui/AppLogo";
import { Button, Prompt } from "../ui/primitives";

/** Sem animação quando o SO ou a preferência do app pedem. */
function motionIsReduced(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
    || document.documentElement.classList.contains("reduced-motion");
}

function reveal(on: boolean): React.CSSProperties {
  return {
    opacity: on ? 1 : 0,
    transition: "opacity var(--cb-duration-normal) var(--cb-ease)",
  };
}

// ─── Typewriter animation hook ───────────────────────────────────────────────

function useTypewriter(text: string, speed = 40, delay = 0, active = true) {
  const [displayed, setDisplayed] = React.useState("");
  React.useEffect(() => {
    if (!active) { setDisplayed(""); return; }
    if (motionIsReduced()) { setDisplayed(text); return; }
    setDisplayed("");
    let i = 0;
    let cancelled = false;
    const timeout = setTimeout(() => {
      const interval = setInterval(() => {
        if (cancelled) { clearInterval(interval); return; }
        i++;
        setDisplayed(text.slice(0, i));
        if (i >= text.length) clearInterval(interval);
      }, speed);
    }, delay);
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [text, speed, delay, active]);
  return displayed;
}

// ─── Chat message component ──────────────────────────────────────────────────

const CHECK = String.fromCodePoint(0x2713);
const EN_DASH = String.fromCodePoint(0x2014);
const LDQUO = String.fromCodePoint(0x201C);
const RDQUO = String.fromCodePoint(0x201D);

function ChatLine({
  role, text, delay, active
}: {
  role: "user" | "assistant";
  text: string;
  delay: number;
  active: boolean;
}) {
  const displayed = useTypewriter(text, 30, delay, active);
  const isDone = displayed.length === text.length;

  if (role === "user") {
    return (
      <div className="text-sm leading-relaxed text-cb-fg-0" style={reveal(active)}>
        <Prompt>{text}</Prompt>
      </div>
    );
  }

  return (
    <div className="text-sm leading-relaxed text-cb-fg-1 whitespace-pre-wrap" style={reveal(active)}>
      {displayed}
      {active && !isDone && <span className="cb-caret" aria-hidden />}
    </div>
  );
}

// ─── Demo text constants (built with String.fromCodePoint for safety) ─────────

const A_ACUTE = String.fromCodePoint(0xE1);
const I_ACUTE = String.fromCodePoint(0xED);

const DEMO1_TEXT = `${LDQUO}ol${A_ACUTE}${RDQUO}`;
const DEMO1_RESPONSE =
  `Ol${A_ACUTE}! Em que posso ajudar?` +
  `

${CHECK} 15.757 tokens de entrada` +
  `
${CHECK} 16 de sa${I_ACUTE}da` +
  `
${CHECK} 1 turn`;

const DEMO2_TEXT = `${LDQUO}e quanto custava antes?${RDQUO}`;
const DEMO2_RESPONSE =
  `188.631 de entrada ${EN_DASH} 534 de sa${I_ACUTE}da ${EN_DASH} 3 turns` +
  `

Agora ${CHECK} 12x menor que a 1.20` +
  `
${CHECK} 3x menor que o Claude Code puro`;

/**
 * Input tokens for one greeting, measured with the CLI's own usage field
 * (Opus 5, same prompt, same machine). Bar widths are relative to the worst
 * case so the drop is legible at a glance.
 */
const COST_ROWS = [
  { label: `Codebrain 1.20`, value: "188.631", percent: 100, color: "var(--cb-danger)" },
  { label: `Claude Code puro`, value: "51.408", percent: 27, color: "var(--cb-fg-2)" },
  { label: `Codebrain 1.21`, value: "15.757", percent: 8, color: "var(--cb-success)" },
];

const FEATURES = [
  "Saudação não gasta mais 3 chamadas: agora é 1",
  "12 ferramentas no boot; as outras 197 sob demanda",
  "Orquestrador não recebe mais ferramentas de edição",
  "Novo botão + time: squad multi-IA já configurado",
  "Busca em todos os seletores de modelo",
];

// ─── Main modal ──────────────────────────────────────────────────────────────

export function WhatsNewModal({
  open,
  onClose,
  currentVersion,
}: {
  open: boolean;
  onClose: () => void;
  currentVersion?: string | null;
}) {
  const [phase, setPhase] = React.useState(0); // 0=enter, 1=demos, 2=tag+features, 4=cta

  React.useEffect(() => {
    if (!open) {
      setPhase(0);
      return;
    }
    if (motionIsReduced()) {
      setPhase(4);
      return;
    }
    // Stagger content phases, slow enough to read.
    const t1 = setTimeout(() => setPhase(1), 300);
    const t2 = setTimeout(() => setPhase(2), 4500);
    const t4 = setTimeout(() => setPhase(4), 7000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t4); };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4 bg-cb-scrim"
      style={{ zIndex: "var(--cb-z-modal)" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        className="w-[620px] max-w-full max-h-full flex flex-col overflow-hidden bg-cb-overlay border border-cb-line-2 rounded-cb-2 shadow-cb-modal"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 h-11 shrink-0 px-4 border-b border-cb-line-0">
          <CodebrainMark size={20} />
          <span className="cb-label text-cb-accent">novidades</span>
          <button type="button" onClick={onClose} aria-label="Fechar" className="cb-btn cb-btn--ghost cb-btn--sm cb-btn--icon ml-auto">
            <span aria-hidden>{String.fromCodePoint(0x2715)}</span>
          </button>
        </header>

        <div className="cb-scroll flex-1 min-h-0 px-6 py-5 space-y-5">
          <div>
            <h2 id="whats-new-title" className="text-xl font-bold text-cb-fg-0">
              3&#215; mais barato que o Claude Code
            </h2>
            <p className="mt-1 text-base text-cb-fg-1 leading-relaxed">
              O mesmo trabalho com um terço dos tokens, medido na API, não estimado.
            </p>
          </div>

          {/* Demos: o próprio terminal contando a história. */}
          <div className="bg-cb-bg-inset border border-cb-line-0 rounded-cb-1 p-4 space-y-3 min-h-[188px]">
            <ChatLine role="user" text={DEMO1_TEXT} delay={500} active={phase >= 1} />
            <ChatLine role="assistant" text={DEMO1_RESPONSE} delay={1200} active={phase >= 1} />
            <div style={reveal(phase >= 2)} className="space-y-3">
              <ChatLine role="user" text={DEMO2_TEXT} delay={0} active={phase >= 2} />
              <ChatLine role="assistant" text={DEMO2_RESPONSE} delay={600} active={phase >= 2} />
            </div>
          </div>

          {/* Comparação de custo: a manchete desta versão. */}
          <section style={reveal(phase >= 2)}>
            <div className="cb-rule">
              <h3 className="cb-label">custo de um {LDQUO}ol{A_ACUTE}{RDQUO}</h3>
            </div>
            <p className="mt-1 text-sm text-cb-fg-2">Tokens de entrada por turno, mesma pergunta e mesmo modelo.</p>
            <div className="mt-3 space-y-1.5">
              {COST_ROWS.map((row) => (
                <div key={row.label} className="grid grid-cols-[minmax(0,130px)_minmax(0,1fr)_64px] items-center gap-3">
                  <span className="text-sm text-cb-fg-1 truncate">{row.label}</span>
                  <div className="h-3 bg-cb-bg-3">
                    <div
                      className="h-full"
                      style={{
                        width: phase >= 2 ? `${row.percent}%` : "0%",
                        background: row.color,
                        transition: "width 400ms var(--cb-ease)",
                      }}
                    />
                  </div>
                  <span className="text-sm font-medium text-right tabular-nums" style={{ color: row.color }}>{row.value}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm text-cb-fg-2 leading-relaxed">
              O ganho veio de parar de enviar schemas de ferramentas que o agente nunca usa, e de nunca gastar um turno extra numa saudação.
            </p>
          </section>

          <ul className="space-y-1" style={reveal(phase >= 2)}>
            {FEATURES.map((feature) => (
              <li key={feature} className="flex items-baseline gap-2 text-sm text-cb-fg-1">
                <span className="text-cb-success shrink-0" aria-hidden>{CHECK}</span>
                {feature}
              </li>
            ))}
          </ul>

          <p className="text-sm text-cb-fg-2 leading-relaxed" style={reveal(phase >= 4)}>
            Nada foi removido: as 197 ferramentas restantes continuam a um
            <code className="cb-code mx-1">enable_tool_group</code>
            de distância.
          </p>
        </div>

        <footer className="flex items-center justify-between gap-3 shrink-0 px-6 py-3 border-t border-cb-line-0">
          {currentVersion ? <span className="text-xs text-cb-fg-2 tabular-nums">Codebrain v{currentVersion}</span> : <span />}
          <Button variant="primary" onClick={onClose}>entendi</Button>
        </footer>
      </div>
    </div>
  );
}

// ─── Exported constants (kept for backwards compat) ──────────────────────────

export const LATEST_RELEASE_VERSION = RELEASES[0]?.version ?? "";

export function formatDuration(ms: number): string {
  if (ms < 0) return EN_DASH;
  const s = Math.floor(ms / 1e3);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
