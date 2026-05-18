import React from "react";
import { RefreshCw, RotateCcw, DollarSign, Cpu, Zap } from "lucide-react";
import { useCostStore } from "../../stores/cost-store";

const PERIODS = [
  { key: "today", label: "Hoje" },
  { key: "week", label: "Semana" },
  { key: "month", label: "Mes" },
  { key: "all", label: "Tudo" },
] as const;

function formatUsd(n: number): string {
  if (n < 0.01 && n > 0) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function modelDisplayName(model: string): string {
  // gemini-2.5-pro -> Gemini 2.5 Pro
  // claude-sonnet-4 -> Claude Sonnet 4
  return model
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function CostPanel() {
  const summary = useCostStore((s) => s.summary);
  const taskSummary = useCostStore((s) => s.taskSummary);
  const alerts = useCostStore((s) => s.alerts);
  const period = useCostStore((s) => s.period);
  const loading = useCostStore((s) => s.loading);
  const resetBusy = useCostStore((s) => s.resetBusy);
  const msg = useCostStore((s) => s.msg);
  const setPeriod = useCostStore((s) => s.setPeriod);
  const loadSummary = useCostStore((s) => s.loadSummary);
  const loadTaskSummary = useCostStore((s) => s.loadTaskSummary);
  const loadAlerts = useCostStore((s) => s.loadAlerts);
  const loadModels = useCostStore((s) => s.loadModels);
  const resetUsage = useCostStore((s) => s.resetUsage);

  React.useEffect(() => {
    loadSummary();
    loadAlerts();
    loadModels();
    loadTaskSummary();
  }, []);

  const models = summary?.byModel
    ? Object.entries(summary.byModel).sort((a, b) => b[1].cost - a[1].cost)
    : [];

  const agents = summary?.byAgent
    ? Object.entries(summary.byAgent).sort((a, b) => b[1].cost - a[1].cost)
    : [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest">
          Uso de Tokens
        </p>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { loadSummary(); loadAlerts(); loadTaskSummary(); }}
            className="p-1.5 rounded border border-white/10 text-gray-500 hover:text-gray-300 hover:border-white/20 transition-all"
            title="Atualizar"
          >
            <RefreshCw size={11} strokeWidth={1.5} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Period selector */}
      <div className="grid grid-cols-4 gap-1">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`px-2 py-1 rounded border font-mono text-[10px] uppercase tracking-wider transition-all ${
              period === p.key
                ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-300"
                : "border-white/10 text-gray-500 hover:text-gray-300 hover:border-white/20"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Totals */}
      {summary && (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded border border-white/10 bg-white/[0.02] p-2.5">
            <div className="flex items-center gap-1.5 mb-1">
              <DollarSign size={11} strokeWidth={1.5} className="text-green-400" />
              <p className="font-mono text-[8px] text-gray-600 uppercase tracking-widest">Custo</p>
            </div>
            <p className="font-mono text-[14px] font-bold text-white">
              {formatUsd(summary.totalCost)}
            </p>
          </div>
          <div className="rounded border border-white/10 bg-white/[0.02] p-2.5">
            <div className="flex items-center gap-1.5 mb-1">
              <Cpu size={11} strokeWidth={1.5} className="text-cyan-400" />
              <p className="font-mono text-[8px] text-gray-600 uppercase tracking-widest">Input</p>
            </div>
            <p className="font-mono text-[14px] font-bold text-white">
              {formatTokens(summary.totalInputTokens)}
            </p>
          </div>
          <div className="rounded border border-white/10 bg-white/[0.02] p-2.5">
            <div className="flex items-center gap-1.5 mb-1">
              <Zap size={11} strokeWidth={1.5} className="text-yellow-400" />
              <p className="font-mono text-[8px] text-gray-600 uppercase tracking-widest">Output</p>
            </div>
            <p className="font-mono text-[14px] font-bold text-white">
              {formatTokens(summary.totalOutputTokens)}
            </p>
          </div>
        </div>
      )}

      {/* Per-model table */}
      {models.length > 0 && (
        <div>
          <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-2">
            Por modelo
          </p>
          <div className="rounded border border-white/10 overflow-hidden">
            <table className="w-full font-mono text-[10px]">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.03]">
                  <th className="text-left px-2.5 py-1.5 text-gray-500 font-normal">Modelo</th>
                  <th className="text-right px-2.5 py-1.5 text-gray-500 font-normal">Input</th>
                  <th className="text-right px-2.5 py-1.5 text-gray-500 font-normal">Output</th>
                  <th className="text-right px-2.5 py-1.5 text-gray-500 font-normal">Custo</th>
                </tr>
              </thead>
              <tbody>
                {models.map(([model, data]) => (
                  <tr key={model} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="px-2.5 py-1.5 text-gray-300">{modelDisplayName(model)}</td>
                    <td className="text-right px-2.5 py-1.5 text-cyan-300">{formatTokens(data.inputTokens)}</td>
                    <td className="text-right px-2.5 py-1.5 text-yellow-300">{formatTokens(data.outputTokens)}</td>
                    <td className="text-right px-2.5 py-1.5 text-green-300">{formatUsd(data.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per-agent table */}
      {agents.length > 0 && (
        <div>
          <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-2">
            Por agente
          </p>
          <div className="rounded border border-white/10 overflow-hidden">
            <table className="w-full font-mono text-[10px]">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.03]">
                  <th className="text-left px-2.5 py-1.5 text-gray-500 font-normal">Agente</th>
                  <th className="text-right px-2.5 py-1.5 text-gray-500 font-normal">Sessoes</th>
                  <th className="text-right px-2.5 py-1.5 text-gray-500 font-normal">Custo</th>
                </tr>
              </thead>
              <tbody>
                {agents.map(([agent, data]) => (
                  <tr key={agent} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="px-2.5 py-1.5 text-gray-300">{agent}</td>
                    <td className="text-right px-2.5 py-1.5 text-gray-400">{data.sessions}</td>
                    <td className="text-right px-2.5 py-1.5 text-green-300">{formatUsd(data.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per-task table */}
      {taskSummary && taskSummary.tasks.length > 0 && (
        <div>
          <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-2">
            Por tarefa ({taskSummary.totalTasks})
          </p>
          <div className="rounded border border-white/10 overflow-hidden">
            <table className="w-full font-mono text-[10px]">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.03]">
                  <th className="text-left px-2.5 py-1.5 text-gray-500 font-normal">Tarefa</th>
                  <th className="text-left px-2.5 py-1.5 text-gray-500 font-normal">Modelo</th>
                  <th className="text-right px-2.5 py-1.5 text-gray-500 font-normal">Tokens</th>
                  <th className="text-right px-2.5 py-1.5 text-gray-500 font-normal">Custo</th>
                </tr>
              </thead>
              <tbody>
                {taskSummary.tasks.map((task, i) => (
                  <tr key={task.taskId || i} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="px-2.5 py-1.5 text-gray-300 max-w-[120px] truncate" title={task.taskId || task.model}>
                      {task.taskId ? (
                        <span className="text-indigo-300">{task.taskId.replace(/^task_/, "").slice(0, 16)}</span>
                      ) : (
                        <span className="text-gray-600 italic">sessao</span>
                      )}
                      {task.agentId && (
                        <span className="ml-1 text-[8px] text-gray-600">({task.agentId})</span>
                      )}
                    </td>
                    <td className="px-2.5 py-1.5 text-gray-400 text-[9px]">{modelDisplayName(task.model)}</td>
                    <td className="text-right px-2.5 py-1.5 text-cyan-300">
                      {formatTokens(task.inputTokens + task.outputTokens)}
                    </td>
                    <td className="text-right px-2.5 py-1.5 text-green-300">{formatUsd(task.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent alerts */}
      {alerts.length > 0 && (
        <div>
          <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-2">
            Alertas recentes
          </p>
          <div className="space-y-1 max-h-32 overflow-y-auto hacker-scroll">
            {alerts.slice(-5).reverse().map((alert, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 px-2 py-1 rounded border text-[9px] font-mono ${
                  alert.type.includes("exceeded")
                    ? "border-red-500/20 bg-red-500/5 text-red-300"
                    : alert.type.includes("critical")
                      ? "border-orange-500/20 bg-orange-500/5 text-orange-300"
                      : "border-yellow-500/20 bg-yellow-500/5 text-yellow-300"
                }`}
              >
                <span className="opacity-60 shrink-0">
                  {new Date(alert.timestamp).toLocaleTimeString()}
                </span>
                <span>{alert.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !summary && (
        <div className="text-center py-6">
          <p className="font-mono text-[10px] text-gray-600">
            Nenhum dado de uso ainda.
          </p>
          <p className="font-mono text-[9px] text-gray-700 mt-1">
            O uso aparece apos agentes consumirem tokens.
          </p>
        </div>
      )}

      {/* Reset button */}
      <div className="flex items-center gap-2 pt-2 border-t border-white/5">
        <button
          onClick={() => resetUsage()}
          disabled={resetBusy}
          className="flex items-center gap-2 px-3 py-1.5 rounded border border-red-500/20 text-red-300 hover:text-red-200 hover:border-red-500/40 hover:bg-red-500/5 disabled:opacity-50 transition-all font-mono text-[10px]"
        >
          {resetBusy ? (
            <RefreshCw size={11} strokeWidth={1.5} className="animate-spin" />
          ) : (
            <RotateCcw size={11} strokeWidth={1.5} />
          )}
          {resetBusy ? "Zerando…" : "Zerar uso de tokens"}
        </button>
        {msg && <p className="font-mono text-[9px] text-gray-500">{msg}</p>}
      </div>
    </div>
  );
}
