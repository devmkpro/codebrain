import React from "react";
import type { McpStatus } from "../../types/electron";

const REFRESH_INTERVAL_MS = 15_000;

export function compactMcpRoute(route: string | null): string {
  if (!route) return "rota indisponível";
  if (!/^https?:\/\//i.test(route)) return route;
  try {
    const url = new URL(route);
    return `${url.host}${url.pathname}`;
  } catch {
    return route.replace(/^https?:\/\//, "");
  }
}

export function McpRouteStatus() {
  const [status, setStatus] = React.useState<McpStatus | null>(null);
  const [copied, setCopied] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      const next = await window.codeBrainApp?.mcp?.status?.();
      if (next) setStatus(next);
    } catch {
      setStatus({ active: false, port: null, route: null, toolCount: 0 });
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    const interval = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  const active = status?.active === true;
  const route = status?.route ?? null;
  const routeLabel = compactMcpRoute(route);

  const copyRoute = React.useCallback(async () => {
    if (!route) return;
    try {
      await window.codeBrainApp?.app?.copyToClipboard?.(route);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  }, [route]);

  return (
    <div className="flex items-center gap-2" aria-label="Status do MCP">
      <span className={active ? "text-cb-success" : status ? "text-cb-danger" : "text-cb-fg-3"}>
        <span
          className="cb-dot mr-1.5 inline-block"
          style={{
            "--cb-dot-color": active
              ? "var(--cb-success)"
              : status
                ? "var(--cb-danger)"
                : "var(--cb-fg-3)",
          } as React.CSSProperties}
          aria-hidden
        />
        MCP {status ? (active ? "online" : "offline") : "verificando"}
      </span>

      <button
        type="button"
        onClick={copyRoute}
        disabled={!route}
        title={route
          ? `${route} · ${status?.toolCount ?? 0} tools · clique para copiar`
          : "A rota MCP ainda não está disponível"}
        className="max-w-56 truncate rounded-cb-1 px-1 text-cb-fg-2 hover:bg-cb-bg-2 hover:text-cb-fg-0 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-cb-fg-2"
      >
        {copied ? "rota copiada" : `rota ${routeLabel}`}
      </button>
    </div>
  );
}
