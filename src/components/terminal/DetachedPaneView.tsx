import React from "react";
import { X, Terminal as TerminalIcon } from "lucide-react";
import { xtermExports, addonFitExports, L } from "../../lib/xterm-exports";
import { WebglAddon } from "@xterm/addon-webgl";
import { TERMINAL_THEMES, FONT_OPTIONS, useTerminalSettings } from "../../stores/terminal-settings-store";
import { PaneTitle } from "../panes/PaneTitle";
import { PaneIdBadge } from "../panes/PaneIdBadge";

/**
 * Minimal single-pane view for a detached terminal window.
 * Opens in its own Electron BrowserWindow via ?detachedPane=<id>.
 */
export function DetachedPaneView({ paneId, workspacePath }: { paneId: string; workspacePath: string }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const termRef = React.useRef<any>(null);
  const fitAddonRef = React.useRef<any>(null);

  const fontSize = useTerminalSettings(s => s.fontSize);
  const fontFamilyId = useTerminalSettings(s => s.fontFamily);
  const lineHeight = useTerminalSettings(s => s.lineHeight);
  const theme = useTerminalSettings(s => s.theme);
  const cursorBlink = useTerminalSettings(s => s.cursorBlink);
  const gpuAcceleration = useTerminalSettings(s => s.gpuAcceleration);
  const fontStack = (FONT_OPTIONS.find(f => f.id === fontFamilyId) ?? FONT_OPTIONS[0]).stack;

  // PTY pane info (may not be available if pane was killed)
  const [paneInfo, setPaneInfo] = React.useState<any>(null);

  React.useEffect(() => {
    window.codeBrainApp?.pty?.list?.().then((result: any) => {
      if (result?.ok) {
        const found = result.panes?.find((p: any) => p.paneId === paneId);
        if (found) setPaneInfo(found);
      }
    }).catch(() => {});
  }, [paneId]);

  // Init xterm
  React.useEffect(() => {
    if (!containerRef.current || termRef.current) return;

    const term = new xtermExports.Terminal({
      theme: TERMINAL_THEMES[theme],
      fontFamily: fontStack,
      fontSize,
      lineHeight: Math.max(1, lineHeight),
      cursorBlink,
      scrollback: 5000,
    });

    const fitAddon = new addonFitExports.FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new L((url: string) => window.open(url, "_blank")));

    term.open(containerRef.current);

    if (gpuAcceleration) {
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch (e) {
        console.warn("WebGL addon failed, falling back", e);
      }
    }

    fitAddon.fit();
    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Focus terminal
    term.focus();

    return () => {
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Stream PTY output to xterm
  React.useEffect(() => {
    const unsub = window.codeBrainApp?.pty?.onOutput?.((outputPaneId: string, data: string) => {
      if (outputPaneId !== paneId) return;
      termRef.current?.write(data);
    });

    // Get recent output to restore terminal state
    window.codeBrainApp?.pty?.readRawText?.(paneId).then((result: any) => {
      if (result?.ok && result.text && termRef.current) {
        termRef.current.write(result.text);
      }
    }).catch(() => {});

    return () => { if (typeof unsub === "function") unsub(); };
  }, [paneId]);

  // Stream user input to PTY
  React.useEffect(() => {
    if (!termRef.current) return;
    const term = termRef.current;
    const handler = term.onData((data: string) => {
      window.codeBrainApp?.pty?.write(paneId, data);
    });
    return () => handler.dispose();
  }, [paneId]);

  // Resize handler
  React.useEffect(() => {
    const resize = () => {
      fitAddonRef.current?.fit();
      const term = termRef.current;
      if (term) {
        window.codeBrainApp?.pty?.resize(paneId, term.cols, term.rows);
      }
    };
    window.addEventListener("resize", resize);
    const observer = new ResizeObserver(resize);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => {
      window.removeEventListener("resize", resize);
      observer.disconnect();
    };
  }, [paneId]);

  // Handle pane exit
  React.useEffect(() => {
    const unsub = window.codeBrainApp?.pty?.onExit?.((exitPaneId: string) => {
      if (exitPaneId === paneId) {
        termRef.current?.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
      }
    });
    return () => { if (typeof unsub === "function") unsub(); };
  }, [paneId]);

  const handleClose = React.useCallback(() => {
    window.close();
  }, []);

  return (
    <div className="flex flex-col h-screen bg-[#0B0B0E] overflow-hidden">
      {/* Minimal header */}
      <div
        className="h-9 shrink-0 bg-black/50 border-b border-white/[0.06] flex items-center px-3 gap-3"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <TerminalIcon size={13} className="text-gray-500" />
        <span className="font-mono text-[10px] text-gray-400 uppercase tracking-widest font-bold">DETACHED</span>
        <div className="w-px h-4 bg-white/10" />
        <PaneTitle pane={{ id: paneId, model: paneInfo?.model, providerId: paneInfo?.providerId, agent: paneInfo?.agent }} />
        <PaneIdBadge paneId={paneId} />
        <div className="flex-1" style={{ WebkitAppRegion: "drag" } as React.CSSProperties} />
        <button
          onClick={handleClose}
          className="text-gray-500 hover:text-red-400 px-2 py-1 rounded transition-colors cursor-pointer"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          title="Fechar janela"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>

      {/* Terminal */}
      <div ref={containerRef} className="flex-1 min-h-0" />
    </div>
  );
}
