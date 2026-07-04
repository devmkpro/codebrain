import React from "react";
import { nanoid } from "nanoid";
import { Zap } from "lucide-react";
import { Users, X$1, Trash2, Plus } from "../../stores/providers-store";

// SquadModal
import { useProvidersStore } from "../../stores/providers-store";
import { useSquadsStore, type SquadWorker } from "../../stores/squads-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { useNavStore } from "../../stores/nav-store";
import { ProviderModelSelect } from "../providers/ProviderModelSelect";
import { ProvidersModal } from "../providers/ProvidersModal";
import { FONT_OPTIONS, useTerminalSettings } from "../../stores/terminal-settings-store";

function folderLabel(p: string) {
  return p?.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p;
}

export function SquadModal({
  open,
  onClose,
  onSpawn
}) {
  const providers = useProvidersStore(s => s.providers);
  const loadProviders = useProvidersStore(s => s.load);
  const squads = useSquadsStore(s => s.squads);
  const loadSquads = useSquadsStore(s => s.load);
  const saveSquad = useSquadsStore(s => s.save);
  const removeSquad = useSquadsStore(s => s.remove);
  const tabs = useNavStore(s => s.tabs) as any[];
  const activeTabIndex = useNavStore(s => s.activeTabIndex);
  const defaultWorkspace = tabs[activeTabIndex]?.workspacePath ?? tabs[0]?.workspacePath ?? null;
  const [selectedWorkspace, setSelectedWorkspace] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [orchestrator, setOrchestrator] = React.useState({});
  const [workers, setWorkers] = React.useState<SquadWorker[]>([]);
  const [creating, setCreating] = React.useState(false);
  const [showProvidersModal, setShowProvidersModal] = React.useState(false);
  const initialized = React.useRef(false);
  React.useEffect(() => {
    if (open) {
      initialized.current = false;
      loadProviders();
      loadSquads();
      // Reset workspace selection to active workspace when modal opens
      setSelectedWorkspace(defaultWorkspace);
    }
  }, [open, loadProviders, loadSquads, defaultWorkspace]);
  React.useEffect(() => {
    if (providers.length > 0 && !initialized.current) {
      initialized.current = true;
      const def = providers[0];
      setOrchestrator({
        providerId: def.id,
        model: def.models?.[0]
      });
      setWorkers([{
        id: nanoid(6),
        role: "Backend",
        providerId: def.id,
        model: def.models?.[0]
      }]);
    }
  }, [providers]);
  if (!open) return null;

  const addWorker = () => {
    const def = providers[0];
    setWorkers(prev => [...prev, {
      id: nanoid(6),
      role: `Worker ${prev.length + 1}`,
      providerId: def?.id,
      model: def?.models?.[0]
    }]);
  };

  const removeWorker = (id: string) => {
    setWorkers(prev => prev.filter(w => w.id !== id));
  };

  const updateWorker = (id: string, patch: Partial<SquadWorker>) => {
    setWorkers(prev => prev.map(w => w.id === id ? { ...w, ...patch } : w));
  };

  const effectiveWorkspace = selectedWorkspace ?? defaultWorkspace;

  const resolveValidModel = (providerId: string, requestedModel?: string): string | undefined => {
    const provider = providers.find(p => p.id === providerId);
    if (!provider) return undefined;
    const models = provider.models ?? [];
    if (models.length === 0) return undefined;
    if (requestedModel && models.includes(requestedModel)) return requestedModel;
    return models[0];
  };

  const validateSquadModels = (): string[] => {
    const warnings: string[] = [];
    const orchValid = resolveValidModel(orchestrator.providerId, orchestrator.model);
    if (orchestrator.model && orchestrator.model !== orchValid) {
      warnings.push(`Orquestrador: modelo "${orchestrator.model}" não existe, usando "${orchValid}"`);
    }
    for (const w of workers) {
      const valid = resolveValidModel(w.providerId, w.model);
      if (w.model && w.model !== valid) {
        warnings.push(`Worker ${w.role}: modelo "${w.model}" não existe, usando "${valid}"`);
      }
    }
    return warnings;
  };

  const handleSaveAndSpawn = async () => {
    if (!effectiveWorkspace) return;
    const squad = {
      id: nanoid(8),
      name: name.trim() || `Squad ${squads.length + 1}`,
      orchestrator,
      workers,
      workspacePath: effectiveWorkspace,
      createdAt: Date.now()
    };
    await saveSquad(squad);
    onSpawn(squad);
    onClose();
  };
  const handleSpawnSaved = (squad: any) => {
    // Allow override workspace for saved squads too
    onSpawn({ ...squad, workspacePath: effectiveWorkspace ?? squad.workspacePath });
    onClose();
  };

  const workerCountLabel = (s) => {
    const count = s.workers?.length ?? (s.worker ? 1 : 0);
    return count === 1 ? "1 worker" : `${count} workers`;
  };

  return <div className="fixed top-[38px] left-0 right-0 bottom-0 z-[10001] flex items-center justify-center bg-black/70 backdrop-blur-sm cursor-pointer" onClick={onClose}>
      <div className="bg-[#0c0c14] border border-white/10 rounded-xl shadow-2xl w-[520px] max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <Users size={14} strokeWidth={1.5} className="text-[#5855e5]" />
            <h2 className="font-mono text-[12px] font-bold text-white tracking-wider">NEW SQUAD</h2>
          </div>
          <button onClick={onClose} className="text-slate-600 hover:text-red-400 transition-colors cursor-pointer">
            <X$1 size={14} strokeWidth={1.5} />
          </button>
        </div>

        {/* Workspace selector — always shown at top */}
        <div className="px-4 py-3 border-b border-white/[0.06] bg-[#5855e5]/[0.03]">
          <p className="font-mono text-[9px] text-slate-600 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#5855e5]" />
            Workspace para o squad
          </p>
          {tabs.length === 0 ? (
            <div className="flex items-center gap-2 p-2.5 rounded-lg border border-red-500/20 bg-red-500/5">
              <span className="font-mono text-[10px] text-red-400">Nenhum workspace aberto.</span>
              <span className="font-mono text-[9px] text-slate-600">Abra um workspace antes de criar um squad.</span>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {tabs.map((tab: any) => {
                const label = folderLabel(tab.workspacePath);
                const isSelected = (selectedWorkspace ?? defaultWorkspace) === tab.workspacePath;
                return (
                  <button
                    key={tab.workspacePath}
                    onClick={() => setSelectedWorkspace(tab.workspacePath)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all ${
                      isSelected
                        ? 'border-[#5855e5]/40 bg-[#5855e5]/10 text-indigo-200'
                        : 'border-white/5 bg-white/[0.02] text-slate-400 hover:border-white/10 hover:text-slate-300'
                    }`}
                  >
                    <div className={`w-2 h-2 rounded-full shrink-0 ${isSelected ? 'bg-[#5855e5]' : 'bg-slate-700'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[11px] font-bold truncate">{label}</p>
                      <p className="font-mono text-[9px] text-slate-600 truncate">{tab.workspacePath}</p>
                    </div>
                    {isSelected && <span className="font-mono text-[8px] uppercase tracking-widest text-[#5855e5] shrink-0">selecionado</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
          {squads.length > 0 && !creating && <div className="p-4 space-y-2 border-b border-white/5">
              <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest">
                Saved squads
              </p>
              {squads.map(s => <div className="group flex items-center gap-3 px-3 py-2 rounded-lg border border-white/5 hover:border-white/10 bg-white/[0.02]">
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-[11px] text-gray-200 truncate">{s.name}</p>
                    <p className="font-mono text-[9px] text-gray-600 truncate">
                      {s.orchestrator.model ?? "default"} + {workerCountLabel(s)}
                    </p>
                  </div>
                  <button onClick={() => handleSpawnSaved(s)} className="font-mono text-[9px] text-red-400 hover:text-indigo-300 px-2 py-1 rounded opacity-0 group-hover:opacity-100">
                    SPAWN
                  </button>
                  <button onClick={() => removeSquad(s.id)} className="text-gray-700 hover:text-red-500 opacity-0 group-hover:opacity-100">
                    <Trash2 size={11} strokeWidth={1.5} />
                  </button>
                </div>)}
              <button onClick={() => setCreating(true)} className="w-full text-center py-1.5 rounded-lg border border-indigo-500/30 hover:bg-indigo-500/10 font-mono text-[10px] font-bold text-red-400 mt-2">
                + CREATE NEW
              </button>
            </div>}
          {(creating || squads.length === 0) && <div className="p-4 space-y-3">
              <div>
                <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
                  Name
                </p>
                <input value={name} onChange={e => setName(e.target.value)} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-indigo-500/40" placeholder={`Squad ${squads.length + 1}`} />
              </div>
              <ProviderModelSelect providers={providers} label="Orchestrator (plans + delegates)" value={orchestrator} onChange={setOrchestrator} />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest">
                    Workers ({workers.length})
                  </p>
                  <button onClick={addWorker} className="flex items-center gap-1 font-mono text-[9px] text-red-400 hover:text-indigo-300">
                    <Plus size={10} strokeWidth={1.5} /> add worker
                  </button>
                </div>
                {workers.map((w, i) => <div key={w.id} className="border border-white/5 rounded-lg p-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <input value={w.role} onChange={e => updateWorker(w.id, { role: e.target.value })} className="flex-1 bg-black border border-white/10 rounded px-2 py-1 font-mono text-[10px] text-gray-200 focus:outline-none focus:border-indigo-500/40" placeholder="Role (e.g. Backend, Frontend, DevOps)" />
                    {workers.length > 1 && <button onClick={() => removeWorker(w.id)} className="text-gray-700 hover:text-red-500 p-1">
                      <Trash2 size={10} strokeWidth={1.5} />
                    </button>}
                  </div>
                  <ProviderModelSelect providers={providers} label="" value={{ providerId: w.providerId, model: w.model }} onChange={({ providerId, model }) => updateWorker(w.id, { providerId, model })} />
                </div>)}
              </div>
              <button onClick={() => setShowProvidersModal(true)} className="flex items-center gap-1.5 font-mono text-[10px] text-gray-500 hover:text-indigo-400">
                <Plus size={10} strokeWidth={1.5} /> novo provider
              </button>
              <p className="font-mono text-[9px] text-gray-700 leading-relaxed">
                The orchestrator spawns each worker with its own provider/model and coordinates via MCP messaging.
              </p>
              {(() => {
                const warnings = validateSquadModels();
                if (warnings.length === 0) return null;
                return (
                  <div className="p-2 rounded-lg border border-yellow-500/30 bg-yellow-500/5">
                    <p className="font-mono text-[9px] text-yellow-400 font-bold mb-1">Aviso: modelos corrigidos automaticamente</p>
                    {warnings.map((w, i) => (
                      <p key={i} className="font-mono text-[8px] text-yellow-500/70">{w}</p>
                    ))}
                  </div>
                );
              })()}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleSaveAndSpawn}
                  disabled={!effectiveWorkspace || tabs.length === 0}
                  className="flex-1 py-2 rounded-lg font-mono text-[11px] font-bold bg-[#5855e5] text-white hover:bg-[#4a47d6] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {!effectiveWorkspace ? 'Selecione um workspace ↑' : 'SAVE & SPAWN'}
                </button>
                {squads.length > 0 && <button onClick={() => setCreating(false)} className="px-4 py-2 rounded-lg font-mono text-[11px] font-bold text-gray-500 hover:text-gray-300 border border-white/10">
                    BACK
                  </button>}
              </div>
            </div>}
        </div>
      </div>
      <ProvidersModal open={showProvidersModal} onClose={() => {
      setShowProvidersModal(false);
      loadProviders();
    }} />
    </div>;
}
function isConversationVoiceMode$1(mode) {
  return mode === "conversation" || mode === "planning";
}
function outputModeForInteractionMode$1(mode) {
  return isConversationVoiceMode$1(mode) ? "original" : "english";
}
function normalizedVoiceMode$1(mode) {
  return isConversationVoiceMode$1(mode) ? "conversation" : "coding";
}
export function SettingsModal({
  open,
  onClose
}) {
  const fontSize = useTerminalSettings(s => s.fontSize);
  const fontFamily = useTerminalSettings(s => s.fontFamily);
  const lineHeight = useTerminalSettings(s => s.lineHeight);
  const theme = useTerminalSettings(s => s.theme);
  const defaultShellPath = useTerminalSettings(s => s.defaultShellPath);
  const inc = useTerminalSettings(s => s.increaseFontSize);
  const dec = useTerminalSettings(s => s.decreaseFontSize);
  const reset = useTerminalSettings(s => s.resetFontSize);
  const setFontFamily = useTerminalSettings(s => s.setFontFamily);
  const setLineHeight = useTerminalSettings(s => s.setLineHeight);
  const setTheme = useTerminalSettings(s => s.setTheme);
  const setDefaultShellPath = useTerminalSettings(s => s.setDefaultShellPath);
  const [shells, setShells] = React.useState([]);
  const [skillInstalled, setSkillInstalled] = React.useState(null);
  const [installedSkills, setInstalledSkills] = React.useState([]);
  const [skillBusy, setSkillBusy] = React.useState(false);
  const [skillMsg, setSkillMsg] = React.useState(null);
  const [audioConfig, setAudioConfig] = React.useState(null);
  const [audioKey, setAudioKey] = React.useState("");
  const [audioBusy, setAudioBusy] = React.useState(false);
  const [audioMsg, setAudioMsg] = React.useState(null);
  const refreshSkillStatus = async () => {
    try {
      const r = await window.codeBrainApp.skill.status();
      setSkillInstalled(!!r.installed);
      const list = await window.codeBrainApp.skill.list();
      setInstalledSkills(list ?? []);
    } catch {
      setSkillInstalled(false);
      setInstalledSkills([]);
    }
  };
  const handleSkillToggle = async () => {
    setSkillBusy(true);
    setSkillMsg(null);
    try {
      if (skillInstalled) {
        const r = await window.codeBrainApp.skill.uninstall();
        setSkillMsg(r.ok ? "Skill removida — abra um novo pane Claude pra aplicar." : `Erro: ${r.error}`);
      } else {
        const r = await window.codeBrainApp.skill.install();
        setSkillMsg(r.ok ? `Skill ${r.action} em ${r.path} — abra um novo pane Claude pra aplicar.` : `Erro: ${r.error}`);
      }
      await refreshSkillStatus();
    } catch (err) {
      setSkillMsg(`Erro: ${err instanceof Error ? err.message : String(err)}`);
    }
    setSkillBusy(false);
    setTimeout(() => setSkillMsg(null), 8e3);
  };
  const [redetecting, setRedetecting] = React.useState(false);
  const [redetectMsg, setRedetectMsg] = React.useState(null);
  const handleRedetect = async () => {
    setRedetecting(true);
    setRedetectMsg(null);
    try {
      const r = await window.codeBrainApp.cli.redetect();
      const found = r.filter(d => d.found).map(d => d.name);
      setRedetectMsg(found.length > 0 ? `Detectados: ${found.join(", ")}` : "Nenhum CLI no PATH");
    } catch {
      setRedetectMsg("Erro");
    }
    setRedetecting(false);
    setTimeout(() => setRedetectMsg(null), 4e3);
  };
  const refreshAudioConfig = async () => {
    try {
      const cfg = await window.codeBrainApp.audio.getConfig();
      setAudioConfig(cfg);
      setAudioKey("");
    } catch {
      setAudioConfig(null);
    }
  };
  const updateAudioConfig = patch => {
    setAudioConfig(cfg => cfg ? {
      ...cfg,
      ...patch
    } : cfg);
  };
  const handleAudioSave = async () => {
    if (!audioConfig) return;
    setAudioBusy(true);
    setAudioMsg(null);
    const patch = {
      provider: audioConfig.provider,
      baseUrl: audioConfig.baseUrl,
      model: audioConfig.model,
      localBinaryPath: audioConfig.localBinaryPath,
      localModelPath: audioConfig.localModelPath,
      language: audioConfig.language,
      prompt: audioConfig.prompt,
      chunkMs: audioConfig.chunkMs,
      outputMode: audioConfig.outputMode,
      captureMode: audioConfig.captureMode,
      interactionMode: audioConfig.interactionMode,
      targetWpm: audioConfig.targetWpm
    };
    if (audioKey.trim()) patch.apiKey = audioKey.trim();
    try {
      const res = await window.codeBrainApp.audio.saveConfig(patch);
      if (res.ok && res.config) {
        setAudioConfig(res.config);
        setAudioKey("");
        setAudioMsg("Voz salva.");
      } else {
        setAudioMsg(`Erro: ${res.error ?? "config inválida"}`);
      }
    } catch (err) {
      setAudioMsg(`Erro: ${err instanceof Error ? err.message : String(err)}`);
    }
    setAudioBusy(false);
    setTimeout(() => setAudioMsg(null), 5e3);
  };
  React.useEffect(() => {
    if (!open) return;
    const onKey = e => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    window.codeBrainApp.shells?.list?.().then(list => setShells(list ?? [])).catch(() => setShells([]));
    refreshSkillStatus();
    refreshAudioConfig();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return <div className="fixed top-[38px] left-0 right-0 bottom-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm cursor-pointer" onClick={onClose}>
      <div className="w-[440px] max-w-[90vw] max-h-[88vh] flex flex-col bg-[#0a0a0a] border border-white/10 rounded-xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <h2 className="font-mono text-[12px] font-bold text-white tracking-tight">
            Configurações
          </h2>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition-colors cursor-pointer">
            <X$1 size={14} strokeWidth={1.5} />
          </button>
        </div>
        <div className="p-4 space-y-5 overflow-y-auto hacker-scroll">
          <section>
            <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-2">
              Tema do terminal
            </p>
            <div className="grid grid-cols-2 gap-2">
              {["dark", "light"].map(t => <button onClick={() => setTheme(t)} className={`px-3 py-2 rounded border font-mono text-[11px] capitalize transition-all ${theme === t ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/40" : "border-white/10 text-gray-500 hover:text-gray-300 hover:border-white/20"}`}>
                  {t === "dark" ? "Escuro" : "Claro"}
                </button>)}
            </div>
          </section>
          <section>
            <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-2">
              Tamanho da fonte
            </p>
            <div className="flex items-center gap-2">
              <button onClick={dec} className="p-2 rounded border border-white/10 text-gray-400 hover:text-white hover:border-white/30 transition-all" title="Diminuir">
                <Minus size={14} strokeWidth={1.5} />
              </button>
              <div className="flex-1 text-center font-mono text-[13px] text-white py-2 rounded bg-white/[0.03] border border-white/5">
                {fontSize}px
              </div>
              <button onClick={inc} className="p-2 rounded border border-white/10 text-gray-400 hover:text-white hover:border-white/30 transition-all" title="Aumentar">
                <Plus size={14} strokeWidth={1.5} />
              </button>
              <button onClick={reset} className="p-2 rounded border border-white/10 text-gray-500 hover:text-gray-300 hover:border-white/20 transition-all" title="Resetar">
                <RotateCcw size={14} strokeWidth={1.5} />
              </button>
            </div>
            <p className="font-mono text-[9px] text-gray-700 mt-1.5">
              ⌘+ / ⌘− / ⌘0 também funciona
            </p>
          </section>
          <section>
            <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-2">
              Altura da linha
            </p>
            <div className="flex items-center gap-2">
              <input type="range" min={1} max={2} step={0.05} value={lineHeight} onChange={e => setLineHeight(parseFloat(e.target.value))} className="flex-1 accent-indigo-500" />
              <span className="font-mono text-[11px] text-gray-300 w-10 text-right">
                {lineHeight.toFixed(2)}
              </span>
              <button onClick={() => setLineHeight(1)} className="p-2 rounded border border-white/10 text-gray-500 hover:text-gray-300 hover:border-white/20 transition-all" title="Resetar">
                <RotateCcw size={14} strokeWidth={1.5} />
              </button>
            </div>
          </section>
          <section>
            <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-2">
              Fonte
            </p>
            <select value={fontFamily} onChange={e => setFontFamily(e.target.value)} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-indigo-500/40 appearance-none">
              {FONT_OPTIONS.map(f => <option value={f.id}>{f.label}</option>)}
            </select>
          </section>
          <section>
            <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-2">
              Shell padrão
            </p>
            <select value={defaultShellPath ?? ""} onChange={e => setDefaultShellPath(e.target.value || null)} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-indigo-500/40 appearance-none">
              <option value="">Padrão do sistema</option>
              {shells.filter(s => s.group === "native").map(s => <option value={s.path}>
                    {s.label} — {s.path}
                  </option>)}
              {shells.some(s => s.group === "wsl") && <optgroup label="WSL">
                  {shells.filter(s => s.group === "wsl").map(s => <option value={s.path}>{s.label}</option>)}
                </optgroup>}
            </select>
            <p className="font-mono text-[9px] text-gray-700 mt-1.5">
              {shells.length === 0 ? "Detectando shells…" : `${shells.length} shell(s) detectada(s) no sistema.`}
            </p>
          </section>
          <section>
            <div className="flex items-center justify-between mb-2">
              <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest">
                Voz / BrainVoice
              </p>
              <span className={`font-mono text-[8px] uppercase tracking-widest px-1.5 py-0.5 rounded border ${audioConfig?.provider === "local" ? audioConfig?.localReady ? "text-green-300 border-green-500/30 bg-green-500/10" : "text-yellow-300 border-yellow-500/30 bg-yellow-500/10" : audioConfig?.apiKeySet ? "text-green-300 border-green-500/30 bg-green-500/10" : "text-yellow-300 border-yellow-500/30 bg-yellow-500/10"}`}>
                {audioConfig?.provider === "local" ? audioConfig?.localReady ? "local pronto" : "local pendente" : audioConfig?.apiKeySet ? "groq pronto" : "sem key"}
              </span>
            </div>
            {<div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => updateAudioConfig({
                provider: "local"
              })} className={`text-left p-2 rounded border transition-all ${audioConfig?.provider === "local" ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200" : "border-white/10 bg-white/[0.02] text-gray-500 hover:text-gray-300 hover:border-white/20"}`}>
                    <div className="flex items-center gap-1.5 mb-1 font-mono text-[10px] font-bold uppercase tracking-widest">
                      <Cpu size={12} strokeWidth={1.5} />
                      Local
                    </div>
                    <p className="font-mono text-[9px] leading-relaxed text-gray-500">
                      Zero custo. Usa CPU/GPU e modelo no disco.
                    </p>
                  </button>
                  <button onClick={() => updateAudioConfig({
                provider: "groq"
              })} className={`text-left p-2 rounded border transition-all ${audioConfig?.provider === "groq" ? "border-indigo-500/40 bg-indigo-500/10 text-red-200" : "border-white/10 bg-white/[0.02] text-gray-500 hover:text-gray-300 hover:border-white/20"}`}>
                    <div className="flex items-center gap-1.5 mb-1 font-mono text-[10px] font-bold uppercase tracking-widest">
                      <Cloud size={12} strokeWidth={1.5} />
                      Groq
                    </div>
                    <p className="font-mono text-[9px] leading-relaxed text-gray-500">
                      Cloud rápido. Usa API key e pode gerar custo.
                    </p>
                  </button>
                </div>
                {audioConfig?.provider === "local" ? <div className="space-y-2">
                    <div>
                      <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
                        Binário whisper.cpp
                      </p>
                      <input value={audioConfig?.localBinaryPath ?? ""} onChange={e => updateAudioConfig({
                  localBinaryPath: e.target.value
                })} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-cyan-500/40" placeholder="Auto: whisper-cli no PATH" spellCheck={false} />
                    </div>
                    <div>
                      <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
                        Modelo local .bin
                      </p>
                      <input value={audioConfig?.localModelPath ?? ""} onChange={e => updateAudioConfig({
                  localModelPath: e.target.value
                })} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-cyan-500/40" placeholder="ex: ~/.codebrain-app/models/ggml-small.bin" spellCheck={false} />
                      <p className="font-mono text-[9px] text-gray-700 mt-1">
                        Para testar: whisper.cpp + modelo ggml. O Codebrain converte chunks com
                        ffmpeg.
                      </p>
                    </div>
                  </div> : <div>
                    <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
                      Groq API Key
                    </p>
                    <input type="password" value={audioKey} onChange={e => setAudioKey(e.target.value)} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-indigo-500/40" placeholder={audioConfig?.apiKeySet ? "********" : "gsk_..."} spellCheck={false} />
                  </div>}
                <div className="flex items-center gap-2">
                  <button onClick={handleAudioSave} disabled={audioBusy || !audioConfig} className="flex items-center gap-2 px-3 py-1.5 rounded border border-cyan-500/20 text-cyan-300 hover:text-cyan-200 hover:border-cyan-500/40 hover:bg-cyan-500/5 disabled:opacity-50 transition-all font-mono text-[10px]">
                    {audioBusy ? <RefreshCw size={12} strokeWidth={1.5} className="animate-spin" /> : audioConfig?.apiKeySet ? <Save size={12} strokeWidth={1.5} /> : <Mic size={12} strokeWidth={1.5} />}
                    {audioBusy ? "Salvando…" : "Salvar voz"}
                  </button>
                  {audioMsg && <p className="font-mono text-[9px] text-gray-500">{audioMsg}</p>}
                </div>
                <div className="rounded border border-white/10 bg-white/[0.02] px-2.5 py-2">
                  <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
                    Saída automática
                  </p>
                  <p className="font-mono text-[10px] text-gray-300">
                    {isConversationVoiceMode$1(audioConfig?.interactionMode) ? "CHAT mantém o texto em português/original." : "CODE traduz para inglês técnico e mantém resposta final em PT-BR."}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
                    Captura
                  </p>
                  <div className="grid grid-cols-2 gap-1">
                    <button onClick={() => updateAudioConfig({
                  captureMode: "hold"
                })} className={`px-2 py-1.5 rounded border font-mono text-[10px] font-bold uppercase tracking-wider transition-all ${(audioConfig?.captureMode ?? "hold") === "hold" ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200" : "border-white/10 text-gray-500 hover:text-gray-300 hover:border-white/20"}`}>
                      Hold
                    </button>
                    <button onClick={() => updateAudioConfig({
                  captureMode: "toggle"
                })} className={`px-2 py-1.5 rounded border font-mono text-[10px] font-bold uppercase tracking-wider transition-all ${audioConfig?.captureMode === "toggle" ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-200" : "border-white/10 text-gray-500 hover:text-gray-300 hover:border-white/20"}`}>
                      Toggle
                    </button>
                  </div>
                </div>
                <div>
                  <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
                    Modo
                  </p>
                  <button onClick={() => {
                const currentMode = normalizedVoiceMode$1(audioConfig?.interactionMode);
                const nextMode = currentMode === "coding" ? "conversation" : "coding";
                updateAudioConfig({
                  interactionMode: nextMode,
                  outputMode: outputModeForInteractionMode$1(nextMode)
                });
              }} className="w-full px-2 py-1.5 rounded border border-white/10 bg-white/[0.02] font-mono text-[10px] font-bold uppercase tracking-wider text-gray-300 transition-all hover:text-white hover:border-white/20 hover:bg-white/[0.05]">
                    {normalizedVoiceMode$1(audioConfig?.interactionMode) === "coding" ? "Code" : "Chat"}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {audioConfig?.provider !== "local" && <div>
                      <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
                        Modelo
                      </p>
                      <select value={audioConfig?.model ?? "whisper-large-v3"} onChange={e => updateAudioConfig({
                  model: e.target.value
                })} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-indigo-500/40 appearance-none">
                        <option value="whisper-large-v3">whisper-large-v3</option>
                        <option value="whisper-large-v3-turbo">whisper-large-v3-turbo</option>
                      </select>
                    </div>}
                  <div>
                    <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
                      Idioma
                    </p>
                    <select value={audioConfig?.language ?? ""} onChange={e => updateAudioConfig({
                  language: e.target.value
                })} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-indigo-500/40 appearance-none">
                      <option value="">Auto</option>
                      <option value="pt">pt</option>
                      <option value="en">en</option>
                      <option value="es">es</option>
                    </select>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest">
                      Chunk
                    </p>
                    <span className="font-mono text-[9px] text-gray-500">
                      {((audioConfig?.chunkMs ?? 2800) / 1e3).toFixed(1)}s
                    </span>
                  </div>
                  <input type="range" min={1800} max={6e3} step={100} value={audioConfig?.chunkMs ?? 2800} onChange={e => updateAudioConfig({
                chunkMs: Number(e.target.value)
              })} className="w-full accent-indigo-500" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest">
                      Ritmo alvo
                    </p>
                    <span className="font-mono text-[9px] text-gray-500">
                      {audioConfig?.targetWpm ?? 150} PPM
                    </span>
                  </div>
                  <input type="range" min={80} max={240} step={5} value={audioConfig?.targetWpm ?? 150} onChange={e => updateAudioConfig({
                targetWpm: Number(e.target.value)
              })} className="w-full accent-cyan-500" />
                </div>
                <div>
                  <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
                    Prompt STT
                  </p>
                  <input value={audioConfig?.prompt ?? ""} onChange={e => updateAudioConfig({
                prompt: e.target.value
              })} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-indigo-500/40" placeholder="Codebrain, Claude, Codex, MCP, Supabase, Groq" spellCheck={false} />
                </div>
              </div>}
          </section>
          <section>
            <div className="flex items-center justify-between mb-2">
              <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest">
                Skills do OpenClaude
              </p>
              <button
                onClick={() => window.codeBrainApp.skill.openFolder()}
                className="font-mono text-[9px] uppercase tracking-widest text-gray-500 hover:text-white transition-colors"
              >
                Abrir Pasta
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mb-4">
              {installedSkills.length === 0 ? (
                <span className="font-mono text-[10px] text-gray-600">Nenhuma skill na pasta.</span>
              ) : (
                installedSkills.map(skill => (
                  <span key={skill} className="px-2 py-1 rounded border font-mono text-[10px] border-indigo-500/30 text-indigo-300 bg-indigo-500/10">
                    {skill}
                  </span>
                ))
              )}
            </div>
            <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-2">
              Skill BFLabs Codebrain
            </p>
            <button onClick={handleSkillToggle} disabled={skillBusy || skillInstalled === null} className={`flex items-center gap-2 px-3 py-1.5 rounded border transition-all font-mono text-[10px] disabled:opacity-50 ${skillInstalled ? "border-green-500/30 text-green-300 hover:border-green-500/60 hover:bg-green-500/5" : "border-white/10 text-gray-300 hover:text-white hover:border-white/30"}`}>
              {skillBusy ? <RefreshCw size={12} strokeWidth={1.5} className="animate-spin" /> : skillInstalled ? <Check size={12} strokeWidth={1.5} /> : <Sparkles size={12} strokeWidth={1.5} />}
              {skillBusy ? skillInstalled ? "Removendo…" : "Instalando…" : skillInstalled ? "Skill instalada — clique pra remover" : "Instalar skill (BFLabsAI/codebrain-skill)"}
              {skillInstalled && !skillBusy && <Trash2 size={11} strokeWidth={1.5} className="ml-1 opacity-60" />}
            </button>
            {skillMsg && <p className="font-mono text-[9px] text-gray-500 mt-1.5">{skillMsg}</p>}
            <p className="font-mono text-[9px] text-gray-700 mt-1.5">
              Clona em ~/.claude/skills/codebrain-skill — ensina o Claude as 7 ferramentas MCP do
              Codebrain + padrões de orquestração.
            </p>
          </section>
          <section>
            <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-2">
              CLIs detectados
            </p>
            <button onClick={handleRedetect} disabled={redetecting} className="flex items-center gap-2 px-3 py-1.5 rounded border border-white/10 text-gray-300 hover:text-white hover:border-white/30 disabled:opacity-50 transition-all font-mono text-[10px]">
              <RefreshCw size={12} strokeWidth={1.5} className={redetecting ? "animate-spin" : ""} />
              {redetecting ? "Detectando…" : "Redetectar OpenClaude"}
            </button>
            {redetectMsg && <p className="font-mono text-[9px] text-gray-500 mt-1.5">{redetectMsg}</p>}
            <p className="font-mono text-[9px] text-gray-700 mt-1.5">
              Use depois de instalar uma CLI nova sem reiniciar o app.
            </p>
          </section>
          <section>
            <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-2">
              Imagens
            </p>
            <p className="font-mono text-[10px] text-gray-500 leading-relaxed">
              Arraste imagens (PNG/JPG/GIF/WEBP) pra dentro de qualquer terminal — o caminho é
              colado pro Claude anexar.
            </p>
          </section>
          {(() => {
          const ua = navigator.userAgent;
          const isMac = /Mac/i.test(ua) && !/Windows/i.test(ua);
          const macShortcuts = [["⌘T", "Novo pane"], ["⌘W", "Fechar pane"], ["⌘1–9", "Trocar workspace"], ["Ctrl+1–9", "Trocar pane"], ["⌘⇧] / [", "Workspace ± "], ["Ctrl+Tab", "Cycle workspace"], ["⌘+ / − / 0", "Fonte ± reset"], ["Shift+Enter", "Nova linha"], ["Shift+Bksp", "Apagar linha"], ["⌘← / →", "Início / fim"], ["⌘Bksp", "Apagar palavra"], ["⌘Del", "Apagar linha"], ["Opt← / →", "Palavra ± "], ["Opt+Bksp", "Palavra trás"], ["Ctrl+Bksp", "Palavra trás"], ["Ctrl+Del", "Palavra frente"]];
          const winLinuxShortcuts = [["Ctrl+T", "Novo pane"], ["Ctrl+W", "Fechar pane"], ["Ctrl+Tab", "Workspace seguinte"], ["Ctrl+Shift+Tab", "Workspace anterior"], ["Ctrl+1–9", "Trocar pane"], ["Ctrl++ / − / 0", "Fonte ± reset"], ["Shift+Enter", "Nova linha"], ["Shift+Bksp", "Apagar linha"], ["Ctrl+← / →", "Palavra ± "], ["Ctrl+Bksp", "Palavra trás"], ["Ctrl+Del", "Palavra frente"], ["Alt+← / →", "Palavra ± "], ["Alt+Bksp", "Palavra trás"]];
          const shortcuts = isMac ? macShortcuts : winLinuxShortcuts;
          return <details className="group">
                <summary className="cursor-pointer list-none flex items-center justify-between font-mono text-[9px] text-gray-600 uppercase tracking-widest hover:text-gray-400 transition-colors py-1">
                  <span>
                    Atalhos{" "}
                    <span className="text-gray-700 normal-case tracking-normal">
                      ({shortcuts.length})
                    </span>
                  </span>
                  <span className="text-gray-700 group-open:rotate-90 transition-transform inline-block leading-none">
                    ›
                  </span>
                </summary>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[9.5px] leading-snug">
                  {shortcuts.map(([key, desc]) => <div className="flex items-center gap-1.5 min-w-0 py-0.5">
                      <kbd className="font-mono text-[9px] text-indigo-300 bg-red-500/[0.08] border border-indigo-500/15 rounded px-1 py-px shrink-0 whitespace-nowrap">
                        {key}
                      </kbd>
                      <span className="text-gray-500 truncate">{desc}</span>
                    </div>)}
                </div>
              </details>;
        })()}
        </div>
      </div>
    </div>;
}

// ─── SquadWizard — 3-step squad creation wizard ──────────────────────────────

const _WIZARD_STEPS = [
  { id: 1, label: "Basic Info" },
  { id: 2, label: "Orchestrator" },
  { id: 3, label: "Workers" },
];

export function SquadWizard({
  open,
  onClose,
  onSpawn,
}: {
  open: boolean;
  onClose: () => void;
  onSpawn?: (config: any) => void;
}) {
  const providers = useProvidersStore((s: any) => s.providers);
  const [step, setStep] = React.useState(1);
  const [name, setName] = React.useState("");
  const [orchestrator, setOrchestrator] = React.useState<any>({});
  const [workers, setWorkers] = React.useState<any[]>([]);
  const tabs = useNavStore((s: any) => s.tabs) as any[];
  const activeTabIndex = useNavStore((s: any) => s.activeTabIndex) as number;
  const workspace: string | null =
    tabs?.[activeTabIndex]?.workspacePath ?? tabs?.[0]?.workspacePath ?? null;

  React.useEffect(() => {
    if (open) { setStep(1); setName(""); setOrchestrator({}); setWorkers([]); }
  }, [open]);

  if (!open) return null;

  const canNext =
    step === 1 ? name.trim().length > 0
    : step === 2 ? !!(orchestrator.providerId && orchestrator.model)
    : workers.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-lg bg-[#0c0c14] border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-violet-500/20 flex items-center justify-center">
              <Users size={14} className="text-violet-400" />
            </div>
            <span className="text-sm font-semibold text-slate-200">New Squad</span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X$1 size={16} />
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex items-center px-5 py-3 gap-1 border-b border-white/[0.04]">
          {_WIZARD_STEPS.map((ws, i) => (
            <React.Fragment key={ws.id}>
              <button
                onClick={() => ws.id < step ? setStep(ws.id) : undefined}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-mono font-bold uppercase tracking-wider transition-all ${
                  step === ws.id ? "bg-violet-500/20 text-violet-400"
                  : ws.id < step ? "text-slate-400 hover:text-slate-200 cursor-pointer"
                  : "text-slate-600 cursor-default"
                }`}
              >
                <span className="w-4 h-4 rounded-full border flex items-center justify-center text-[9px] font-bold border-current">{ws.id}</span>
                {ws.label}
              </button>
              {i < _WIZARD_STEPS.length - 1 && (
                <div className={`h-px w-5 transition-colors ${ws.id < step ? "bg-violet-500/40" : "bg-white/[0.06]"}`} />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Content */}
        <div className="p-5 min-h-[180px]">
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-mono text-slate-500 uppercase tracking-widest mb-1.5">Squad Name</label>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && canNext && setStep(2)}
                  placeholder="e.g. Feature Squad, Backend Team..."
                  className="w-full bg-[#0A0A0B] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-violet-500/50 transition-colors"
                />
              </div>
              {workspace && (
                <p className="text-[11px] font-mono text-slate-600 flex items-center gap-1.5">
                  <span className="text-slate-500">📁</span>
                  {folderLabel(workspace)}
                </p>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-[11px] font-mono text-slate-500 uppercase tracking-widest">Orchestrator LLM</p>
              <ProviderModelSelect
                providers={providers}
                value={orchestrator}
                onChange={(v: any) => setOrchestrator(v)}
                label="Orchestrator"
              />
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-mono text-slate-500 uppercase tracking-widest">Workers ({workers.length})</p>
                <button
                  onClick={() => setWorkers((w) => [...w, { id: nanoid(6), role: "worker", providerId: orchestrator.providerId, model: orchestrator.model }])}
                  className="flex items-center gap-1 text-[11px] font-mono text-violet-400 hover:text-violet-300 transition-colors"
                >
                  <Plus size={12} /> Add Worker
                </button>
              </div>
              {workers.length === 0 && (
                <div className="text-center py-8 text-slate-600 text-sm">No workers yet. Add at least one.</div>
              )}
              {workers.map((w, i) => (
                <div key={w.id} className="flex items-center gap-2 bg-[#0A0A0B] rounded-lg p-3 border border-white/[0.06]">
                  <input
                    value={w.role}
                    onChange={(e) => setWorkers((ws) => ws.map((x, j) => j === i ? { ...x, role: e.target.value } : x))}
                    placeholder="Role"
                    className="w-20 bg-transparent border-b border-white/10 text-[11px] font-mono text-slate-300 focus:outline-none focus:border-violet-500/50 pb-0.5"
                  />
                  <div className="flex-1">
                    <ProviderModelSelect
                      providers={providers}
                      value={{ providerId: w.providerId, model: w.model }}
                      onChange={(v: any) => setWorkers((ws) => ws.map((x, j) => j === i ? { ...x, ...v } : x))}
                      label=""
                    />
                  </div>
                  <button onClick={() => setWorkers((ws) => ws.filter((_, j) => j !== i))} className="text-slate-600 hover:text-red-400 transition-colors">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-white/[0.06]">
          <button
            onClick={() => step > 1 ? setStep(step - 1) : onClose()}
            className="text-[11px] font-mono text-slate-500 hover:text-slate-300 transition-colors uppercase tracking-wider"
          >
            {step > 1 ? "← Back" : "Cancel"}
          </button>
          {step < 3 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canNext}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-mono font-bold uppercase tracking-wider transition-all"
            >
              Next →
            </button>
          ) : (
            <button
              onClick={() => { onSpawn?.({ name, orchestrator, workers, workspace }); onClose(); }}
              disabled={!canNext}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-mono font-bold uppercase tracking-wider transition-all"
            >
              <Zap size={13} /> Spawn Squad
            </button>
          )}
        </div>

      </div>
    </div>
  );
}