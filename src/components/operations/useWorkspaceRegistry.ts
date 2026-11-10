import React from "react";

/** Registry, not operational history, is the source of discoverable projects. */
export function useWorkspaceRegistry() {
  const [recents, setRecents] = React.useState<string[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const request = React.useRef(0);

  const refresh = React.useCallback(async () => {
    const id = ++request.current;
    try {
      const items = await window.codeBrainApp?.workspaces?.recent?.();
      if (id !== request.current) return;
      setRecents(Array.isArray(items) ? items : []);
      setError(null);
    } catch {
      if (id === request.current) setError("Não foi possível carregar os workspaces recentes.");
    } finally {
      if (id === request.current) setLoaded(true);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    const off = window.codeBrainApp?.operations?.onUpdated?.((event) => {
      if (event && "workspaceListChanged" in event) void refresh();
    });
    window.addEventListener("focus", refresh);
    return () => {
      ++request.current;
      off?.();
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  return { recents, loaded, error, refresh };
}
