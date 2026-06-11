import React from "react";
import { RELEASES } from "./releases-data";

// ─── Icons (inline SVGs to avoid external deps) ─────────────────────────────

function GitMergeIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M6 21V9a9 9 0 0 0 9 9" />
    </svg>
  );
}

function XIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function ShieldIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function SearchIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function TagIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
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
const EMOJI_WARN = String.fromCodePoint(0x26A0, 0xFE0F);
const EMOJI_BULB = String.fromCodePoint(0x1F4A1);
const EMOJI_CHECKMARK = String.fromCodePoint(0x2713);
const EMOJI_BRAIN = String.fromCodePoint(0x1F9E0);
const EMOJI_LABEL = String.fromCodePoint(0x1F3F7, 0xFE0F);
const EMOJI_NOTE = String.fromCodePoint(0x1F4DD);
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

const DEMO1_TEXT = `${LDQUO}Revise o MR #42${RDQUO}`;
const DEMO1_RESPONSE =
  "Analisando diff de 12 arquivos..." +
  `\n\n  ${EMOJI_CHECK} 3 findings de segurança` +
  `\n  ${EMOJI_WARN} 2 sugestões de performance` +
  `\n  ${EMOJI_BULB} 1 melhoria de legibilidade`;

const DEMO2_TEXT = `${LDQUO}Revise o PR #15 e comente no GitHub${RDQUO}`;
const DEMO2_RESPONSE = `Review postado com 5 comentários inline ${EMOJI_CHECKMARK}`;

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
  const [phase, setPhase] = React.useState(0); // 0=enter, 1=content, 2=features, 3=cta

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
    const t3 = setTimeout(() => setPhase(3), 6000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
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
                <GitMergeIcon size={32} className="text-violet-400" />
              </div>
            </div>

            {/* Title + subtitle */}
            <div className="space-y-1.5">
              <h2 className="text-[22px] font-bold text-white tracking-tight">
                Code Review com IA
              </h2>
              <p className="text-[13px] text-slate-400 leading-relaxed max-w-[420px] mx-auto">
                O Codebrain agora revisa seus Merge Requests e Pull Requests automaticamente
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

          {/* ── Codebrain Tag section ───────────────────────── */}
          <div
            className="rounded-xl border border-white/[0.06] overflow-hidden"
            style={{
              background: "linear-gradient(135deg, rgba(139,92,246,0.04), rgba(59,130,246,0.03))",
              opacity: phase >= 2 ? 1 : 0,
              transform: phase >= 2 ? "translateY(0)" : "translateY(8px)",
              transition: "all 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.3s",
            }}
          >
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <TagIcon size={14} className="text-violet-400" />
                <span className="font-mono text-[10px] font-bold text-violet-400 uppercase tracking-[0.15em]">
                  Identifica&#231;&#227;o Autom&#225;tica
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Todo coment&#225;rio postado pelo Codebrain no seu MR/PR inclui uma tag identificando a origem:
              </p>
              {/* Mock comment card */}
              <div className="rounded-lg border border-white/[0.08] bg-[#0c0c18] p-3.5 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[11px]">{EMOJI_BRAIN}</span>
                  <span className="font-mono text-[11px] font-semibold text-white">Codebrain Review</span>
                </div>
                <div className="pl-5 space-y-1.5">
                  <p className="text-[11px] text-amber-300/90">
                    {EMOJI_WARN} Poss&#237;vel null pointer na linha 42
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Sugest&#227;o: adicionar null check antes da chamada
                  </p>
                </div>
                <div className="flex items-center gap-1.5 pt-1.5 mt-1.5 border-t border-white/[0.04]">
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-mono font-medium"
                    style={{
                      background: "rgba(139,92,246,0.12)",
                      color: "#c4b5fd",
                      border: "1px solid rgba(139,92,246,0.15)",
                    }}
                  >
                    {EMOJI_LABEL} Posted by Codebrain AI Review
                  </span>
                </div>
              </div>
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
              icon={<SearchIcon size={14} className="text-blue-400" />}
              label="Detecta automaticamente GitHub ou GitLab"
              delay={0}
              visible={phase >= 2}
            />
            <FeatureItem
              icon={<span className="text-[13px]">{EMOJI_NOTE}</span>}
              label="Lista, analisa e comenta em MRs/PRs"
              delay={80}
              visible={phase >= 2}
            />
            <FeatureItem
              icon={<ShieldIcon size={14} className="text-emerald-400" />}
              label="Foco em bugs, seguran&#231;a, performance e estilo"
              delay={160}
              visible={phase >= 2}
            />
            <FeatureItem
              icon={<TagIcon size={14} className="text-violet-400" />}
              label={`Todos os coment&#225;rios t&#234;m tag ${LDQUO}Codebrain AI Review${RDQUO}`}
              delay={240}
              visible={phase >= 2}
            />
            <FeatureItem
              icon={<CheckCircleIcon size={14} className="text-sky-400" />}
              label="Pode postar inline ou s&#243; retornar findings"
              delay={320}
              visible={phase >= 2}
            />
          </div>

          {/* ── CTA ─────────────────────────────────────────── */}
          <div
            className="text-center space-y-4 pt-1"
            style={{
              opacity: phase >= 3 ? 1 : 0,
              transform: phase >= 3 ? "translateY(0)" : "translateY(6px)",
              transition: "all 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            <p className="text-[12px] text-slate-400 italic leading-relaxed">
              Experimente agora: pe&#231;a ao Codebrain para revisar um MR do seu projeto!
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
