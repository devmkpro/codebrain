import React from "react";

// App, FatalScreen, AppErrorBoundary

// Browser-compatible path.basename
import { usePanesStore } from "../stores/panes-store";
import { useWorkspaceStore } from "../stores/workspace-store";
import { useNavStore } from "../stores/nav-store";
import { subscribeTaskUpdates } from "../stores/tasks-store";
import { subscribeProviderUpdates } from "../stores/providers-store";
import { useBrowserStore } from "../stores/browser-store";
import { useTerminalSettings } from "../stores/terminal-settings-store";
import { UpdateNotificationBanner } from "../components/navigation/UpdateNotificationBanner";
import { AuthGate } from "../components/auth/AuthGate";
// WorkspaceTabs moved into AppShell/AppHeader
import { AppShell } from "../components/ui/AppShell";
import { WhatsNewModal, LATEST_RELEASE_VERSION } from "../components/navigation/WhatsNewModal";
import { CliInstallModal } from "../components/modals/CliInstallModal";

function basename(p: string): string {
  return p.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? p;
}
export function App() {
  const panes = usePanesStore(s => s.panes);
  const addPane = usePanesStore(s => s.addPane);
  const removePane = usePanesStore(s => s.removePane);
  const setActive = usePanesStore(s => s.setActive);
  const activePaneId = usePanesStore(s => s.activePaneId);
  const workspace = useWorkspaceStore(s => s.path);
  const tabs = useNavStore(s => s.tabs);
  const activeTabIndex = useNavStore(s => s.activeTabIndex);
  const onHome = useNavStore(s => s.onHome);
  const activeTab = tabs[activeTabIndex];
  const [navHydrated, setNavHydrated] = React.useState(false);
  const [workspaceToast, setWorkspaceToast] = React.useState(null);
  const toastTimeout = React.useRef(null);
  const [cliMissing, setCliMissing] = React.useState(false);

  React.useEffect(() => {
    useNavStore.persist.rehydrate();
    setNavHydrated(true);

    // Check for OpenClaude CLI on startup
    const checkCli = async () => {
      try {
        const info = await (window as any).codeBrainApp?.cli?.detect();
        if (info && !info.openclaude.found) {
          setCliMissing(true);
        }
      } catch (err) {
        console.error("Failed to detect CLI:", err);
      }
    };
    checkCli();
  }, []);
  React.useEffect(() => {
    const handler = () => {
      const s = useNavStore.getState();
      const tab = s.tabs[s.activeTabIndex];
      const label = tab ? basename(tab.workspacePath) || tab.workspacePath : "Home";
      setWorkspaceToast(label);
      if (toastTimeout.current) clearTimeout(toastTimeout.current);
      toastTimeout.current = setTimeout(() => setWorkspaceToast(null), 800);
    };
    window.addEventListener("workspace-switched", handler);
    return () => window.removeEventListener("workspace-switched", handler);
  }, []);
  React.useEffect(() => {
    if (workspace) {
      window.codeBrainApp?.workspace?.set?.(workspace);
    }
  }, [workspace]);
  React.useEffect(() => {
    if (!onHome && activeTab?.workspacePath) {
      window.codeBrainApp?.workspace?.set?.(activeTab.workspacePath);
    }
  }, [onHome, activeTab?.workspacePath]);
  React.useEffect(() => {
    return subscribeTaskUpdates();
  }, []);
  React.useEffect(() => {
    return subscribeProviderUpdates();
  }, []);
  React.useEffect(() => {
    const off = window.codeBrainApp?.pty.onOutput?.((_paneId, data, _echo) => {
      const url = extractUrl(data);
      if (url) {
        const current = useBrowserStore.getState().detectedUrl;
        if (current !== url) useBrowserStore.getState().setDetected(url);
      }
    });
    return () => off?.();
  }, []);
  const reconcileLivePanes = React.useCallback(async () => {
    const livePanes = await window.codeBrainApp?.pty.list?.();
    if (!livePanes?.length) return;
    for (const livePane of livePanes) {
      if (!isTerminalAgent(livePane.agent)) continue;
      addPane({
        ...{
          id: livePane.paneId,
          externallySpawned: true
        },
        agent: livePane.agent,
        cwd: livePane.cwd,
        workspacePath: livePane.workspacePath,
        args: livePane.args,
        session: livePane.session,
        claudeSessionId: livePane.claudeSessionId,
        providerId: livePane.providerId,
        model: livePane.model
      });
    }
  }, [addPane]);
  React.useEffect(() => {
    reconcileLivePanes().catch(() => {});
    const timers = [500, 1500].map(ms => window.setTimeout(() => {
      reconcileLivePanes().catch(() => {});
    }, ms));
    return () => timers.forEach(window.clearTimeout);
  }, [reconcileLivePanes]);
  React.useEffect(() => {
    const off = window.codeBrainApp?.pty.onPaneAdded?.(info => {
      const extra = info;
      addPane({
        ...{
          id: info.paneId,
          externallySpawned: true
        },
        agent: info.agent,
        cwd: info.cwd,
        workspacePath: info.workspacePath,
        session: info.session,
        claudeSessionId: info.claudeSessionId,
        providerId: extra.providerId,
        model: extra.model
      });
    });
    return () => off?.();
  }, [addPane]);
  React.useEffect(() => {
    const off = window.codeBrainApp?.pty.onPaneSession?.(info => {
      usePanesStore.getState().updatePane(info.paneId, {
        session: info.session,
        claudeSessionId: info.claudeSessionId
      });
    });
    return () => off?.();
  }, []);
  React.useEffect(() => {
    return window.codeBrainApp?.app.onReloadShortcut(() => {
      const state = usePanesStore.getState();
      const activePane = state.panes.find(pane => pane.id === state.activePaneId);
      if (activePane?.kind === "browser") {
        window.dispatchEvent(new CustomEvent("codebrain:browser-reload", {
          detail: {
            paneId: activePane.id
          }
        }));
        return;
      }
      window.codeBrainApp?.app.reloadShell().catch(() => {});
    });
  }, []);

  // Listen for MCP-driven browser pane creation requests from main process
  React.useEffect(() => {
    const onCreatePane = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const url = detail?.url || "about:blank";
      const pane = addPane({
        kind: "browser",
        cwd: workspace,
        url
      });
      // Register the browser pane ID with main so MCP tools can find it
      if (pane?.id) {
        window.codeBrainApp?.browser?.registerPane?.(pane.id, workspace);
      }
    };
    window.addEventListener("codebrain:browser:create-pane", onCreatePane);
    return () => window.removeEventListener("codebrain:browser:create-pane", onCreatePane);
  }, [addPane, workspace]);
  const increaseFontSize = useTerminalSettings(s => s.increaseFontSize);
  const decreaseFontSize = useTerminalSettings(s => s.decreaseFontSize);
  const resetFontSize = useTerminalSettings(s => s.resetFontSize);
  const appZoom = useTerminalSettings(s => s.appZoom);
  const increaseAppZoom = useTerminalSettings(s => s.increaseAppZoom);
  const decreaseAppZoom = useTerminalSettings(s => s.decreaseAppZoom);
  const resetAppZoom = useTerminalSettings(s => s.resetAppZoom);
  const theme = useTerminalSettings(s => s.theme);
  const [whatsNewOpen, setWhatsNewOpen] = React.useState(false);
  const [appVersion, setAppVersion] = React.useState(null);
  React.useEffect(() => {
    const root2 = document.documentElement;
    if (theme === "light") root2.classList.add("light");else root2.classList.remove("light");
  }, [theme]);
  React.useEffect(() => {
    document.body.style.zoom = String(appZoom);
  }, [appZoom]);
  React.useEffect(() => {
    window.codeBrainApp?.app?.version().then(v2 => {
      setAppVersion(v2);
      const lastSeen = localStorage.getItem("codebrain.whatsNewSeen");
      if (lastSeen !== LATEST_RELEASE_VERSION) {
        setWhatsNewOpen(true);
      }
    }).catch(() => {});
  }, []);
  const closeWhatsNew = React.useCallback(() => {
    setWhatsNewOpen(false);
    localStorage.setItem("codebrain.whatsNewSeen", LATEST_RELEASE_VERSION);
  }, []);
  const activeWorkspacePath = activeTab?.workspacePath ?? workspace ?? undefined;
  const handleAddPane = React.useCallback(() => {
    addPane({
      agent: "openclaude",
      cwd: activeWorkspacePath,
      workspacePath: activeWorkspacePath,
    });
  }, [addPane, activeWorkspacePath]);
  React.useEffect(() => {
    const handler = e => {
      const meta = e.metaKey || e.ctrlKey;
      const cmd = e.metaKey;
      if (meta && !e.shiftKey && e.key === "t") {
        e.preventDefault();
        handleAddPane();
        return;
      }
      if (meta && !e.shiftKey && e.key === "w") {
        e.preventDefault();
        if (activePaneId) {
          window.codeBrainApp?.pty.kill(activePaneId);
          removePane(activePaneId);
        }
        return;
      }
      if (cmd && !e.shiftKey && !e.ctrlKey && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        useNavStore.getState().switchByIndex(idx);
        window.dispatchEvent(new CustomEvent("workspace-switched", {
          detail: {
            index: idx
          }
        }));
        return;
      }
      if (cmd && e.shiftKey && !e.ctrlKey && e.key === "]") {
        e.preventDefault();
        useNavStore.getState().cycleNext();
        window.dispatchEvent(new CustomEvent("workspace-switched", {
          detail: {
            direction: "next"
          }
        }));
        return;
      }
      if (cmd && e.shiftKey && !e.ctrlKey && e.key === "[") {
        e.preventDefault();
        useNavStore.getState().cyclePrev();
        window.dispatchEvent(new CustomEvent("workspace-switched", {
          detail: {
            direction: "prev"
          }
        }));
        return;
      }
      if (e.ctrlKey && !e.metaKey && e.key === "Tab") {
        e.preventDefault();
        if (e.shiftKey) {
          useNavStore.getState().cyclePrev();
          window.dispatchEvent(new CustomEvent("workspace-switched", {
            detail: {
              direction: "prev"
            }
          }));
        } else {
          useNavStore.getState().cycleNext();
          window.dispatchEvent(new CustomEvent("workspace-switched", {
            detail: {
              direction: "next"
            }
          }));
        }
        return;
      }
      if (e.ctrlKey && !e.shiftKey && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const pane = panes[parseInt(e.key, 10) - 1];
        if (pane) setActive(pane.id);
        return;
      }
      if (meta && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        increaseAppZoom();
        return;
      }
      if (meta && e.key === "-") {
        e.preventDefault();
        decreaseAppZoom();
        return;
      }
      if (meta && e.key === "0") {
        e.preventDefault();
        resetAppZoom();
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [panes, activePaneId, handleAddPane, removePane, setActive, increaseAppZoom, decreaseAppZoom, resetAppZoom]);
  if (!navHydrated) {
    return <React.Fragment>
        <AuthGate>
          <div className="flex flex-col h-full bg-[#0B0B0E] items-center justify-center">
            <div className="flex items-center gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-[#4F46E5] animate-pulse" />
              <span className="font-mono text-[10px] text-slate-700 uppercase tracking-widest">Carregando…</span>
            </div>
          </div>
        </AuthGate>
      </React.Fragment>;
  }
  return <React.Fragment>
      <AuthGate>
        <UpdateNotificationBanner />
        <AppShell
          whatsNewOpen={whatsNewOpen}
          closeWhatsNew={closeWhatsNew}
          appVersion={appVersion}
          workspaceToast={workspaceToast}
        />
        <CliInstallModal
          open={cliMissing}
          onClose={() => setCliMissing(false)}
          onInstalled={() => setCliMissing(false)}
        />
      </AuthGate>
    </React.Fragment>;
}
function normalizeFatal(title, error) {
  if (error instanceof Error) {
    return {
      title,
      message: error.message || title,
      stack: error.stack ?? null
    };
  }
  if (typeof error === "string") {
    return {
      title,
      message: error
    };
  }
  return {
    title,
    message: title
  };
}
export function FatalScreen({
  title,
  message,
  stack
}) {
  return <div className="h-full w-full bg-black text-gray-200 flex items-center justify-center p-6">
      <div className="w-full max-w-3xl rounded-xl border border-indigo-500/20 bg-[#070707] shadow-2xl p-6 flex flex-col gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-red-400/80">
            Renderer Error
          </p>
          <h1 className="text-xl font-semibold text-white mt-2">{title}</h1>
          <p className="font-mono text-[11px] text-gray-400 mt-3 whitespace-pre-wrap break-words">
            {message}
          </p>
        </div>
        {stack && <pre className="overflow-auto rounded-lg border border-white/10 bg-black/60 p-4 font-mono text-[10px] leading-5 text-gray-500 whitespace-pre-wrap break-words">
            {stack}
          </pre>}
        <div className="flex items-center gap-3">
          <button onClick={() => window.location.reload()} className="px-3 py-2 rounded-lg border border-indigo-500/20 hover:border-indigo-500/40 hover:bg-indigo-500/5 transition-all font-mono text-[11px] text-indigo-300">
            Reload
          </button>
        </div>
      </div>
    </div>;
}
export class AppErrorBoundary extends React.Component {
  state = {
    fatal: null
  };
  static getDerivedStateFromError(error) {
    return {
      fatal: normalizeFatal("React render failure", error)
    };
  }
  componentDidCatch(error) {
    console.error("[renderer] uncaught react error", error);
  }
  render() {
    if (this.state.fatal) return <FatalScreen {...this.state.fatal} />;
    return this.props.children;
  }
}
export default App;