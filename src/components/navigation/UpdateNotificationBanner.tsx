import React from "react";
import { RELEASES } from "./releases-data";

// UpdateNotificationBanner
export function UpdateNotificationBanner() {
  const [state, setState] = React.useState({
    kind: "idle"
  });
  const [version, setVersion] = React.useState("");
  React.useEffect(() => {
    window.codeBrainApp.app.version().then(setVersion).catch(() => {});
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
    return () => {
      off1();
      off2();
      off3();
      off4();
      off5();
      off6();
    };
  }, []);
  const baseClasses = "fixed top-0 left-0 right-0 z-[9999] flex items-center justify-between pl-20 pr-[140px] bg-gray-900/95 backdrop-blur border-b border-gray-700/60 font-mono text-[10px] shadow-lg";
  const dragStyle = {
    WebkitAppRegion: "drag",
    height: "38px"
  } as React.CSSProperties;
  const noDragStyle = {
    WebkitAppRegion: "no-drag"
  };
  const versionLabel = version ? `v${version}` : "";
  const renderStatus = () => {
    switch (state.kind) {
      case "idle":
        return <div className="flex items-center gap-2 text-gray-500">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-gray-600" />
            <span>—</span>
          </div>;
      case "checking":
        return <div className="flex items-center gap-2 text-gray-400">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-gray-500 animate-pulse" />
            <span>Verificando…</span>
          </div>;
      case "up_to_date":
        return <div className="flex items-center gap-2 text-green-500">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
            <span>Atualizado</span>
          </div>;
      case "available":
      case "downloading":
        {
          const percent = state.kind === "downloading" ? state.percent : 0;
          return <div className="flex items-center gap-2 text-amber-400">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span>Baixando v{state.version}</span>
            {percent > 0 && <React.Fragment>
                <div className="h-1 w-20 bg-gray-800 rounded overflow-hidden">
                  <div className="h-full bg-amber-400 transition-all duration-300" style={{
                  width: `${Math.max(2, percent)}%`
                }} />
                </div>
                <span className="text-amber-500/70">{Math.round(percent)}%</span>
              </React.Fragment>}
          </div>;
        }
      case "downloaded":
        return <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-green-400">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
              <span>v{state.version} pronta</span>
            </div>
            <button onClick={() => {
            void window.codeBrainApp.update.install().then(result => {
              if (!result.ok) {
                setState({
                  kind: "error",
                  message: result.error ?? "falha ao iniciar update"
                });
              }
            });
          }} style={{
            WebkitAppRegion: "no-drag",
            cursor: "pointer"
          }} className="px-2 py-0.5 text-green-400 border border-green-500/30 hover:border-green-500/60 hover:bg-green-500/10 rounded transition-colors">
              Reiniciar agora
            </button>
          </div>;
      case "error":
        return <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 text-red-400">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
              <span>Erro: {state.message.slice(0, 60)}</span>
            </div>
            <button onClick={() => window.codeBrainApp.update.check()} className="px-2 py-0.5 text-gray-400 hover:text-gray-200 transition-colors">
              Tentar de novo
            </button>
          </div>;
    }
  };
  return <div className={baseClasses} style={dragStyle}>
      <div className="flex items-center gap-2 text-gray-500">
        <span className="text-gray-600">CodeBrain</span>
        <span className="text-gray-300">{versionLabel}</span>
      </div>
      <div style={noDragStyle}>{renderStatus()}</div>
    </div>;
}
