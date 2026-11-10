import React from "react";
import { X$1 } from "../../stores/providers-store";
import { usePushToTalk, spawnedPaneIds, openWebLink } from "../../stores/voice-store";
import { xtermExports, addonFitExports, L } from "../../lib/xterm-exports";
import { CODEBRAIN_PANE_DRAG_TYPE } from "../../lib/pane-drag";
import { Copy, Clipboard, Square, MessageSquare, Settings, Moon, Zap } from "lucide-react";
import "../../styles/terminal.css";

// TerminalPane
import { usePanesStore } from "../../stores/panes-store";
import { FONT_OPTIONS, TERMINAL_THEMES, useTerminalSettings } from "../../stores/terminal-settings-store";
import { PaneHeader } from "../panes/PaneHeader";
import { PaneIdBadge } from "../panes/PaneIdBadge";
import { PaneTokenBadge } from "../panes/PaneTokenBadge";
import { MissionBadge } from "../panes/MissionBadge";
import { SavedContextPanel } from "../panes/SavedContextPanel";
import { paneDisplayName } from "../panes/pane-identity";
import { notePaneInput } from "../panes/pane-runtime";
import { paneActivityPresentation } from "../shell/pane-status";
import { observeTokenTheme, terminalThemeFromTokens, useBrandTerminalFont } from "./xterm-theme";

/** Wait for xterm cols/rows to stabilize across animation frames before syncing to PTY. */
async function waitForReplayFit(container: HTMLElement, fitAddon: any, term: any, isCurrent: () => boolean) {
  let lastCols = -1;
  let lastRows = -1;
  let stableFrames = 0;
  for (let i = 0; i < 60; i++) {
    if (!isCurrent()) return false;
    if (container.clientWidth >= 10 && container.clientHeight >= 10) {
      try { fitAddon.fit(); } catch {}
      if (term.cols >= 20) {
        if (term.cols === lastCols && term.rows === lastRows) {
          stableFrames++;
          if (stableFrames >= 2) return true;
        } else {
          stableFrames = 0;
        }
        lastCols = term.cols;
        lastRows = term.rows;
      }
    }
    await new Promise(r => requestAnimationFrame(() => r(undefined)));
  }
  return false;
}

export function TerminalPane({
  pane,
  isActive,
  onClick
}) {
  const containerRef = React.useRef(null);
  const termRef = React.useRef(null);
  const fitAddonRef = React.useRef(null);
  const spawnedRef = React.useRef(false);
  // Cancelable paste queue
  const pasteQueueRef = React.useRef<string[]>([]);
  const pastingRef = React.useRef(false);
  const paneRef = React.useRef(pane);
  paneRef.current = pane;
  const updatePane = usePanesStore(s => s.updatePane);
  const updatePaneRef = React.useRef(updatePane);
  updatePaneRef.current = updatePane;
  const fontSize = useTerminalSettings(s => s.fontSize);
  const fontFamilyId = useTerminalSettings(s => s.fontFamily);
  const lineHeight = useTerminalSettings(s => s.lineHeight);
  const theme = useTerminalSettings(s => s.theme);
  const cursorBlink = useTerminalSettings(s => s.cursorBlink);
  const scrollbackSize = useTerminalSettings(s => (s as any).scrollbackSize ?? 5000);
  const baseFontStack = (FONT_OPTIONS.find(f => f.id === fontFamilyId) ?? FONT_OPTIONS[0]).stack;
  const fontStack = useBrandTerminalFont(fontFamilyId, baseFontStack);
  const [dropHover, setDropHover] = React.useState(false);
  const [showSavedContext, setShowSavedContext] = React.useState(true);
  const [envPopup, setEnvPopup] = React.useState(false);
  const [envKey, setEnvKey] = React.useState('');
  const [envValue, setEnvValue] = React.useState('');
  const [contextMenu, setContextMenu] = React.useState<{ x: number, y: number } | null>(null);
  const savedSelectionRef = React.useRef('');
  const lastPtySizeRef = React.useRef<{ cols: number; rows: number } | null>(null);

  const handleRightMouseDownCapture = React.useCallback((e: React.MouseEvent) => {
    if (e.button === 2) {
      savedSelectionRef.current = termRef.current?.getSelection() ?? '';
    }
  }, []);

  const handleContextMenu = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();

    const rect = e.currentTarget.getBoundingClientRect();
    // Account for CSS zoom: getBoundingClientRect returns zoomed values,
    // but CSS pixel positions inside the element are unzoomed
    const zoom = rect.width / (e.currentTarget as HTMLElement).offsetWidth || 1;
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;

    const menuWidth = 160;
    const menuHeight = 130;
    const containerWidth = (e.currentTarget as HTMLElement).offsetWidth;
    const containerHeight = (e.currentTarget as HTMLElement).offsetHeight;

    let adjustedX = x;
    let adjustedY = y;

    if (x + menuWidth > containerWidth) adjustedX = Math.max(0, x - menuWidth);
    if (y + menuHeight > containerHeight) adjustedY = Math.max(0, y - menuHeight);
    if (adjustedX < 0) adjustedX = 0;
    if (adjustedY < 0) adjustedY = 0;

    setContextMenu({ x: adjustedX, y: adjustedY });
  }, []);

  const closeMenu = React.useCallback(() => setContextMenu(null), []);

  const copyToClipboard = React.useCallback(() => {
    const sel = savedSelectionRef.current;
    if (sel) window.codeBrainApp?.app.copyToClipboard(sel);
    closeMenu();
  }, [closeMenu]);

  const pasteFromClipboard = React.useCallback(async () => {
    try {
      const text = await window.codeBrainApp?.app.readFromClipboard();
      if (text) window.codeBrainApp?.pty.write(pane.id, text);
    } catch { }
    closeMenu();
  }, [pane.id, closeMenu]);

  const stopTerminal = React.useCallback(() => {
    window.codeBrainApp?.pty.kill(pane.id);
    closeMenu();
  }, [pane.id, closeMenu]);

  const sendQuickCommand = React.useCallback((cmd: string) => {
    if (cmd === "/btw") {
      window.codeBrainApp?.pty.write(pane.id, "/btw ");
    }
  }, [pane.id]);

  const handleSaveEnvVar = React.useCallback(async () => {
    const k = envKey.trim();
    if (!k) return;
    // Persist to config store
    try {
      const cfg = await (window as any).codeBrainApp?.appConfig?.get?.();
      const prev = (cfg?.globalEnv ?? {}) as Record<string, string>;
      await (window as any).codeBrainApp?.appConfig?.set?.({ globalEnv: { ...prev, [k]: envValue } });
    } catch {}
    // Also write to current terminal session for immediate use
    window.codeBrainApp?.pty.write(pane.id, `export ${k}=${envValue}\r`);
    setEnvKey('');
    setEnvValue('');
    setEnvPopup(false);
  }, [envKey, envValue, pane.id]);

  // Close env popup on outside click
  React.useEffect(() => {
    if (!envPopup) return;
    const close = () => setEnvPopup(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [envPopup]);

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
  // Controles do header (nome, detalhes) ativam o pane sem roubar o foco para
  // o xterm — senão o campo de renomear perderia o cursor a cada clique.
  const handlePointerDownCapture = React.useCallback((event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest?.("[data-pane-control]")) {
      if (!isActive) onClick();
      return;
    }
    activatePane();
  }, [activatePane, isActive, onClick]);
  const handleRootClick = React.useCallback((event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest?.("[data-pane-control]")) return;
    activatePane();
  }, [activatePane]);
  const handleFocusCapture = React.useCallback(event => {
    if (!(event.target instanceof HTMLElement)) return;
    if (event.target.closest(".xterm")) activatePane();
  }, [activatePane]);

  /** Force-fit + redraw + sync dims to PTY. */
  const recoverTerminalRender = React.useCallback((options: { refresh?: boolean } = {}) => {
    const shouldRefresh = options.refresh ?? true;
    const term = termRef.current;
    const container = containerRef.current;
    if (!term || !container || container.clientWidth < 10 || container.clientHeight < 10) return;
    try { fitAddonRef.current?.fit(); } catch {}
    if (shouldRefresh) {
      try { term.refresh(0, Math.max(0, term.rows - 1)); } catch {}
    }
    const size = { cols: term.cols, rows: term.rows };
    const lastSize = lastPtySizeRef.current;
    if (window.codeBrainApp && size.cols > 2 && size.rows > 2 && (!lastSize || lastSize.cols !== size.cols || lastSize.rows !== size.rows)) {
      lastPtySizeRef.current = size;
      window.codeBrainApp.pty.resize(pane.id, size.cols, size.rows).catch(() => {});
    }
  }, [pane.id]);

  /** Drain paste queue in chunks with small delays, allows Esc cancel. */
  const drainPasteQueue = React.useCallback(async (paneId: string) => {
    if (pastingRef.current) return; // already draining
    pastingRef.current = true;
    while (pasteQueueRef.current.length > 0) {
      const chunk = pasteQueueRef.current.shift()!;
      window.codeBrainApp?.pty.write(paneId, chunk);
      await new Promise(r => setTimeout(r, 16));
    }
    pastingRef.current = false;
  }, []);

  const initTerminal = React.useCallback(() => {
    if (!containerRef.current || termRef.current) return;
    const currentPane = paneRef.current;
    const term = new xtermExports.Terminal({
      theme: terminalThemeFromTokens(TERMINAL_THEMES[theme]),
      fontFamily: fontStack,
      fontSize,
      lineHeight: Math.max(1, lineHeight),
      cursorBlink,
      scrollback: scrollbackSize
    });
    const fitAddon = new addonFitExports.FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new L(openWebLink));

    term.open(containerRef.current);

    // No addon renderer — xterm 6.0.0 uses its built-in DOM renderer (stable, no GPU deps)
    // Zoom is now handled natively via webContents.setZoomFactor (IPC app:set-zoom),
    // which keeps clientX/Y and getBoundingClientRect in the same coordinate space.

    termRef.current = term;
    fitAddonRef.current = fitAddon;
    // Wait for dimensions to stabilize before first fit (avoids flash of misaligned content)
    waitForReplayFit(containerRef.current, fitAddon, term, () => termRef.current === term).then((fitted) => {
      if (!fitted || termRef.current !== term) return;
      // External panes start at backend defaults; caching without sending this
      // resize leaves the CLI drawing for 220 columns into a much narrower grid.
      lastPtySizeRef.current = null;
      recoverTerminalRender({ refresh: true });
    });

    // Alt+Click: move cursor to clicked position in terminal
    term.element?.addEventListener('click', (e) => {
      if (!e.altKey) return;
      const rect = term.element.getBoundingClientRect();
      const core = term._core;
      const dims = core?._renderService?.dimensions ?? core?._renderer?.dimensions;
      const cellWidth = dims?.actualCellWidth ?? dims?.css?.cell?.width ?? 9;
      const cellHeight = dims?.actualCellHeight ?? dims?.css?.cell?.height ?? 17;
      const col = Math.max(1, Math.floor((e.clientX - rect.left) / cellWidth) + 1);
      const row = Math.max(1, Math.floor((e.clientY - rect.top) / cellHeight) + term.buffer.active.viewportY + 1);
      term.input('\x1b[' + row + ';' + col + 'H');
    });
    term.attachCustomKeyEventHandler(e => {
      if (handlePushToTalkKeyRef.current(e)) return false;
      if (e.type !== "keydown") return true;
      // Esc cancels pending paste queue
      if (e.key === "Escape" && pastingRef.current) {
        pasteQueueRef.current = [];
        pastingRef.current = false;
        return false;
      }
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
      // Allow Ctrl/Cmd + zoom keys to propagate to window (font size change)
      // Covers: Ctrl+=, Ctrl++, Ctrl+Shift+=, Ctrl+Shift++ (teclado ABNT2), Ctrl+-, Ctrl+_, Ctrl+0
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "=" || e.key === "+" || e.key === "-" || e.key === "_" || e.key === "0")) {
        return false; // prevent xterm from consuming, let window handler fire
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        (window.codeBrainApp?.app.readFromClipboard() ?? Promise.resolve("")).then(text => {
          if (!text) return;
          const CHUNK_SIZE = 100;
          if (text.length > 200) {
            pasteQueueRef.current = [];
            for (let i = 0; i < text.length; i += CHUNK_SIZE) {
              pasteQueueRef.current.push(text.slice(i, i + CHUNK_SIZE));
            }
            drainPasteQueue(currentPane.id);
          } else {
            window.codeBrainApp?.pty.write(currentPane.id, text);
          }
        }).catch(() => { });
        return false;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "c") {
        const sel = term.getSelection();
        if (sel) {
          e.preventDefault();
          window.codeBrainApp?.app.copyToClipboard(sel);
          return false;
        }
      }
      return true;
    });
    term.onData(data => {
      notePaneInput(currentPane.id);
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
      const config = {
        paneId: currentPane.id,
        cols: term.cols,
        rows: term.rows,
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
      };
      window.codeBrainApp.pty.spawn(config).then(result => {
        if (result.ok) {
          if (termRef.current === term) {
            // Earlier resize effects may have run before the process existed.
            lastPtySizeRef.current = null;
            recoverTerminalRender({ refresh: true });
          }
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
  }, [pane.id, recoverTerminalRender]);
  // Runtime cursorBlink update without re-creating terminal
  React.useEffect(() => {
    if (termRef.current) termRef.current.options.cursorBlink = cursorBlink;
  }, [cursorBlink]);
  React.useEffect(() => {
    const unsub = window.codeBrainApp?.pty.onOutput((paneId, data) => {
      if (paneId === pane.id && termRef.current) {
        // All output belongs to the TUI's ANSI state, including prompt redraws
        // previously marked as "echo" by older main-process bundles.
        // xterm follows output only when its viewport is already at the end.
        // Forcing scrollToBottom here races wheel/scrollbar/keyboard scrolling
        // and pulls readers out of history on every streamed chunk.
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
    const obs = new ResizeObserver(() => recoverTerminalRender({ refresh: true }));
    if (containerRef.current) obs.observe(containerRef.current);
    const intObs = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) recoverTerminalRender({ refresh: true });
    }, { threshold: 0.01 });
    if (containerRef.current) intObs.observe(containerRef.current);
    const timers = [50, 300].map(ms => setTimeout(() => recoverTerminalRender({ refresh: true }), ms));
    return () => {
      obs.disconnect();
      intObs.disconnect();
      timers.forEach(clearTimeout);
    };
  }, [recoverTerminalRender]);
  React.useEffect(() => {
    if (!isActive) return;
    termRef.current?.focus();
    const t = setTimeout(() => recoverTerminalRender({ refresh: true }), 50);
    return () => clearTimeout(t);
  }, [isActive, pane.id, recoverTerminalRender]);
  React.useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    recoverTerminalRender({ refresh: true });
  }, [fontSize, recoverTerminalRender]);
  React.useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = terminalThemeFromTokens(TERMINAL_THEMES[theme]);
    return observeTokenTheme(() => {
      if (termRef.current) termRef.current.options.theme = terminalThemeFromTokens(TERMINAL_THEMES[theme]);
    });
  }, [theme]);
  React.useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = fontStack;
    recoverTerminalRender({ refresh: true });
  }, [fontStack, recoverTerminalRender]);
  React.useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.lineHeight = Math.max(1, lineHeight);
    recoverTerminalRender({ refresh: true });
  }, [lineHeight, recoverTerminalRender]);
  // Live-update scrollback when setting changes (applies to existing panes)
  React.useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.scrollback = scrollbackSize;
  }, [scrollbackSize]);
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
  const presentation = paneActivityPresentation(pane);
  const { name: paneName } = paneDisplayName(pane);

  const detachPane = () => {
    window.codeBrainApp?.pty?.detach(pane.id).then((result: any) => {
      // O pane passa a viver na própria janela; sai da grade desta.
      if (result?.ok) usePanesStore.getState().removePane(pane.id);
    });
  };

  const killPane = () => {
    window.codeBrainApp?.pty.kill(pane.id);
    spawnedPaneIds.delete(pane.id);
    usePanesStore.getState().removePane(pane.id);
  };

  return <div
    className="cb-pane group"
    role="group"
    aria-label={`Terminal ${paneName}, ${presentation.label}`}
    data-active={isActive}
    data-activity={presentation.activity}
    data-urgent={presentation.urgent}
    style={{ "--cb-status-color": presentation.color } as React.CSSProperties}
    onClick={handleRootClick}
    onFocusCapture={handleFocusCapture}
    onPointerDownCapture={handlePointerDownCapture}
    onMouseDownCapture={handleRightMouseDownCapture}
    onContextMenu={handleContextMenu}
  >
    {contextMenu && (
      <>
        <div className="absolute inset-0" style={{ zIndex: "var(--cb-z-popover)" }} onClick={closeMenu} onContextMenu={(e) => { e.preventDefault(); closeMenu(); }} />
        <div style={{ top: contextMenu.y, left: contextMenu.x }} className="cb-pane-context cb-float terminal-context-menu" role="menu" data-pane-control>
          <button role="menuitem" onClick={copyToClipboard} className="cb-menu-item">
            <Copy size={11} aria-hidden />
            <span>Copiar</span>
          </button>
          <button role="menuitem" onClick={pasteFromClipboard} className="cb-menu-item">
            <Clipboard size={11} aria-hidden />
            <span>Colar</span>
          </button>
          <hr className="cb-divider" />
          {pane.status === "hibernated" ? (
            <button role="menuitem" onClick={() => { window.codeBrainApp?.pty?.wake?.(pane.id); closeMenu(); }} className="cb-menu-item">
              <Zap size={11} aria-hidden />
              <span>Acordar terminal</span>
            </button>
          ) : (
            <button role="menuitem" onClick={() => { window.codeBrainApp?.pty?.hibernate?.(pane.id); closeMenu(); }} className="cb-menu-item">
              <Moon size={11} aria-hidden />
              <span>Hibernar terminal</span>
            </button>
          )}
          <button role="menuitem" onClick={stopTerminal} className="cb-menu-item" data-danger="true">
            <Square size={10} className="fill-current" aria-hidden />
            <span>Parar terminal</span>
          </button>
        </div>
      </>
    )}

    <PaneHeader pane={pane} onDetach={detachPane} onKill={killPane} onRenameEnd={() => termRef.current?.focus()} />

    <div className="cb-pane-body">
      <SavedContextPanel pane={pane} open={showSavedContext} onToggle={() => setShowSavedContext(v2 => !v2)} />
      <div className="cb-pane-drop" data-hover={dropHover} onDragEnter={e => {
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

        <div className="cb-pane-well">
          <div ref={containerRef} className="h-full w-full" />
        </div>

        <div className="cb-pane-foot" data-pane-control>
          <span className="cb-pane-foot-prompt" aria-hidden>❯</span>
          <PaneIdBadge paneId={pane.id} />
          <MissionBadge missionId={pane.missionId} workspacePath={pane.workspacePath ?? pane.cwd} />
          <PaneTokenBadge paneId={pane.id} isRunning={presentation.ticking} />
          <span className="cb-pane-foot-spacer" />

          <div className="cb-pane-quick" data-open={envPopup}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); sendQuickCommand("/btw"); }}
              className="cb-pane-quick-btn"
              title="Enviar dúvida ou pergunta (/btw)"
            >
              <MessageSquare size={10} aria-hidden />
              <span>/btw</span>
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setEnvPopup(!envPopup); }}
                className="cb-pane-quick-btn"
                aria-expanded={envPopup}
                title="Definir variável de ambiente (persiste e aplica neste terminal)"
              >
                <Settings size={10} aria-hidden />
                <span>/env</span>
              </button>
              {envPopup && (
                <div className="cb-env-pop cb-float" onClick={e => e.stopPropagation()}>
                  <p className="cb-label">variável de ambiente</p>
                  <input
                    type="text"
                    value={envKey}
                    onChange={e => setEnvKey(e.target.value)}
                    placeholder="CHAVE"
                    aria-label="Nome da variável"
                    className="cb-input"
                    onKeyDown={e => e.key === 'Enter' && handleSaveEnvVar()}
                    autoFocus
                  />
                  <input
                    type="text"
                    value={envValue}
                    onChange={e => setEnvValue(e.target.value)}
                    placeholder="valor"
                    aria-label="Valor da variável"
                    className="cb-input"
                    onKeyDown={e => e.key === 'Enter' && handleSaveEnvVar()}
                  />
                  <div className="cb-env-actions">
                    <button type="button" onClick={handleSaveEnvVar} disabled={!envKey.trim()} className="cb-env-save">
                      salvar e exportar
                    </button>
                    <button type="button" onClick={() => { setEnvPopup(false); setEnvKey(''); setEnvValue(''); }} className="cb-env-cancel">
                      cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); stopTerminal(); }}
              className="cb-pane-quick-btn"
              data-danger="true"
              aria-label="Parar execução"
              title="Parar execução"
            >
              <Square size={10} aria-hidden />
            </button>
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
