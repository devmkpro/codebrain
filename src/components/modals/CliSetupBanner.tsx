import React from "react";
import { Terminal, Download, X, CheckCircle2, Loader2, AlertTriangle } from "lucide-react";

interface CliInfo {
  name: string;
  label: string;
  pkg: string;
  description: string;
  optional: boolean;
}

const CLIS: CliInfo[] = [
  {
    name: "openclaude",
    label: "OpenClaude",
    pkg: "@gitlawb/openclaude",
    description: "Motor principal dos agentes Codebrain",
    optional: false,
  },
  {
    name: "codex",
    label: "Codex (OpenAI)",
    pkg: "@openai/codex",
    description: "Agentes via ChatGPT / OpenAI",
    optional: true,
  },
  {
    name: "gemini",
    label: "Gemini CLI",
    pkg: "@google/gemini-cli",
    description: "Agentes via Google Gemini",
    optional: true,
  },
  {
    name: "kimi",
    label: "Kimi CLI (Moonshot)",
    pkg: "script: curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash",
    description: "Agentes via Kimi Code CLI (Moonshot AI) — instala via script",
    optional: true,
  },
];

interface CliStatus {
  found: boolean;
  path?: string;
  version?: string;
}

interface Props {
  /** Map of cli name → status (from cli:detect) */
  cliStatuses: Record<string, CliStatus | null>;
  onClose: () => void;
  onInstalled?: (cli: string) => void;
}

export function CliSetupBanner({ cliStatuses, onClose, onInstalled }: Props) {
  const [installing, setInstalling] = React.useState<Record<string, boolean>>({});
  const [installed, setInstalled]   = React.useState<Record<string, boolean>>({});
  const [errors, setErrors]         = React.useState<Record<string, string>>({});

  const missing = CLIS.filter(c => !cliStatuses[c.name]?.found && !installed[c.name]);
  if (missing.length === 0) return null;

  const handleInstall = async (cli: CliInfo) => {
    setInstalling(s => ({ ...s, [cli.name]: true }));
    setErrors(s => ({ ...s, [cli.name]: "" }));
    try {
      const result = await (window as any).codeBrainApp?.cli?.installCli?.(cli.name);
      if (result?.ok) {
        setInstalled(s => ({ ...s, [cli.name]: true }));
        onInstalled?.(cli.name);
      } else {
        setErrors(s => ({ ...s, [cli.name]: result?.error || "Erro desconhecido." }));
      }
    } catch (err) {
      setErrors(s => ({ ...s, [cli.name]: String(err) }));
    } finally {
      setInstalling(s => ({ ...s, [cli.name]: false }));
    }
  };

  return (
    <div className="fixed inset-0 z-[10005] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div
        className="w-[520px] max-w-[94vw] bg-[#0d0d0d] border border-white/10 rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 bg-white/[0.02]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center border border-violet-500/20">
              <Terminal size={16} className="text-violet-400" />
            </div>
            <div>
              <h2 className="text-[13px] font-bold text-white tracking-tight leading-none">Configuração de CLIs</h2>
              <p className="text-[10px] text-slate-500 mt-0.5 font-mono">CLIs opcionais disponíveis para instalar</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/5 text-slate-600 hover:text-white transition-all cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3">
          <p className="font-mono text-[10px] text-slate-500 leading-relaxed">
            Os CLIs abaixo não foram detectados. O <span className="text-violet-300 font-bold">OpenClaude</span> é obrigatório para os agentes.
            Codex e Gemini são opcionais — instale somente se quiser usar esses providers.
          </p>

          {CLIS.filter(c => !cliStatuses[c.name]?.found).map(cli => (
            <div
              key={cli.name}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                installed[cli.name]
                  ? "border-emerald-500/20 bg-emerald-500/5"
                  : errors[cli.name]
                  ? "border-red-500/20 bg-red-500/5"
                  : "border-white/[0.06] bg-white/[0.02]"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="font-mono text-[11px] font-bold text-slate-200">{cli.label}</span>
                  {cli.optional && (
                    <span className="font-mono text-[8px] uppercase tracking-widest text-slate-600 border border-white/10 px-1 py-0.5 rounded">opcional</span>
                  )}
                  {!cli.optional && (
                    <span className="font-mono text-[8px] uppercase tracking-widest text-amber-400 border border-amber-500/20 px-1 py-0.5 rounded">necessário</span>
                  )}
                </div>
                <p className="font-mono text-[10px] text-slate-500">{cli.description}</p>
                {errors[cli.name] && (
                  <p className="font-mono text-[9px] text-red-400 mt-1 truncate">{errors[cli.name]}</p>
                )}
                <p className="font-mono text-[9px] text-slate-700 mt-0.5">npm install -g {cli.pkg}</p>
              </div>

              {installed[cli.name] ? (
                <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
              ) : installing[cli.name] ? (
                <Loader2 size={18} className="text-violet-400 animate-spin shrink-0" />
              ) : (
                <button
                  onClick={() => handleInstall(cli)}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 transition-all font-mono text-[10px] font-bold"
                >
                  <Download size={12} strokeWidth={1.8} />
                  Instalar
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-white/5 bg-white/[0.01] flex items-center justify-between">
          <p className="font-mono text-[9px] text-slate-700">Requer Node.js / npm no PATH</p>
          <button
            onClick={onClose}
            className="font-mono text-[10px] text-slate-500 hover:text-slate-300 transition-colors uppercase tracking-widest"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
