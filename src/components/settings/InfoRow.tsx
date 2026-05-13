import React from "react";

// InfoRow
export function InfoRow({
  label,
  value
}) {
  return <div className="min-w-0 rounded border border-white/5 bg-white/[0.02] px-2 py-1.5">
      <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-gray-600">
        {label}
      </p>
      <p className="mt-0.5 truncate font-mono text-[11px] text-gray-300" title={String(value ?? "-")}>
        {value ?? "-"}
      </p>
    </div>;
}
export function shortId(id) {
  return id.length > 10 ? `${id.slice(0, 8)}...` : id;
}
function safeUrl(raw) {
  if (!raw) return "-";
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[invalid url omitted]";
  }
}
function paneIdOf(pane) {
  return "paneId" in pane ? pane.paneId : pane.id;
}
function paneStatusOf(pane) {
  return "status" in pane ? pane.status : "running";
}
function formatPaneLine(pane) {
  const pid = "pid" in pane && pane.pid ? ` pid=${pane.pid}` : "";
  return `- ${paneIdOf(pane)} | agent=${pane.agent} | status=${paneStatusOf(pane)}${pid} | cwd=${pane.cwd} | model=${pane.model ?? "-"}`;
}
function formatPathHealth(label, health) {
  return `- ${label}: ${health.path} | exists=${health.exists ? "yes" : "no"} | readable=${health.readable ? "yes" : "no"} | writable=${health.writable ? "yes" : "no"} | files=${health.fileCount} | dirs=${health.dirCount}`;
}
export function buildBugReport(args) {
  const {
    snapshot,
    rendererPanes,
    backendOnly,
    rendererOnly,
    activeWorkspace
  } = args;
  const workspace = activeWorkspace ?? snapshot.workspace.active ?? "home";
  const hasDivergence = backendOnly.length > 0 || rendererOnly.length > 0;
  const lines = ["CodeBrain Bug Report", `Data/hora local: ${new Date().toLocaleString()}`, `Versao do app: ${snapshot.app.version}`, `Plataforma/SO: ${snapshot.app.platform}/${snapshot.app.arch} (${snapshot.app.osRelease})`, `Workspace ativo: ${workspace}`, `Data dir source: ${snapshot.dataDir.source}`, "", "Descricao:", "", "Passos para reproduzir:", "1. ", "2. ", "3. ", "", "Resultado esperado:", "", "Resultado obtido:", "", "Frequencia:", "", "Prints/video anexados:", "", "Diagnostico automatico", "", "Data dirs:", formatPathHealth("active", snapshot.dataDir.active), formatPathHealth("legacy", snapshot.dataDir.legacy), `- migration attempted: ${snapshot.dataDir.migration.attempted ? "yes" : "no"}`, `- migration copied: ${snapshot.dataDir.migration.copied.join(", ") || "-"}`, `- migration skipped count: ${snapshot.dataDir.migration.skipped.length}`, "Data files:", ...Object.entries(snapshot.dataDir.files).map(([label, health]) => formatPathHealth(label, health)), "", "MCP:", `- status: ${snapshot.mcp.active ? "ativo" : "inativo"}`, `- porta: ${snapshot.mcp.port ?? "-"}`, `- SSE URL: ${safeUrl(snapshot.mcp.sseUrl)}`, `- Streamable HTTP URL: ${safeUrl(snapshot.mcp.streamableHttpUrl)}`, `- tools (${snapshot.mcp.toolCount}): ${snapshot.mcp.tools.join(", ") || "-"}`, "", `Providers (${snapshot.providers.length}):`];
  if (snapshot.providers.length === 0) {
    lines.push("- nenhum provider");
  } else {
    for (const provider of snapshot.providers) {
      lines.push(`- ${provider.label} | type=${provider.type} | host=${provider.host ?? "-"} | base=${safeUrl(provider.baseUrl)} | models=${provider.models.join(", ") || "-"} | env vars=${provider.envKeys.join(", ") || "-"}`);
    }
  }
  lines.push("", `Panes backend via pty:list (${snapshot.backendPanes.length}):`, ...(snapshot.backendPanes.length ? snapshot.backendPanes.map(formatPaneLine) : ["- nenhum pane"]), "", `Panes renderer store (${rendererPanes.length}):`, ...(rendererPanes.length ? rendererPanes.map(formatPaneLine) : ["- nenhum pane"]), "", `Divergencias: ${hasDivergence ? "sim" : "nao"}`, `- backend tem pane que UI nao mostra (${backendOnly.length}):`, ...(backendOnly.length ? backendOnly.map(formatPaneLine) : ["  - nenhum"]), `- UI mostra pane morto (${rendererOnly.length}):`, ...(rendererOnly.length ? rendererOnly.map(formatPaneLine) : ["  - nenhum"]), "", `CLIs (${Array.isArray(snapshot.clis) ? snapshot.clis.filter(cli => cli.found).length : 0}/${Array.isArray(snapshot.clis) ? snapshot.clis.length : 0} found):`, ...(Array.isArray(snapshot.clis) ? snapshot.clis : []).map(cli => `- ${cli.name}: ${cli.found ? "found" : "not found"}${cli.path ? ` | path=${cli.path}` : ""}`), "", "Ultimo erro seguro:", snapshot.lastError ?? "-", "", "Seguranca:", "Tokens, API keys, .env, providers.json cru, query strings e auth callbacks nao foram incluidos.");
  return lines.join("\n");
}