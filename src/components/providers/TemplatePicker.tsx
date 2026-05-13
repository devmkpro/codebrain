import React from "react";
import { ExternalLink } from "../../stores/providers-store";

// TemplatePicker
export function TemplatePicker({
  templates,
  onPick,
  onPickDirect,
  existingProviders
}) {
  const [expanded, setExpanded] = React.useState(null);
  const available = templates;
  return <div className="p-4 space-y-3">
      <p className="font-mono text-[10px] text-gray-600">
        {onPickDirect ? "Escolha provider pra configurar." : "Escolha o provider. Todos os modelos rodam via OpenClaude."}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {available.map(t => {
        const isOpen = expanded === t.id;
        const configured = existingProviders.some(p => p.id.startsWith(`${t.id}-`) || p.id === t.id);
        return <div className="relative">
              <button onClick={() => {
            if (onPickDirect) {
              onPickDirect(t);
            } else {
              setExpanded(isOpen ? null : t.id);
            }
          }} className={`w-full flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg border transition-all text-center ${isOpen ? "border-indigo-500/40 bg-red-500/5" : configured ? "border-indigo-500/40 bg-red-500/[0.04] hover:bg-red-500/[0.08]" : "border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]"}`}>
                {configured && <span className="absolute top-1.5 right-1.5 font-mono text-[8px] font-bold text-red-400 uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/30">
                    OK
                  </span>}
                <div className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center font-mono text-[16px] font-bold text-gray-300">
                  {t.icon}
                </div>
                <p className="font-mono text-[10px] text-gray-200 leading-tight">{t.label}</p>
                {!onPickDirect && t.integrations.length > 1 && <p className="font-mono text-[8px] text-gray-600">
                    {t.integrations.length} opções
                  </p>}
              </button>
              {isOpen && !onPickDirect && <div className="absolute left-0 right-0 top-full mt-1 z-10 border border-white/10 rounded-lg bg-black shadow-2xl p-2 space-y-1">
                  {t.integrations.map((i, idx) => <button onClick={() => onPick(t, i)} className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-indigo-500/10 text-left group">
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-[10px] text-gray-300 group-hover:text-indigo-300">
                          {i.label ?? (i.type === "anthropic-compat" ? "Anthropic-compat" : "OpenAI-compat")}
                        </p>
                      </div>
                      <span className="font-mono text-[8px] text-gray-700 uppercase shrink-0 ml-1">
                        → {i.host}
                      </span>
                    </button>)}
                  {(t.signupUrl || t.docsUrl) && <div className="flex gap-2 px-2 pt-1 border-t border-white/5">
                      {t.signupUrl && <a href={t.signupUrl} target="_blank" rel="noreferrer" className="font-mono text-[9px] text-gray-500 hover:text-indigo-400 flex items-center gap-0.5">
                          signup <ExternalLink size={9} strokeWidth={1.5} />
                        </a>}
                      {t.docsUrl && <a href={t.docsUrl} target="_blank" rel="noreferrer" className="font-mono text-[9px] text-gray-500 hover:text-indigo-400 flex items-center gap-0.5">
                          docs <ExternalLink size={9} strokeWidth={1.5} />
                        </a>}
                    </div>}
                </div>}
            </div>;
      })}
      </div>
    </div>;
}