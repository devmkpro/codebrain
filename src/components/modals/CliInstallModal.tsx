import React from "react";
import { Terminal, Download, X, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

interface CliInstallModalProps {
  open: boolean;
  onClose: () => void;
  onInstalled: () => void;
}

export function CliInstallModal({ open, onClose, onInstalled }: CliInstallModalProps) {
  const [status, setStatus] = React.useState<"idle" | "installing" | "success" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && status !== "installing") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, status]);

  if (!open) return null;

  const handleInstall = async () => {
    setStatus("installing");
    setError(null);
    try {
      const result = await (window as any).codeBrainApp.cli.install();
      if (result.ok) {
        setStatus("success");
        setTimeout(() => {
          onInstalled();
          onClose();
        }, 1500);
      } else {
        setStatus("error");
        setError(result.error || "Erro desconhecido durante a instalação.");
      }
    } catch (err) {
      setStatus("error");
      setError(String(err));
    }
  };

  return (
    <div className="fixed top-[38px] left-0 right-0 bottom-0 z-[10001] flex items-center justify-center bg-black/80 backdrop-blur-md" onClick={() => status !== "installing" && onClose()}>
      <div className="w-[500px] max-w-[90vw] bg-[#0d0d0d] border border-white/10 rounded-xl shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 bg-white/[0.02]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
              <Terminal size={18} className="text-indigo-400" />
            </div>
            <div>
              <h2 className="text-[14px] font-bold text-white tracking-tight leading-none">
                OpenClaude CLI
              </h2>
              <p className="text-[11px] text-gray-500 mt-1 font-mono uppercase tracking-wider">Dependency Required</p>
            </div>
          </div>
          {status !== "installing" && (
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-all">
              <X size={16} />
            </button>
          )}
        </div>

        <div className="p-8 flex flex-col items-center text-center">
          {status === "idle" && (
            <>
              <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-6 border border-amber-500/20">
                <AlertTriangle size={32} className="text-amber-500" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">CLI não encontrado</h3>
              <p className="text-gray-400 text-sm leading-relaxed mb-8 max-w-[340px]">
                O OpenClaude CLI é essencial para o funcionamento dos agentes e terminais.
                Deseja instalar automaticamente agora?
              </p>
              <div className="flex flex-col w-full gap-3">
                <button
                  onClick={handleInstall}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/10"
                >
                  <Download size={18} />
                  Instalar Automaticamente
                </button>
                <p className="text-[10px] text-gray-600 font-mono">
                  npm install -g @gitlawb/openclaude
                </p>
              </div>
            </>
          )}

          {status === "installing" && (
            <>
              <div className="w-16 h-16 rounded-full bg-indigo-500/10 flex items-center justify-center mb-6 border border-indigo-500/20 relative">
                <Loader2 size={32} className="text-indigo-500 animate-spin" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Instalando...</h3>
              <p className="text-gray-400 text-sm leading-relaxed mb-6">
                Isso pode levar alguns segundos dependendo da sua conexão.
              </p>
              <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 animate-pulse w-2/3 rounded-full"></div>
              </div>
            </>
          )}

          {status === "success" && (
            <>
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mb-6 border border-emerald-500/20">
                <CheckCircle2 size={32} className="text-emerald-500" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Sucesso!</h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                OpenClaude CLI instalado e detectado com sucesso.
              </p>
            </>
          )}

          {status === "error" && (
            <>
              <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-6 border border-red-500/20">
                <AlertTriangle size={32} className="text-red-500" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Falha na instalação</h3>
              <p className="text-red-400/80 text-xs font-mono bg-red-500/5 p-3 rounded border border-red-500/10 mb-6 w-full text-left overflow-auto max-h-[100px]">
                {error}
              </p>
              {error?.includes("npm não foi encontrado") ? (
                <p className="text-[11px] text-gray-500 text-center">
                  Instale o Node.js em{" "}
                  <span className="text-indigo-400 font-mono">nodejs.org</span>{" "}
                  e reinicie o app.
                </p>
              ) : (
                <button
                  onClick={handleInstall}
                  className="w-full py-3 bg-white/5 hover:bg-white/10 text-white rounded-lg font-medium transition-all"
                >
                  Tentar novamente
                </button>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/5 bg-white/[0.01] flex justify-center">
          <a
            href="https://openclaude.gitlawb.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-gray-500 hover:text-indigo-400 transition-colors uppercase tracking-widest font-bold"
          >
            openclaude.gitlawb.com
          </a>
        </div>
      </div>
    </div>
  );
}
