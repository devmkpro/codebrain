import React from "react";
import { Trash2, Plus } from "../../stores/providers-store";

// ProviderList
export function ProviderList({
  providers,
  onAdd,
  onEdit,
  onDelete
}) {
  return <div className="p-4 space-y-3">
      <p className="font-mono text-[10px] text-gray-600">
        Cada pane usa um endpoint LLM. Configure aqui — depois escolhe no{" "}
        <span className="text-red-500/70">+ PANE</span>.
      </p>
      <div className="space-y-1.5">
        {providers.map(p => {
        // Virtual providers are auto-detected CLIs — they live only in memory, not in providers.json.
        // Deleting them does nothing, so hide the button. Identify by known virtual IDs or CLI-only types.
        // Exception: "mimo-claude" is virtual but needs an API key → show edit button (no delete).
        const VIRTUAL_IDS = ["claude-oauth", "codex-oauth", "gemini-cli", "kimi", "cursor", "copilot"];
        const isMimoClaude = p.id === "mimo-claude";
        const isBuiltin = VIRTUAL_IDS.includes(p.id) || p.type === "oauth" || p.isVirtual === true;
        const typeLabel = p.type === "oauth" ? "OAuth" : p.type === "anthropic-compat" ? `Anthropic → ${p.host ?? "claude"}` : p.type === "gemini-compat" ? `Gemini → ${p.host ?? "gemini"}` : p.type === "mimo-compat" ? `MIMO → ${p.host ?? "openclaude"}` : p.type === "openai-compat" ? `OpenAI → ${p.host ?? "openclaude"}` : "custom";
        const url = p.env?.ANTHROPIC_BASE_URL ?? p.env?.GEMINI_BASE_URL ?? p.env?.OPENAI_BASE_URL;
        const hasKey = p.env?.ANTHROPIC_AUTH_TOKEN && !/^\*+$/.test(p.env.ANTHROPIC_AUTH_TOKEN);
        return <div key={p.id} className="group flex items-center gap-3 px-3 py-2 rounded-lg border border-white/5 hover:border-white/10 bg-white/[0.02]">
              <div className="flex-1 min-w-0">
                <p className="font-mono text-[11px] text-gray-200 truncate">{p.label}</p>
                <p className="font-mono text-[9px] text-gray-600 truncate">
                  {isMimoClaude
                    ? `Claude Code CLI + MIMO key · ${hasKey ? "key configurada" : "⚠ sem key"}`
                    : isBuiltin
                      ? "CLI built-in"
                      : `${typeLabel} · ${url ?? "(no URL)"}`}
                </p>
              </div>
              {isMimoClaude && (
                <button onClick={() => onEdit(p)} className="opacity-0 group-hover:opacity-100 font-mono text-[10px] text-gray-500 hover:text-white transition-opacity cursor-pointer">
                  edit key
                </button>
              )}
              {!isBuiltin && !isMimoClaude && <React.Fragment>
                  <button onClick={() => onEdit(p)} className="opacity-0 group-hover:opacity-100 font-mono text-[10px] text-gray-500 hover:text-white transition-opacity cursor-pointer">
                    edit
                  </button>
                  <button onClick={() => onDelete(p.id)} className="opacity-0 group-hover:opacity-100 text-gray-700 hover:text-red-500 transition-opacity cursor-pointer">
                    <Trash2 size={12} strokeWidth={1.5} />
                  </button>
                </React.Fragment>}
            </div>;
      })}
      </div>
      <button onClick={onAdd} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 hover:bg-red-500/10 font-mono text-[10px] font-bold text-red-400 cursor-pointer">
        <Plus size={11} strokeWidth={1.5} /> ADD PROVIDER
      </button>
    </div>;
}