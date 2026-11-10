import React from "react";
import { X } from "lucide-react";
import { xtermExports, addonFitExports, L } from "../../lib/xterm-exports";
import { TERMINAL_THEMES, FONT_OPTIONS, useTerminalSettings } from "../../stores/terminal-settings-store";
import { PaneTitle } from "../panes/PaneTitle";
import { PaneIdBadge } from "../panes/PaneIdBadge";
import { cliIdentity, modelShortName } from "../panes/pane-identity";
import "../../styles/terminal.css";
import { terminalThemeFromTokens } from "./xterm-theme";

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
  const fontStack = (FONT_OPTIONS.find(f => f.id === fontFamilyId) ?? FONT_OPTIONS[0]).stack;

  // PTY pane info (may not be available if pane was killed)
  const [paneInfo, setPaneInfo] = React.useState<any>(null);

  React.useEffect(() => {
    window.codeBrainApp?.pty?.list?.().then((result: any) => {
      const panes = Array.isArray(result) ? result : result?.panes;
      const found = panes?.find((p: any) => p.paneId === paneId);
      if (found) setPaneInfo(found);
    }).catch(() => {});
  }, [paneId]);

  // Init xterm
  React.useEffect(() => {
    if (!containerRef.current || termRef.current) return;

    const term = new xtermExports.Terminal({
      theme: terminalThemeFromTokens(TERMINAL_THEMES[theme]),
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
    <div className="cb-pane h-screen" data-active="true" style={{ "--cb-status-color": "var(--cb-accent)" } as React.CSSProperties}>
      <div className="cb-pane-head" style={{ WebkitAppRegion: "drag", cursor: "default" } as React.CSSProperties}>
        <span className="cb-pane-prompt" aria-hidden>❯</span>
        <PaneTitle pane={{ agent: paneInfo?.agent, label: paneInfo?.label }} />
        <div className="cb-pane-meta">
          {paneInfo?.agent && <span className="cb-pane-meta-item" style={{ "--cb-meta-color": cliIdentity(paneInfo.agent).color } as React.CSSProperties}>{cliIdentity(paneInfo.agent).label}</span>}
          {modelShortName(paneInfo?.model) && <span className="cb-pane-meta-item">{modelShortName(paneInfo?.model)}</span>}
        </div>
        <div className="cb-pane-right" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <PaneIdBadge paneId={paneId} />
          <button type="button" onClick={handleClose} className="cb-pane-action" data-danger="true" aria-label="Fechar janela" title="Fechar janela">
            <X size={13} strokeWidth={1.5} aria-hidden />
          </button>
        </div>
      </div>

      <div className="cb-pane-well">
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  );
}
