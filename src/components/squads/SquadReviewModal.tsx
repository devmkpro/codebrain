/**
 * SquadReviewModal — Review & configure a squad before spawning
 *
 * Features (≥ Overclock):
 *  • Topology tree: Orchestrator → Agents with visual connectors
 *  • Per-agent: agentName, category, cli, providerId, model, effort override
 *  • orchestratorInstructions textarea
 *  • Save preset toggle (persists via squads store)
 *  • Spawn button at bottom
 */
import React from "react";
import { nanoid } from "nanoid";
import { X, Users, Zap, ChevronDown, Trash2, Plus, Save, Info } from "lucide-react";
import { useProvidersStore } from "../../stores/providers-store";
import { useSquadsStore, type Squad, type SquadAgent, buildSquadCallable } from "../../stores/squads-store";
import { ProviderModelSelect } from "../providers/ProviderModelSelect";

// ── Types ──────────────────────────────────────────────────────────────────────

interface SquadReviewModalProps {
  open: boolean;
  onClose: () => void;
  /** Squad to review. If null, starts empty (create mode) */
  squad?: Squad | null;
  /** Called with final squad config + squadCallable when user hits Spawn */
  onSpawn: (squad: Squad, squadCallable: object[]) => void;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const CATEGORIES = ["builder", "planner", "researcher", "reviewer", "tester", "devops", "designer", "analyst"] as const;
const CLI_OPTIONS = ["claude", "openclaude", "gemini", "codex", "shell"] as const;
const EFFORT_OPTIONS = [
  { value: "low", label: "Low", color: "text-slate-400" },
  { value: "medium", label: "Med", color: "text-yellow-400" },
  { value: "high", label: "High", color: "text-emerald-400" },
] as const;

// ── Helpers ────────────────────────────────────────────────────────────────────

function categoryColor(cat?: string): string {
  switch (cat) {
    case "builder": return "bg-violet-500/20 text-violet-300 border-violet-500/30";
    case "planner": return "bg-blue-500/20 text-blue-300 border-blue-500/30";
    case "researcher": return "bg-amber-500/20 text-amber-300 border-amber-500/30";
    case "reviewer": return "bg-rose-500/20 text-rose-300 border-rose-500/30";
    case "tester": return "bg-cyan-500/20 text-cyan-300 border-cyan-500/30";
    case "devops": return "bg-orange-500/20 text-orange-300 border-orange-500/30";
    case "designer": return "bg-pink-500/20 text-pink-300 border-pink-500/30";
    case "analyst": return "bg-teal-500/20 text-teal-300 border-teal-500/30";
    default: return "bg-slate-500/20 text-slate-300 border-slate-500/30";
  }
}

function makeDefaultAgent(providers: any[]): SquadAgent {
  const def = providers[0];
  return {
    id: nanoid(6),
    agentName: "worker",
    category: "builder",
    cli: "claude",
    providerId: def?.id,
    model: def?.models?.[0],
  };
}

function makeDefaultSquad(providers: any[]): Squad {
  const def = providers[0];
  return {
    id: nanoid(8),
    name: "",
    mode: "auto",
    orchestrator: {
      providerId: def?.id,
      model: def?.models?.[0],
      cli: "claude",
    },
    orchestratorInstructions: "",
    agents: [makeDefaultAgent(providers)],
    createdAt: Date.now(),
  };
}

// ── AgentCard ──────────────────────────────────────────────────────────────────

function AgentCard({
  agent,
  providers,
  onChange,
  onRemove,
  isOnly,
}: {
  agent: SquadAgent;
  providers: any[];
  onChange: (patch: Partial<SquadAgent>) => void;
  onRemove: () => void;
  isOnly: boolean;
}) {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div className="border border-white/[0.07] rounded-lg bg-[#0a0a12] overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2">
        {/* Category badge (clickable cycle) */}
        <button
          onClick={() => {
            const idx = CATEGORIES.indexOf(agent.category as any);
            onChange({ category: CATEGORIES[(idx + 1) % CATEGORIES.length] });
          }}
          title="Click to change category"
          className={`shrink-0 px-2 py-0.5 rounded border text-[9px] font-mono font-bold uppercase tracking-widest transition-all hover:opacity-80 ${categoryColor(agent.category)}`}
        >
          {agent.category ?? "builder"}
        </button>

        {/* Name */}
        <input
          value={agent.agentName}
          onChange={(e) => onChange({ agentName: e.target.value })}
          placeholder="agent name"
          className="flex-1 bg-transparent border-b border-white/10 text-[11px] font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-violet-500/40 pb-0.5"
        />

        {/* Effort quick-pick */}
        <div className="flex gap-0.5">
          {EFFORT_OPTIONS.map((e) => (
            <button
              key={e.value}
              onClick={() => onChange({ effort: agent.effort === e.value ? undefined : (e.value as any) })}
              title={`Effort: ${e.label}`}
              className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-widest border transition-all ${
                agent.effort === e.value
                  ? `${e.color} border-current bg-white/5`
                  : "text-slate-600 border-transparent hover:text-slate-400"
              }`}
            >
              {e.label}
            </button>
          ))}
        </div>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded((x) => !x)}
          className={`p-1 text-slate-600 hover:text-slate-300 transition-all ${expanded ? "rotate-180" : ""}`}
        >
          <ChevronDown size={12} strokeWidth={1.5} />
        </button>

        {/* Remove */}
        {!isOnly && (
          <button onClick={onRemove} className="p-1 text-slate-700 hover:text-red-400 transition-colors">
            <Trash2 size={11} strokeWidth={1.5} />
          </button>
        )}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-white/[0.05] px-3 py-2.5 space-y-2.5 bg-white/[0.01]">
          {/* Provider + Model */}
          <ProviderModelSelect
            providers={providers}
            label="Provider & Model"
            value={{ providerId: agent.providerId, model: agent.model }}
            onChange={({ providerId, model }: any) => onChange({ providerId, model })}
          />

          {/* CLI */}
          <div>
            <p className="font-mono text-[9px] text-slate-600 uppercase tracking-widest mb-1">CLI Runner</p>
            <div className="flex flex-wrap gap-1">
              {CLI_OPTIONS.map((c) => (
                <button
                  key={c}
                  onClick={() => onChange({ cli: c })}
                  className={`px-2 py-1 rounded border font-mono text-[9px] font-bold uppercase tracking-widest transition-all ${
                    agent.cli === c
                      ? "border-violet-500/50 bg-violet-500/10 text-violet-300"
                      : "border-white/[0.06] text-slate-600 hover:text-slate-400 hover:border-white/15"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Flags */}
          <div className="flex gap-3">
            {[
              { key: "delegateOnly", label: "Delegate Only" },
              { key: "leaf", label: "Leaf" },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!(agent as any)[key]}
                  onChange={(e) => onChange({ [key]: e.target.checked } as any)}
                  className="accent-violet-500 w-3 h-3"
                />
                <span className="font-mono text-[10px] text-slate-500">{label}</span>
              </label>
            ))}
          </div>

          {/* Invocable alias */}
          <div>
            <p className="font-mono text-[9px] text-slate-600 uppercase tracking-widest mb-1">Invocable alias (optional)</p>
            <input
              value={agent.invocable ?? ""}
              onChange={(e) => onChange({ invocable: e.target.value || undefined })}
              placeholder="e.g. backend, frontend"
              className="w-full bg-[#0a0a12] border border-white/[0.07] rounded px-2 py-1 font-mono text-[10px] text-slate-200 placeholder-slate-700 focus:outline-none focus:border-violet-500/30"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function SquadReviewModal({ open, onClose, squad: squadProp, onSpawn }: SquadReviewModalProps) {
  const providers = useProvidersStore((s) => s.providers);
  const { save: saveSquad } = useSquadsStore();

  const [squad, setSquad] = React.useState<Squad>(() =>
    squadProp ? { ...squadProp } : makeDefaultSquad(providers)
  );
  const [savePreset, setSavePreset] = React.useState(false);
  const [spawning, setSpawning] = React.useState(false);

  // Reset when re-opened or prop changes
  React.useEffect(() => {
    if (!open) return;
    setSquad(squadProp ? { ...squadProp } : makeDefaultSquad(providers));
    setSavePreset(false);
  }, [open, squadProp]); // eslint-disable-line

  if (!open) return null;

  // ── Helpers ────────────────────────────────────────────────────────────────

  const patchSquad = (patch: Partial<Squad>) => setSquad((s) => ({ ...s, ...patch }));

  const patchAgent = (id: string, patch: Partial<SquadAgent>) =>
    setSquad((s) => ({ ...s, agents: s.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));

  const addAgent = () =>
    setSquad((s) => ({ ...s, agents: [...s.agents, makeDefaultAgent(providers)] }));

  const removeAgent = (id: string) =>
    setSquad((s) => ({ ...s, agents: s.agents.filter((a) => a.id !== id) }));

  const canSpawn = squad.agents.length > 0 && (squad.orchestrator.providerId || squad.orchestrator.model);

  const handleSpawn = async () => {
    if (!canSpawn || spawning) return;
    setSpawning(true);
    const finalSquad: Squad = {
      ...squad,
      name: squad.name.trim() || `Squad ${Date.now()}`,
      updatedAt: Date.now(),
    };
    if (savePreset) {
      await saveSquad(finalSquad).catch(() => {});
    }
    const callable = buildSquadCallable(finalSquad.agents);
    onSpawn(finalSquad, callable);
    setSpawning(false);
    onClose();
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed top-[38px] left-0 right-0 bottom-0 z-[10002] flex items-center justify-center bg-black/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#0b0b15] border border-white/[0.09] rounded-xl shadow-2xl w-[580px] max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md bg-violet-500/20 flex items-center justify-center">
              <Users size={13} className="text-violet-400" strokeWidth={1.5} />
            </div>
            <h2 className="font-mono text-[12px] font-bold text-white tracking-wider">SQUAD REVIEW</h2>
          </div>
          <button onClick={onClose} className="text-slate-600 hover:text-red-400 transition-colors p-1">
            <X size={13} strokeWidth={1.5} />
          </button>
        </div>

        {/* ── Body (scrollable) ── */}
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
          <div className="p-5 space-y-5">

            {/* Squad name */}
            <div>
              <p className="font-mono text-[9px] text-slate-600 uppercase tracking-widest mb-1.5">Squad name</p>
              <input
                value={squad.name}
                onChange={(e) => patchSquad({ name: e.target.value })}
                placeholder="e.g. Full-stack Feature Team"
                className="w-full bg-[#0a0a12] border border-white/[0.07] rounded-lg px-3 py-2 font-mono text-[12px] text-slate-200 placeholder-slate-700 focus:outline-none focus:border-violet-500/40 transition-colors"
              />
            </div>

            {/* ── Topology tree ── */}
            <div>
              <p className="font-mono text-[9px] text-slate-600 uppercase tracking-widest mb-3">Topology</p>

              {/* Orchestrator node */}
              <div className="relative">
                <div className="border border-violet-500/25 rounded-lg bg-violet-500/[0.04] p-3 space-y-2.5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-[9px] text-violet-400 uppercase tracking-widest font-bold">Orchestrator</span>
                    <span className="font-mono text-[8px] text-slate-600 border border-slate-700/50 rounded px-1 py-px">plans · delegates</span>
                  </div>
                  <ProviderModelSelect
                    providers={providers}
                    label=""
                    value={{ providerId: squad.orchestrator.providerId, model: squad.orchestrator.model }}
                    onChange={({ providerId, model }: any) => patchSquad({ orchestrator: { ...squad.orchestrator, providerId, model } })}
                  />

                  {/* Orchestrator CLI */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[9px] text-slate-600">CLI:</span>
                    {CLI_OPTIONS.map((c) => (
                      <button
                        key={c}
                        onClick={() => patchSquad({ orchestrator: { ...squad.orchestrator, cli: c } })}
                        className={`px-2 py-0.5 rounded border font-mono text-[8px] font-bold uppercase tracking-widest transition-all ${
                          squad.orchestrator.cli === c
                            ? "border-violet-500/50 bg-violet-500/10 text-violet-300"
                            : "border-white/[0.06] text-slate-700 hover:text-slate-400 hover:border-white/15"
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Connector lines to agents */}
                {squad.agents.length > 0 && (
                  <div className="flex justify-center">
                    <div className="w-px h-4 bg-violet-500/20" />
                  </div>
                )}
              </div>

              {/* Agents */}
              {squad.agents.length > 0 && (
                <div className="relative pl-5 space-y-2 before:absolute before:left-2 before:top-0 before:bottom-4 before:w-px before:bg-white/[0.06]">
                  {squad.agents.map((agent, idx) => (
                    <div key={agent.id} className="relative">
                      {/* Branch connector */}
                      <div className="absolute -left-3 top-4 w-3 h-px bg-white/[0.06]" />
                      <AgentCard
                        agent={agent}
                        providers={providers}
                        onChange={(patch) => patchAgent(agent.id, patch)}
                        onRemove={() => removeAgent(agent.id)}
                        isOnly={squad.agents.length === 1}
                      />
                    </div>
                  ))}
                  {/* Add agent button */}
                  <button
                    onClick={addAgent}
                    className="relative flex items-center gap-1.5 font-mono text-[10px] text-slate-600 hover:text-violet-400 transition-colors ml-2 pt-1"
                  >
                    <div className="absolute -left-5 top-[0.9rem] w-3 h-px bg-white/[0.06]" />
                    <Plus size={11} strokeWidth={1.5} />
                    Add agent
                  </button>
                </div>
              )}

              {squad.agents.length === 0 && (
                <button
                  onClick={addAgent}
                  className="w-full border border-dashed border-white/10 rounded-lg py-3 font-mono text-[10px] text-slate-600 hover:text-violet-400 hover:border-violet-500/20 transition-all mt-2"
                >
                  <Plus size={12} strokeWidth={1.5} className="inline mr-1.5" />
                  Add first agent
                </button>
              )}
            </div>

            {/* ── Orchestrator instructions ── */}
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <p className="font-mono text-[9px] text-slate-600 uppercase tracking-widest">Orchestrator instructions</p>
                <Info size={10} strokeWidth={1.5} className="text-slate-700" title="Injected into the orchestrator's system prompt" />
              </div>
              <textarea
                value={squad.orchestratorInstructions ?? ""}
                onChange={(e) => patchSquad({ orchestratorInstructions: e.target.value })}
                rows={4}
                placeholder="Optional high-level instructions for the orchestrator…&#10;e.g. Focus on performance, always write tests, prefer TypeScript."
                className="w-full bg-[#0a0a12] border border-white/[0.07] rounded-lg px-3 py-2 font-mono text-[11px] text-slate-300 placeholder-slate-700 focus:outline-none focus:border-violet-500/30 resize-none transition-colors leading-relaxed"
              />
            </div>

            {/* ── Mode ── */}
            <div>
              <p className="font-mono text-[9px] text-slate-600 uppercase tracking-widest mb-1.5">Execution mode</p>
              <div className="flex gap-1.5">
                {(["auto", "sequential", "parallel"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => patchSquad({ mode: m })}
                    className={`flex-1 py-1.5 rounded border font-mono text-[10px] font-bold uppercase tracking-widest transition-all ${
                      squad.mode === m
                        ? "border-violet-500/50 bg-violet-500/10 text-violet-300"
                        : "border-white/[0.06] text-slate-600 hover:text-slate-400 hover:border-white/15"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

          </div>
        </div>

        {/* ── Footer ── */}
        <div className="border-t border-white/[0.06] px-5 py-3.5 flex items-center gap-3 shrink-0 bg-[#09090f]">
          {/* Save preset toggle */}
          <label className="flex items-center gap-2 cursor-pointer flex-1">
            <div
              onClick={() => setSavePreset((x) => !x)}
              className={`w-8 h-4 rounded-full border transition-all relative ${
                savePreset ? "bg-violet-500/30 border-violet-500/50" : "bg-white/[0.04] border-white/[0.08]"
              }`}
            >
              <div
                className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${
                  savePreset ? "left-4 bg-violet-400" : "left-0.5 bg-slate-600"
                }`}
              />
            </div>
            <span className="font-mono text-[10px] text-slate-500">
              {savePreset ? "Save as preset" : "Save as preset"}
            </span>
            {savePreset && <Save size={10} strokeWidth={1.5} className="text-violet-400" />}
          </label>

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-white/[0.08] font-mono text-[11px] text-slate-500 hover:text-slate-300 hover:border-white/20 transition-all"
          >
            Cancel
          </button>

          <button
            onClick={handleSpawn}
            disabled={!canSpawn || spawning}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed font-mono text-[11px] font-bold text-white uppercase tracking-wider transition-all"
          >
            {spawning ? (
              <>
                <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
                Spawning…
              </>
            ) : (
              <>
                <Zap size={13} strokeWidth={1.5} />
                Spawn Squad
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
