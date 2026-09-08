import React from "react";
import { RELEASES } from "./releases-data";
import { useRouter } from "../../lib/router";

// ─── Icons (inline SVGs to avoid external deps) ─────────────────────────────

function XIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function CheckCircleIcon({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function BotIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v4" />
      <line x1="8" y1="16" x2="8" y2="16" />
      <line x1="16" y1="16" x2="16" y2="16" />
    </svg>
  );
}

function GearIcon({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}

// ─── Typewriter animation hook ───────────────────────────────────────────────

function useTypewriter(text: string, speed = 40, delay = 0, active = true) {
  const [displayed, setDisplayed] = React.useState("");
  React.useEffect(() => {
    if (!active) { setDisplayed(""); return; }
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

const EMOJI_CHECK = String.fromCodePoint(0x2705);
const EMOJI_BULB = String.fromCodePoint(0x1F4A1);
const EMOJI_CHECKMARK = String.fromCodePoint(0x2713);
const EMOJI_ROBOT = String.fromCodePoint(0x1F916);
const EMOJI_PERSON = String.fromCodePoint(0x1F464);
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
      <div className="flex items-start gap-2" style={{ opacity: active ? 1 : 0, transition: "opacity 0.3s" }}>
        <span className="shrink-0 mt-0.5 text-[10px] font-bold text-violet-400 font-mono tracking-wide">VOC&Ecirc;</span>
        <span className="font-mono text-[11px] text-slate-300 leading-relaxed">{text}</span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2" style={{ opacity: active ? 1 : 0, transition: "opacity 0.3s" }}>
      <span className="shrink-0 mt-0.5 text-[10px] font-bold text-emerald-400 font-mono tracking-wide">CB</span>
      <div className="font-mono text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap">
        {displayed}
        {active && !isDone && (
          <span className="inline-block w-[6px] h-[13px] bg-violet-400 ml-0.5 animate-pulse" />
        )}
      </div>
    </div>
  );
}

// ─── Feature item component ──────────────────────────────────────────────────

function FeatureItem({
  icon, label, delay, visible
}: {
  icon: React.ReactNode;
  label: string;
  delay: number;
  visible: boolean;
}) {
  return (
    <div
      className="flex items-center gap-2.5 py-1"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateX(0)" : "translateX(-8px)",
        transition: `all 0.4s cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms`,
      }}
    >
      <span className="shrink-0">{icon}</span>
      <span className="font-mono text-[11px] text-slate-300 leading-snug">{label}</span>
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

  ${EMOJI_CHECK} 15.757 tokens de entrada` +
  `
  ${EMOJI_CHECK} 16 de sa${I_ACUTE}da` +
  `
  ${EMOJI_CHECK} 1 turn`;

const DEMO2_TEXT = `${LDQUO}e quanto custava antes?${RDQUO}`;
const DEMO2_RESPONSE =
  `188.631 de entrada ${EN_DASH} 534 de sa${I_ACUTE}da ${EN_DASH} 3 turns` +
  `

  Agora ${EMOJI_CHECKMARK} 12x menor que a 1.20` +
  `
  ${EMOJI_CHECKMARK} 3x menor que o Claude Code puro`;

/**
 * Input tokens for one greeting, measured with the CLI's own usage field
 * (Opus 5, same prompt, same machine). Bar widths are relative to the worst
 * case so the drop is legible at a glance.
 */
const COST_ROWS = [
  {
    label: `Codebrain 1.20`,
    value: "188.631",
    percent: 100,
    color: "linear-gradient(90deg, rgba(239,68,68,0.75), rgba(239,68,68,0.45))",
    textColor: "#f87171",
  },
  {
    label: `Claude Code puro`,
    value: "51.408",
    percent: 27,
    color: "linear-gradient(90deg, rgba(148,163,184,0.6), rgba(148,163,184,0.35))",
    textColor: "#cbd5e1",
  },
  {
    label: `Codebrain 1.21`,
    value: "15.757",
    percent: 8,
    color: "linear-gradient(90deg, rgba(16,185,129,0.9), rgba(16,185,129,0.5))",
    textColor: "#34d399",
  },
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
  const [visible, setVisible] = React.useState(false);
  const [phase, setPhase] = React.useState(0); // 0=enter, 1=demos, 2=tag+features, 3=bot, 4=cta
  const { navigate } = useRouter();

  const goToSettings = React.useCallback(() => {
    navigate("/settings");
  }, [navigate]);

  React.useEffect(() => {
    if (!open) {
      setVisible(false);
      setPhase(0);
      return;
    }
    // Enter animation
    requestAnimationFrame(() => setVisible(true));
    // Stagger content phases — slower for readability
    const t1 = setTimeout(() => setPhase(1), 500);
    const t2 = setTimeout(() => setPhase(2), 4500);
    const t3 = setTimeout(() => setPhase(3), 7000);
    const t4 = setTimeout(() => setPhase(4), 9000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
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
      className="fixed inset-0 z-[10000] flex items-center justify-center cursor-pointer"
      style={{
        backgroundColor: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(8px)",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.3s ease",
      }}
      onClick={onClose}
    >
      <div
        className="w-[620px] max-w-[94vw] max-h-[88vh] overflow-hidden flex flex-col rounded-2xl shadow-2xl border border-white/[0.08] relative"
        style={{
          background: "linear-gradient(165deg, #0f0f1a 0%, #0a0a14 40%, #0d0b18 100%)",
          transform: visible ? "scale(1) translateY(0)" : "scale(0.92) translateY(12px)",
          opacity: visible ? 1 : 0,
          transition: "all 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Glow accent at top */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] h-[150px] pointer-events-none"
          style={{
            background: "radial-gradient(ellipse at center, rgba(139,92,246,0.15) 0%, transparent 70%)",
          }}
        />

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors cursor-pointer"
        >
          <XIcon size={14} />
        </button>

        <div className="overflow-y-auto px-7 pt-7 pb-6 space-y-6 relative">
          {/* ── Header ──────────────────────────────────────── */}
          <div className="text-center space-y-4">
            {/* NOVO badge */}
            <div
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold font-mono uppercase tracking-[0.2em]"
              style={{
                background: "linear-gradient(135deg, rgba(139,92,246,0.25), rgba(59,130,246,0.2))",
                border: "1px solid rgba(139,92,246,0.3)",
                color: "#c4b5fd",
                boxShadow: visible
                  ? "0 0 20px rgba(139,92,246,0.15), inset 0 1px 0 rgba(255,255,255,0.05)"
                  : "none",
                animation: visible ? "badge-glow 3s ease-in-out infinite" : "none",
              }}
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-400" />
              </span>
              NOVO
            </div>

            {/* Icon */}
            <div className="flex justify-center">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, rgba(139,92,246,0.15), rgba(59,130,246,0.1))",
                  border: "1px solid rgba(139,92,246,0.2)",
                }}
              >
                <BotIcon size={32} className="text-violet-400" />
              </div>
            </div>

            {/* Title + subtitle */}
            <div className="space-y-1.5">
              <h2 className="text-[22px] font-bold text-white tracking-tight">
                3&#215; mais barato que o Claude Code
              </h2>
              <p className="text-[13px] text-slate-400 leading-relaxed max-w-[420px] mx-auto">
                O mesmo trabalho com um ter&#231;o dos tokens &#8212; medido na API, n&#227;o estimado
              </p>
            </div>
          </div>

          {/* ── Terminal demos ──────────────────────────────── */}
          <div className="space-y-3">
            {/* Demo 1 */}
            <div
              className="rounded-xl border border-white/[0.06] overflow-hidden"
              style={{
                background: "rgba(0,0,0,0.3)",
                opacity: phase >= 1 ? 1 : 0,
                transform: phase >= 1 ? "translateY(0)" : "translateY(8px)",
                transition: "all 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            >
              <div className="flex items-center gap-1.5 px-3.5 py-2 border-b border-white/[0.04]">
                <span className="w-2 h-2 rounded-full bg-red-500/70" />
                <span className="w-2 h-2 rounded-full bg-yellow-500/70" />
                <span className="w-2 h-2 rounded-full bg-green-500/70" />
                <span className="ml-2 font-mono text-[9px] text-gray-600 uppercase tracking-widest">
                  Terminal
                </span>
              </div>
              <div className="p-3.5 space-y-2">
                <ChatLine role="user" text={DEMO1_TEXT} delay={800} active={phase >= 1} />
                <ChatLine
                  role="assistant"
                  text={DEMO1_RESPONSE}
                  delay={2000}
                  active={phase >= 1}
                />
              </div>
            </div>

            {/* Demo 2 */}
            <div
              className="rounded-xl border border-white/[0.06] overflow-hidden"
              style={{
                background: "rgba(0,0,0,0.3)",
                opacity: phase >= 2 ? 1 : 0,
                transform: phase >= 2 ? "translateY(0)" : "translateY(8px)",
                transition: "all 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            >
              <div className="p-3.5 space-y-2">
                <ChatLine role="user" text={DEMO2_TEXT} delay={300} active={phase >= 2} />
                <ChatLine
                  role="assistant"
                  text={DEMO2_RESPONSE}
                  delay={1500}
                  active={phase >= 2}
                />
              </div>
            </div>
          </div>

          {/* -- Cost comparison: the headline of this release -- */}
          <div
            className="rounded-xl border border-white/[0.06] overflow-hidden"
            style={{
              background: "linear-gradient(135deg, rgba(16,185,129,0.05), rgba(59,130,246,0.03))",
              opacity: phase >= 2 ? 1 : 0,
              transform: phase >= 2 ? "translateY(0)" : "translateY(8px)",
              transition: "all 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.3s",
            }}
          >
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <GearIcon size={14} className="text-emerald-400" />
                <span className="font-mono text-[10px] font-bold text-emerald-400 uppercase tracking-[0.15em]">
                  Custo de um {LDQUO}ol{A_ACUTE}{RDQUO}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Tokens de entrada por turno, mesma pergunta e mesmo modelo:
              </p>

              <div className="space-y-2">
                {COST_ROWS.map((row, i) => (
                  <div
                    key={row.label}
                    className="flex items-center gap-3"
                    style={{
                      opacity: phase >= 2 ? 1 : 0,
                      transform: phase >= 2 ? "translateX(0)" : "translateX(-6px)",
                      transition: `all 0.45s cubic-bezier(0.16, 1, 0.3, 1) ${400 + i * 120}ms`,
                    }}
                  >
                    <span className="w-[104px] shrink-0 font-mono text-[10px] text-slate-400 leading-tight">
                      {row.label}
                    </span>
                    <div className="flex-1 h-[18px] rounded bg-black/40 border border-white/[0.05] overflow-hidden">
                      <div
                        style={{
                          height: "100%",
                          width: phase >= 2 ? `${row.percent}%` : "0%",
                          background: row.color,
                          transition: `width 0.7s cubic-bezier(0.16, 1, 0.3, 1) ${500 + i * 120}ms`,
                        }}
                      />
                    </div>
                    <span
                      className="w-[58px] shrink-0 text-right font-mono text-[11px] font-semibold tabular-nums"
                      style={{ color: row.textColor }}
                    >
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>

              <p className="text-[10px] text-slate-500 leading-relaxed pt-1 border-t border-white/[0.04]">
                O ganho veio de parar de enviar schemas de ferramentas que o agente
                nunca usa {EN_DASH} e de nunca gastar um turno extra numa sauda&#231;&#227;o.
              </p>
            </div>
          </div>


          {/* ── Features list ───────────────────────────────── */}
          <div
            className="space-y-1"
            style={{
              opacity: phase >= 2 ? 1 : 0,
              transition: "opacity 0.4s ease 0.5s",
            }}
          >
            <FeatureItem
              icon={<CheckCircleIcon size={14} className="text-emerald-400" />}
              label="Sauda&#231;&#227;o n&#227;o gasta mais 3 chamadas &#8212; agora &#233; 1"
              delay={0}
              visible={phase >= 2}
            />
            <FeatureItem
              icon={<GearIcon size={14} className="text-blue-400" />}
              label="12 ferramentas no boot; as outras 197 sob demanda"
              delay={80}
              visible={phase >= 2}
            />
            <FeatureItem
              icon={<BotIcon size={14} className="text-violet-400" />}
              label="Orquestrador n&#227;o recebe mais ferramentas de edi&#231;&#227;o"
              delay={160}
              visible={phase >= 2}
            />
            <FeatureItem
              icon={<BotIcon size={14} className="text-violet-400" />}
              label="Novo bot&#227;o + time: squad multi-IA j&#225; configurado"
              delay={240}
              visible={phase >= 2}
            />
            <FeatureItem
              icon={<GearIcon size={14} className="text-sky-400" />}
              label="Busca em todos os seletores de modelo"
              delay={320}
              visible={phase >= 2}
            />
          </div>

          {/* ── CTA ─────────────────────────────────────────── */}
          <div
            className="text-center space-y-4 pt-1"
            style={{
              opacity: phase >= 4 ? 1 : 0,
              transform: phase >= 4 ? "translateY(0)" : "translateY(6px)",
              transition: "all 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            <p className="text-[12px] text-slate-400 italic leading-relaxed">
              Nada foi removido: as 197 ferramentas restantes continuam a um
              <span className="font-mono not-italic text-slate-300"> enable_tool_group </span>
              de dist&#226;ncia.
            </p>

            <button
              onClick={onClose}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl font-mono text-[12px] font-bold text-white cursor-pointer transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
              style={{
                background: "linear-gradient(135deg, #7c3aed, #6366f1)",
                boxShadow: "0 4px 20px rgba(124,58,237,0.3), inset 0 1px 0 rgba(255,255,255,0.1)",
              }}
            >
              <CheckCircleIcon size={14} className="text-white/80" />
              Entendi!
            </button>

            {currentVersion && (
              <p className="font-mono text-[9px] text-gray-700 tracking-wide">
                Codebrain v{currentVersion}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Glow animation keyframes injected once */}
      <style>{`
        @keyframes badge-glow {
          0%, 100% { box-shadow: 0 0 12px rgba(139,92,246,0.15), inset 0 1px 0 rgba(255,255,255,0.05); }
          50% { box-shadow: 0 0 24px rgba(139,92,246,0.25), inset 0 1px 0 rgba(255,255,255,0.08); }
        }
      `}</style>
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
