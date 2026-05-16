import React from "react";
import { X$1 } from "../../stores/providers-store";
import { usePushToTalk, spawnedPaneIds, openWebLink } from "../../stores/voice-store";
import { xtermExports, addonFitExports, L } from "../../lib/xterm-exports";

// TerminalPane
import { usePanesStore } from "../../stores/panes-store";
import { FONT_OPTIONS, TERMINAL_THEMES, useTerminalSettings } from "../../stores/terminal-settings-store";
import { StatusDot, shortenPath } from "../panes/StatusDot";
import { PaneTitle } from "../panes/PaneTitle";
import { ProviderBadge } from "../panes/ProviderBadge";
import { SavedContextPanel } from "../panes/SavedContextPanel";
export function TerminalPane({
  pane,
  isActive,
  onClick
}) {
  const containerRef = React.useRef(null);
  const termRef = React.useRef(null);
  const fitAddonRef = React.useRef(null);
  const spawnedRef = React.useRef(false);
  const paneRef = React.useRef(pane);
  paneRef.current = pane;
  const updatePane = usePanesStore(s => s.updatePane);
  const updatePaneRef = React.useRef(updatePane);
  updatePaneRef.current = updatePane;
  const fontSize = useTerminalSettings(s => s.fontSize);
  const fontFamilyId = useTerminalSettings(s => s.fontFamily);
  const lineHeight = useTerminalSettings(s => s.lineHeight);
  const theme = useTerminalSettings(s => s.theme);
  const fontStack = (FONT_OPTIONS.find(f => f.id === fontFamilyId) ?? FONT_OPTIONS[0]).stack;
  const [dropHover, setDropHover] = React.useState(false);
  const [showSavedContext, setShowSavedContext] = React.useState(true);
  const pushToTalk = usePushToTalk({
    paneId: pane.id,
    enabled: isActive
  });
  const handlePushToTalkKeyRef = React.useRef(pushToTalk.handleKeyEvent);
  React.useEffect(() => {
    handlePushToTalkKeyRef.current = pushToTalk.handleKeyEvent;
  }, [pushToTalk.handleKeyEvent]);
  const activatePane = React.useCallback(() => {
    if (!isActive) onClick();
    termRef.current?.focus();
  }, [isActive, onClick]);
  const handleFocusCapture = React.useCallback(event => {
    if (!(event.target instanceof HTMLElement)) return;
    if (event.target.closest(".xterm")) activatePane();
  }, [activatePane]);
  const initTerminal = React.useCallback(() => {
    if (!containerRef.current || termRef.current) return;
    const currentPane = paneRef.current;
    const term = new xtermExports.Terminal({
      theme: TERMINAL_THEMES[theme],
      fontFamily: fontStack,
      fontSize,
      lineHeight: Math.max(1, lineHeight),
      cursorBlink: true,
      scrollback: 5e3
    });
    const fitAddon = new addonFitExports.FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new L(openWebLink));
    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current = term;
    fitAddonRef.current = fitAddon;
    term.attachCustomKeyEventHandler(e => {
      if (handlePushToTalkKeyRef.current(e)) return false;
      if (e.type !== "keydown") return true;
      const write = seq => {
        window.codeBrainApp?.pty.write(currentPane.id, seq);
        e.preventDefault();
        return false;
      };
      if (e.shiftKey && e.key === "Backspace") return write("");
      if (e.shiftKey && e.key === "Enter") return write("\x1B\r");
      if (e.metaKey) {
        if (e.key === "Backspace") return write("");
        if (e.key === "Delete") return write("");
        if (e.key === "ArrowLeft") return write("");
        if (e.key === "ArrowRight") return write("");
      }
      if (e.altKey) {
        if (e.key === "Backspace") return write("");
        if (e.key === "ArrowLeft") return write("\x1Bb");
        if (e.key === "ArrowRight") return write("\x1Bf");
      }
      if (e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === "Backspace") return write("");
        if (e.key === "Delete") return write("\x1Bd");
      }
      if (e.key === "F5" || (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        return false;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        navigator.clipboard.readText().then(text => {
          if (text) window.codeBrainApp?.pty.write(currentPane.id, text);
        }).catch(() => {});
        return false;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "c") {
        const sel = term.getSelection();
        if (sel) {
          e.preventDefault();
          navigator.clipboard.writeText(sel).catch(() => {});
          return false;
        }
      }
      return true;
    });
    term.onData(data => {
      window.codeBrainApp?.pty.write(currentPane.id, data);
    });
    if (currentPane.externallySpawned || spawnedPaneIds.has(currentPane.id)) {
      spawnedRef.current = true;
      updatePaneRef.current(currentPane.id, {
        status: "running"
      });
    } else if (window.codeBrainApp && !spawnedRef.current) {
      spawnedRef.current = true;
      spawnedPaneIds.add(currentPane.id);
      window.codeBrainApp.pty.spawn({
        paneId: currentPane.id,
        agent: currentPane.agent,
        cwd: currentPane.cwd,
        args: currentPane.args,
        activityId: currentPane.activityId,
        subtaskId: currentPane.subtaskId,
        providerId: currentPane.providerId,
        model: currentPane.model,
        session: currentPane.session,
        claudeSessionId: currentPane.claudeSessionId,
        permissionMode: currentPane.permissionMode
      }).then(result => {
        if (result.ok) {
          updatePaneRef.current(currentPane.id, {
            status: "running"
          });
        } else {
          spawnedPaneIds.delete(currentPane.id);
          term.writeln(`\x1B[31m[CODEBRAIN] Spawn failed: ${result.error ?? "unknown"}\x1B[0m`);
          updatePaneRef.current(currentPane.id, {
            status: "error"
          });
        }
      }).catch(err => {
        spawnedPaneIds.delete(currentPane.id);
        term.writeln(`\x1B[31m[CODEBRAIN] Spawn error: ${String(err)}\x1B[0m`);
        updatePaneRef.current(currentPane.id, {
          status: "error"
        });
      });
    } else {
      term.writeln("\x1B[33m[CODEBRAIN] IPC not available (renderer-only mode)\x1B[0m");
      updatePaneRef.current(currentPane.id, {
        status: "idle"
      });
    }
  }, [pane.id]);
  React.useEffect(() => {
    const unsub = window.codeBrainApp?.pty.onOutput((paneId, data, echo) => {
      if (paneId === pane.id && termRef.current) {
        // Suppress echo from programmatic writes (MCP pane_write / pane_send_message)
        // so the sent text doesn't appear duplicated in the terminal
        if (echo) return;
        termRef.current.write(data);
      }
    });
    const unsubExit = window.codeBrainApp?.pty.onExit((paneId) => {
      if (paneId === pane.id) {
        spawnedPaneIds.delete(pane.id);
      }
    });
    return () => { unsub?.(); unsubExit?.(); };
  }, [pane.id]);
  React.useEffect(() => {
    initTerminal();
    return () => {
      const term = termRef.current;
      if (term) {
        term.dispose();
        termRef.current = null;
        fitAddonRef.current = null;
      }
    };
  }, [initTerminal]);
  React.useEffect(() => {
    const doFit = () => {
      if (!containerRef.current) return;
      if (containerRef.current.clientWidth < 10 || containerRef.current.clientHeight < 10) return;
      try {
        fitAddonRef.current?.fit();
      } catch (err) {}
      const term = termRef.current;
      if (term && term.cols > 2 && term.rows > 2 && window.codeBrainApp) {
        window.codeBrainApp.pty.resize(pane.id, term.cols, term.rows).catch(() => {});
      }
    };
    const obs = new ResizeObserver(doFit);
    if (containerRef.current) obs.observe(containerRef.current);
    const intObs = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) doFit();
    }, {
      threshold: 0.01
    });
    if (containerRef.current) intObs.observe(containerRef.current);
    const timers = [50, 300].map(ms => setTimeout(doFit, ms));
    return () => {
      obs.disconnect();
      intObs.disconnect();
      timers.forEach(clearTimeout);
    };
  }, []);
  React.useEffect(() => {
    if (!isActive) return;
    termRef.current?.focus();
    const t = setTimeout(() => {
      if (!containerRef.current || containerRef.current.clientWidth < 10 || containerRef.current.clientHeight < 10) return;
      try {
        fitAddonRef.current?.fit();
      } catch (err) {}
      const term = termRef.current;
      if (term && term.cols > 2 && term.rows > 2 && window.codeBrainApp) {
        window.codeBrainApp.pty.resize(pane.id, term.cols, term.rows).catch(() => {});
      }
    }, 50);
    return () => clearTimeout(t);
  }, [isActive, pane.id]);
  React.useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    fitAddonRef.current?.fit();
  }, [fontSize]);
  React.useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = TERMINAL_THEMES[theme];
  }, [theme]);
  React.useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = fontStack;
    fitAddonRef.current?.fit();
  }, [fontStack]);
  React.useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.lineHeight = Math.max(1, lineHeight);
    fitAddonRef.current?.fit();
  }, [lineHeight]);
  const handleDrop = React.useCallback(async e => {
    e.preventDefault();
    setDropHover(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    const api = window.codeBrainApp;
    if (!api) return;
    const paths = [];
    for (const f of files) {
      let p = "";
      try {
        p = api.files.pathForFile(f);
      } catch {
        p = "";
      }
      if (!p) {
        const buf = await f.arrayBuffer();
        const res = await api.files.saveDropped(f.name || "dropped.bin", buf);
        if (res?.ok && res.path) p = res.path;
      }
      if (p) paths.push(p);
    }
    if (paths.length === 0) return;
    const text = paths.map(p => /\s/.test(p) ? `"${p}"` : p).join(" ");
    api.pty.write(pane.id, text + " ");
  }, [pane.id]);
  return <div className={`flex flex-col h-full border cursor-pointer ${isActive ? "border-indigo-500/40 shadow-[0_0_12px_rgba(239,68,68,0.1)]" : "border-white/5 hover:border-white/10"} rounded-lg overflow-hidden bg-black backdrop-blur transition-all duration-300 relative group`} onClick={activatePane} onFocusCapture={handleFocusCapture} onPointerDownCapture={activatePane}>
      <div className="absolute top-2 right-2 z-10 flex items-center gap-2 opacity-30 group-hover:opacity-100 transition-opacity duration-300 bg-black/60 backdrop-blur-sm border border-white/10 rounded-md px-2 py-1 select-none cursor-grab active:cursor-grabbing" draggable onDragStart={e => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/x-codebrain-pane", pane.id);
    }}>
        <StatusDot status={pane.status} />
        <PaneTitle pane={pane} />
        <ProviderBadge providerId={pane.providerId} model={pane.model} />
        <button className="text-gray-500 hover:text-indigo-400 ml-1 leading-none transition-colors" onClick={e => {
        e.stopPropagation();
        window.codeBrainApp?.pty.kill(pane.id);
        spawnedPaneIds.delete(pane.id);
        usePanesStore.getState().removePane(pane.id);
      }} title="Close pane (Cmd+W)">
          <X$1 size={10} strokeWidth={2} />
        </button>
      </div>
      <div className="relative z-0 h-full flex flex-col">
        <SavedContextPanel pane={pane} open={showSavedContext} onToggle={() => setShowSavedContext(v2 => !v2)} />
        <div className={`flex-1 min-h-0 relative ${dropHover ? "ring-2 ring-red-500/40" : ""}`} onDragEnter={e => {
      if (e.dataTransfer.types.includes("Files")) {
        e.preventDefault();
        setDropHover(true);
      }
    }} onDragOver={e => {
      if (e.dataTransfer.types.includes("Files")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    }} onDragLeave={e => {
      if (e.currentTarget === e.target) setDropHover(false);
    }} onDrop={handleDrop}>
        
        <div className="absolute inset-0 px-2 pt-2 pb-6 overflow-hidden">
          <div ref={containerRef} className="h-full w-full" />
        </div>
        
        {/* Input Feedback Rodapé */}
        <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-black to-transparent pointer-events-none flex items-end px-3 pb-1">
          <div className="flex items-center gap-2 w-full border-t border-white/5 pt-1">
            <span className="text-red-500 font-mono text-[10px] font-bold">❯</span>
            {pane.status === "running" ? (
              <span className="flex items-center gap-2 text-[10px] font-mono text-red-400/80">
                <span className="w-1.5 h-3 bg-red-500 animate-pulse"></span>
                agent thinking...
              </span>
            ) : (
              <span className="w-1.5 h-3 bg-gray-500/50 animate-[pulse_2s_infinite]"></span>
            )}
          </div>
        </div>
      </div>
    </div>
  </div>;
}
function stripAnsi(text) {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "");
}
export function savedContextLines(lines) {
  if (!lines?.length) return [];
  return lines.map(line => stripAnsi(line).trimEnd()).filter(line => line.trim().length > 0).slice(-8);
}