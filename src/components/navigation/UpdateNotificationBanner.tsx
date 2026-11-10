import React from "react";
import { RELEASES } from "./releases-data";

// UpdateNotificationBanner
export function UpdateNotificationBanner() {
  const [state, setState] = React.useState<{
    kind: "idle" | "checking" | "up_to_date" | "downloading" | "downloaded" | "installing" | "error";
    version?: string;
    percent?: number;
    message?: string;
  }>({
    kind: "idle"
  });
  const [version, setVersion] = React.useState("");
  React.useEffect(() => {
    window.codeBrainApp.app.version().then(setVersion).catch(() => { });
    const off1 = window.codeBrainApp.update.onChecking(() => setState({
      kind: "checking"
    }));
    const off2 = window.codeBrainApp.update.onAvailable(({
      version: v2
    }) => setState({
      kind: "downloading",
      version: v2,
      percent: 0
    }));
    const off3 = window.codeBrainApp.update.onProgress(({
      percent
    }) => setState(prev => prev.kind === "downloading" || prev.kind === "available" ? {
      kind: "downloading",
      version: "version" in prev ? prev.version : "",
      percent
    } : prev));
    const off4 = window.codeBrainApp.update.onDownloaded(({
      version: v2
    }) => setState({
      kind: "downloaded",
      version: v2
    }));
    const off5 = window.codeBrainApp.update.onError(({
      message
    }) => setState({
      kind: "error",
      message
    }));
    const off6 = window.codeBrainApp.update.onNone(() => setState({
      kind: "up_to_date"
    }));
    // onInstalling may not exist if preload hasn't been rebuilt yet
    const off7 = typeof window.codeBrainApp.update.onInstalling === "function"
      ? window.codeBrainApp.update.onInstalling(() =>
        setState(prev =>
          "version" in prev
            ? { kind: "installing", version: prev.version }
            : { kind: "installing", version: "" }
        )
      )
      : () => { };
    return () => {
      off1();
      off2();
      off3();
      off4();
      off5();
      off6();
      off7();
    };
  }, []);
  const baseClasses = "flex items-center justify-between pl-20 pr-[140px] bg-cb-bg-1 border-b border-cb-line-0 text-xs select-none";
  // removed unused variables
  const versionLabel = version ? `v${version}` : "";
  const renderStatus = () => {
    switch (state.kind) {
      case "idle":
        return
        <div className="flex items-center gap-2 text-cb-fg-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-cb-fg-3" />
          <span></span>
        </div>;
      case "checking":
        return <div className="flex items-center gap-2 text-cb-fg-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-cb-fg-3 animate-pulse" />
          <span>Verificando…</span>
        </div>;
      case "up_to_date":
        return <div className="flex items-center gap-2 text-cb-success">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-cb-success" />
          <span>Atualizado</span>
        </div>;
      case "available":
      case "downloading":
        {
          const percent = state.kind === "downloading" ? state.percent : 0;
          return <div className="flex items-center gap-2 text-cb-warn">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-cb-warn animate-pulse" />
            <span>Baixando v{state.version}</span>
            {percent > 0 && <React.Fragment>
              <div className="h-1 w-20 bg-cb-bg-3 rounded-cb-1 overflow-hidden">
                <div className="h-full bg-cb-warn transition-all duration-300" style={{
                  width: `${Math.max(2, percent)}%`
                }} />
              </div>
              <span className="text-cb-warn">{Math.round(percent)}%</span>
            </React.Fragment>}
          </div>;
        }
      case "downloaded":
        return <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-cb-success">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-cb-success" />
            <span>v{state.version} pronta</span>
          </div>
          <button onClick={() => {
            setState({ kind: "installing", version: state.version });
            void window.codeBrainApp.update.install().then(result => {
              if (!result.ok) {
                setState({
                  kind: "error",
                  message: result.error ?? "falha ao iniciar update"
                });
              }
            });
          }} className="cb-btn" style={{ WebkitAppRegion: 'no-drag' } as any}>
            Reiniciar agora
          </button>
        </div>;
      case "installing":
        return <div className="flex items-center gap-2 text-cb-info">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-cb-info animate-pulse" />
          <span>Instalando v{state.version}…</span>
        </div>;
      case "error":
        return <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-cb-danger">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-cb-danger" />
            <span>Erro: {state.message.slice(0, 60)}</span>
          </div>
          <button onClick={() => window.codeBrainApp.update.check()} className="px-2 py-0.5 text-cb-fg-1 hover:text-cb-fg-0 transition-colors">
            Tentar de novo
          </button>
        </div>;
    }
  };
  return <div className={`${baseClasses} h-[38px] shrink-0 relative`}>
    {/* Background drag region */}
    <div className="absolute inset-0" style={{ WebkitAppRegion: 'drag' } as any} />

    {/* Content wrapper */}
    <div className="relative z-10 flex items-center justify-between w-full h-full pointer-events-none">
      <div className="flex items-center gap-2 text-cb-fg-2 tabular-nums">{versionLabel}</div>
      <div className="pointer-events-auto flex items-center mr-4" style={{ WebkitAppRegion: 'no-drag' } as any}>
        {renderStatus()}
      </div>
    </div>
  </div>;
}
