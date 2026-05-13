import React from "react";
import { RELEASES } from "./releases-data";
import { Sparkles, X$1, Mic, ArrowUpRight } from "../../stores/providers-store";

// WhatsNewModal
export function WhatsNewModal({
  open,
  onClose,
  currentVersion
}) {
  const [audioConfig, setAudioConfig] = React.useState(null);
  const [audioConfigLoaded, setAudioConfigLoaded] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    const onKey = e => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  React.useEffect(() => {
    if (!open) return;
    setAudioConfigLoaded(false);
    window.codeBrainApp?.audio?.getConfig().then(cfg => setAudioConfig(cfg)).catch(() => setAudioConfig(null)).finally(() => setAudioConfigLoaded(true));
  }, [open]);
  if (!open) return null;
  const primaryRelease = RELEASES[0];
  const priorReleases = RELEASES.slice(1);
  const BrainVoiceAllowed = true;
  return <div className="fixed top-[38px] left-0 right-0 bottom-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[680px] max-w-[92vw] max-h-[84vh] bg-[#0a0a0a] border border-white/10 rounded-xl shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Sparkles size={14} strokeWidth={1.5} className="text-indigo-400" />
            <h2 className="font-mono text-[12px] font-bold text-white tracking-tight">
              CodeBrain v{primaryRelease.version}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition-colors">
            <X$1 size={14} strokeWidth={1.5} />
          </button>
        </div>
        <div className="overflow-y-auto p-4 space-y-5">
          <section className="border border-indigo-500/20 bg-indigo-500/[0.04] rounded-lg overflow-hidden">
            <div className="p-4 border-b border-indigo-500/10">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="font-mono text-[9px] uppercase tracking-widest text-gray-500">
                  Nova camada de voz
                </span>
              </div>
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-lg border border-indigo-500/25 bg-indigo-500/10 flex items-center justify-center shrink-0">
                  <Mic size={18} strokeWidth={1.6} className="text-indigo-300" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-[22px] font-bold text-white tracking-tight leading-tight">
                    BrainVoice
                  </h3>
                  <p className="mt-2 font-mono text-[12px] leading-relaxed text-gray-300">
                    Fale naturalmente em português. O CodeBrain transforma sua fala em inglês
                    técnico e limpo para o agente executar melhor, com menos retrabalho e menos
                    desperdício de tokens, mantendo a resposta final em português do Brasil.
                  </p>
                </div>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-px bg-indigo-500/10">
              {[["Aperte Espaço para falar", "Segure Espaço ou use Toggle nas configurações para iniciar e parar."], ["Modos CODE e CHAT", "CODE prepara execução técnica; CHAT mantém conversa e planejamento naturais."], ["Local ou Groq", "Use whisper.cpp local ou Groq para transcrição rápida na nuvem."], ["Medidor VOL + PPM", "Veja volume, ritmo de fala e cancele chunks pendentes com X."]].map(([title, text]) => <div key={title} className="bg-[#0a0a0a] p-3">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-white">
                    {title}
                  </p>
                  <p className="font-mono text-[10px] leading-relaxed text-gray-500 mt-1">{text}</p>
                </div>)}
            </div>
            <div className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="font-mono text-[10px] leading-relaxed text-gray-500">
                BrainVoice está disponível nesta versão.
              </p>
              <div className="inline-flex items-center justify-center px-3 py-2 rounded border border-green-500/35 bg-green-500/10 text-green-200 font-mono text-[10px] font-bold uppercase tracking-widest">
                BrainVoice liberado
              </div>
            </div>
          </section>
          <section>
            <div className="flex items-baseline gap-2 mb-2 pb-1 border-b border-white/5">
              <span className="font-mono text-[11px] font-bold text-white uppercase tracking-widest">
                Também incluso
              </span>
              <span className="font-mono text-[9px] text-gray-600 uppercase tracking-widest">
                v{primaryRelease.version}
              </span>
            </div>
            <ul className="space-y-1.5">
              {primaryRelease.highlights.filter(h => h.kind !== "feat").map((h, i) => <li key={i} className="flex items-start gap-2 font-mono text-[10.5px] text-gray-300 leading-relaxed">
                    <span className={`mt-1 inline-block h-1.5 w-1.5 rounded-full shrink-0 ${h.kind === "security" ? "bg-yellow-500" : "bg-indigo-500"}`} />
                    <span>
                      <span className="font-mono text-[9px] text-gray-600 uppercase mr-1.5 tracking-widest">
                        {h.kind}
                      </span>
                      {h.text}
                    </span>
                  </li>)}
            </ul>
          </section>
          {priorReleases.map(rel => <section key={rel.version}>
              <div className="flex items-baseline gap-2 mb-2 pb-1 border-b border-white/5">
                <span className="font-mono text-[13px] font-bold text-white">v{rel.version}</span>
                <span className="font-mono text-[9px] text-gray-600 uppercase tracking-widest">
                  {rel.date}
                </span>
              </div>
              <ul className="space-y-1.5">
                {rel.highlights.map((h, i) => <li key={i} className="flex items-start gap-2 font-mono text-[10.5px] text-gray-300 leading-relaxed">
                    <span className={`mt-1 inline-block h-1.5 w-1.5 rounded-full shrink-0 ${h.kind === "fix" ? "bg-rose-500" : h.kind === "security" ? "bg-yellow-500" : "bg-indigo-500"}`} />
                    <span>
                      <span className="font-mono text-[9px] text-gray-600 uppercase mr-1.5 tracking-widest">
                        {h.kind}
                      </span>
                      {h.text}
                    </span>
                  </li>)}
              </ul>
            </section>)}
          {currentVersion && currentVersion !== primaryRelease.version && <p className="font-mono text-[9px] text-gray-700">Build instalada: v{currentVersion}</p>}
        </div>
      </div>
    </div>;
}
export const LATEST_RELEASE_VERSION = RELEASES[0].version;
export function formatDuration(ms) {
  if (ms < 0) return "—";
  const s = Math.floor(ms / 1e3);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}