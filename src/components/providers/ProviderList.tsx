import React from "react";
import { Pencil } from "lucide-react";
import { Trash2, Plus } from "../../stores/providers-store";

// ProviderList
export function ProviderList({
  providers,
  onAdd,
  onEdit,
  onDelete
}) {
  return <div className="p-4 space-y-4">
      <p className="text-xs leading-relaxed text-cb-fg-2">
        Edite nomes, rotas e modelos. Providers gerenciados por CLI permitem ajustar o catálogo exibido no <span className="text-cb-accent-bright">+ pane</span>.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {providers.map(p => {
        // Virtual providers are auto-detected CLIs — they live only in memory, not in providers.json.
        // Deleting them does nothing, so hide the button. Identify by known virtual IDs or CLI-only types.
        // Exception: "mimo-claude" is virtual but needs an API key → show edit button (no delete).
        const VIRTUAL_IDS = ["codex-oauth", "gemini-cli", "kimi", "cursor", "copilot"];
        const isMimoClaude = p.id === "mimo-claude";
        const isBuiltin = VIRTUAL_IDS.includes(p.id) || p.type === "oauth" || p.isVirtual === true;
        const typeLabel = p.type === "oauth" ? "OAuth" : p.type === "anthropic-compat" ? `Anthropic → ${p.host ?? "claude"}` : p.type === "gemini-compat" ? `Gemini → ${p.host ?? "gemini"}` : p.type === "mimo-compat" ? `MIMO → ${p.host ?? "openclaude"}` : p.type === "openai-compat" ? `OpenAI → ${p.host ?? "openclaude"}` : "custom";
        const url = p.env?.ANTHROPIC_BASE_URL ?? p.env?.GEMINI_BASE_URL ?? p.env?.OPENAI_BASE_URL;
        const hasKey = p.env?.ANTHROPIC_AUTH_TOKEN && !/^\*+$/.test(p.env.ANTHROPIC_AUTH_TOKEN);
        return <div key={p.id} className="group flex min-h-16 items-center gap-3 rounded-cb-1 border border-cb-line-0 bg-cb-bg-1 px-3 py-2 hover:border-cb-line-2 hover:bg-cb-bg-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-cb-1 border border-cb-line-1 bg-cb-bg-0 text-2xs font-bold text-cb-accent">
                {(p.label ?? p.id).slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-xs text-cb-fg-0">{p.label}</p>
                <p className="truncate text-[9px] text-cb-fg-3">
                  {isMimoClaude
                    ? `Claude Code CLI + MIMO key · ${hasKey ? "key configurada" : "⚠ sem key"}`
                    : isBuiltin
                      ? "CLI built-in"
                      : `${typeLabel} · ${url ?? "(no URL)"}`}
                </p>
                <p className="mt-1 text-[9px] text-cb-fg-3">{p.models?.length ?? 0} modelos</p>
              </div>
              <button
                onClick={() => onEdit(p)}
                className="inline-flex h-7 items-center gap-1 rounded-cb-1 border border-cb-line-1 px-2 font-mono text-[10px] text-cb-fg-2 hover:border-cb-line-2 hover:bg-cb-bg-2 hover:text-cb-fg-0"
                aria-label={`Editar ${p.label ?? p.id}`}
              >
                <Pencil size={10} strokeWidth={1.5} />
                editar
              </button>
              {!isBuiltin && !isMimoClaude && <React.Fragment>
                  <button onClick={() => onDelete(p.id)} className="text-cb-fg-3 opacity-0 transition-opacity hover:text-cb-danger group-hover:opacity-100" aria-label={`Remover ${p.label ?? p.id}`}>
                    <Trash2 size={12} strokeWidth={1.5} />
                  </button>
                </React.Fragment>}
            </div>;
      })}
      </div>
      <button onClick={onAdd} className="inline-flex h-cell-lg items-center gap-1.5 rounded-cb-1 border border-cb-accent-dim bg-cb-accent-wash px-3 text-xs font-bold text-cb-accent-bright hover:bg-cb-accent-wash-strong">
        <Plus size={11} strokeWidth={1.5} /> adicionar provider
      </button>
    </div>;
}
