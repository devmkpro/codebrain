import React from "react";

// ConfiguredTemplateView
export function ConfiguredTemplateView({
  template,
  providers,
  onEdit,
  onDisconnect,
  onBack
}) {
  return <div className="p-4 space-y-3">
      <p className="font-mono text-[10px] text-gray-400">
        <span className="text-red-400">{template.label}</span> já configurado — {providers.length}{" "}
        integração{providers.length !== 1 ? "es" : ""}.
      </p>
      <div className="space-y-1.5">
        {providers.map(p => <div className="flex items-center justify-between px-3 py-2 rounded border border-white/5 bg-white/[0.02]">
            <div className="min-w-0">
              <p className="font-mono text-[11px] text-gray-200 truncate">{p.label}</p>
              <p className="font-mono text-[9px] text-gray-600 uppercase tracking-wider">
                {p.host} · {p.type}
              </p>
              <p className="font-mono text-[9px] text-gray-700 truncate">
                {p.env?.ANTHROPIC_BASE_URL ?? p.env?.OPENAI_BASE_URL ?? ""}
              </p>
            </div>
            <span className="font-mono text-[8px] font-bold text-red-400 uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/30">
              OK
            </span>
          </div>)}
      </div>
      <div className="flex gap-2 pt-2">
        <button onClick={onEdit} className="flex-1 py-2 rounded font-mono text-[11px] font-bold bg-indigo-600 text-white hover:bg-indigo-500">
          TROCAR TOKEN / ROTA
        </button>
        <button onClick={onDisconnect} className="px-4 py-2 rounded font-mono text-[10px] text-gray-400 hover:text-indigo-400 border border-white/10 hover:border-indigo-500/40">
          desconectar
        </button>
      </div>
      <button onClick={onBack} className="font-mono text-[10px] text-gray-600 hover:text-gray-400">
        ‹ voltar
      </button>
    </div>;
}