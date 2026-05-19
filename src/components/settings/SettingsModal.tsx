import React from "react";
import { ArrowUpRight, Check, Cloud, Cpu, Mic, Minus, Plus, RefreshCw, RotateCcw, Save, Sparkles, Trash2, X$1 } from "../../stores/providers-store";
import { isConversationVoiceMode, normalizedVoiceMode, outputModeForInteractionMode } from "../../stores/tasks-store";
import { CostPanel } from "./CostPanel";

// SettingsModal, BrainVoiceUpgradeCard
import { FONT_OPTIONS, useTerminalSettings } from "../../stores/terminal-settings-store";
export function SettingsModal({ open, onClose }) {
  const fontSize = useTerminalSettings((s) => s.fontSize);
  const fontFamily = useTerminalSettings((s) => s.fontFamily);
  const lineHeight = useTerminalSettings((s) => s.lineHeight);
  const theme = useTerminalSettings((s) => s.theme);
  const defaultShellPath = useTerminalSettings((s) => s.defaultShellPath);
  const inc = useTerminalSettings((s) => s.increaseFontSize);
  const dec = useTerminalSettings((s) => s.decreaseFontSize);
  const reset = useTerminalSettings((s) => s.resetFontSize);
  const setFontFamily = useTerminalSettings((s) => s.setFontFamily);
  const setLineHeight = useTerminalSettings((s) => s.setLineHeight);
  const setTheme = useTerminalSettings((s) => s.setTheme);
  const setDefaultShellPath = useTerminalSettings((s) => s.setDefaultShellPath);
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
        setSkillMsg(
          r.ok ? "Skill removida — abra um novo pane Claude pra aplicar." : `Erro: ${r.error}`
        );
      } else {
        const r = await window.codeBrainApp.skill.install();
        setSkillMsg(
          r.ok
            ? `Skill ${r.action} em ${r.path} — abra um novo pane Claude pra aplicar.`
            : `Erro: ${r.error}`
        );
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
      const found = r.filter((d) => d.found).map((d) => d.name);
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
  const updateAudioConfig = (patch) => {
    setAudioConfig((cfg) =>
      cfg
        ? {
            ...cfg,
            ...patch,
          }
        : cfg
    );
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
      targetWpm: audioConfig.targetWpm,
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
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    window.codeBrainApp.shells
      ?.list?.()
      .then((list) => setShells(list ?? []))
      .catch(() => setShells([]));
    refreshSkillStatus();
    refreshAudioConfig();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed top-[38px] left-0 right-0 bottom-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm cursor-pointer"
      onClick={onClose}
    >
      <div
        className="w-[440px] max-w-[90vw] max-h-[88vh] flex flex-col bg-[#0a0a0a] border border-white/10 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
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
              {["dark", "light"].map((t) => (
                <button
                  onClick={() => setTheme(t)}
                  className={`px-3 py-2 rounded border font-mono text-[11px] capitalize transition-all ${theme === t ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/40" : "border-white/10 text-gray-500 hover:text-gray-300 hover:border-white/20"}`}
                >
                  {t === "dark" ? "Escuro" : "Claro"}
                </button>
              ))}
            </div>
          </section>
          <section>
            <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-2">
              Tamanho da fonte
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={dec}
                className="p-2 rounded border border-white/10 text-gray-400 hover:text-white hover:border-white/30 transition-all"
                title="Diminuir"
              >
                <Minus size={14} strokeWidth={1.5} />
              </button>
              <div className="flex-1 text-center font-mono text-[13px] text-white py-2 rounded bg-white/[0.03] border border-white/5">
                {fontSize}px
              </div>
              <button
                onClick={inc}
                className="p-2 rounded border border-white/10 text-gray-400 hover:text-white hover:border-white/30 transition-all"
                title="Aumentar"
              >
                <Plus size={14} strokeWidth={1.5} />
              </button>
              <button
                onClick={reset}
                className="p-2 rounded border border-white/10 text-gray-500 hover:text-gray-300 hover:border-white/20 transition-all"
                title="Resetar"
              >
                <RotateCcw size={14} strokeWidth={1.5} />
              </button>
            </div>
            <p className="font-mono text-[9px] text-gray-700 mt-1.5">
              ⌃+ / ⌃− / ⌃0 faz zoom da interface inteira
            </p>
          </section>
          <section>
            <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-2">
              Altura da linha
            </p>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={1}
                max={2}
                step={0.05}
                value={lineHeight}
                onChange={(e) => setLineHeight(parseFloat(e.target.value))}
                className="flex-1 accent-indigo-500"
              />
              <span className="font-mono text-[11px] text-gray-300 w-10 text-right">
                {lineHeight.toFixed(2)}
              </span>
              <button
                onClick={() => setLineHeight(1)}
                className="p-2 rounded border border-white/10 text-gray-500 hover:text-gray-300 hover:border-white/20 transition-all"
                title="Resetar"
              >
                <RotateCcw size={14} strokeWidth={1.5} />
              </button>
            </div>
          </section>
          <section>
            <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-2">
              Fonte
            </p>
            <select
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value)}
              className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-indigo-500/40 appearance-none"
            >
              {FONT_OPTIONS.map((f) => (
                <option value={f.id}>{f.label}</option>
              ))}
            </select>
          </section>
          <section>
            <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-2">
              Shell padrão
            </p>
            <select
              value={defaultShellPath ?? ""}
              onChange={(e) => setDefaultShellPath(e.target.value || null)}
              className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-indigo-500/40 appearance-none"
            >
              <option value="">Padrão do sistema</option>
              {shells
                .filter((s) => s.group === "native")
                .map((s) => (
                  <option value={s.path}>
                    {s.label} — {s.path}
                  </option>
                ))}
              {shells.some((s) => s.group === "wsl") && (
                <optgroup label="WSL">
                  {shells
                    .filter((s) => s.group === "wsl")
                    .map((s) => (
                      <option value={s.path}>{s.label}</option>
                    ))}
                </optgroup>
              )}
            </select>
            <p className="font-mono text-[9px] text-gray-700 mt-1.5">
              {shells.length === 0
                ? "Detectando shells…"
                : `${shells.length} shell(s) detectada(s) no sistema.`}
            </p>
          </section>
          <section>
            <div className="flex items-center justify-between mb-2">
              <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest">
                Voz / BrainVoice
              </p>
              <span
                className={`font-mono text-[8px] uppercase tracking-widest px-1.5 py-0.5 rounded border ${audioConfig?.provider === "local" ? (audioConfig?.localReady ? "text-green-300 border-green-500/30 bg-green-500/10" : "text-yellow-300 border-yellow-500/30 bg-yellow-500/10") : audioConfig?.apiKeySet ? "text-green-300 border-green-500/30 bg-green-500/10" : "text-yellow-300 border-yellow-500/30 bg-yellow-500/10"}`}
              >
                {audioConfig?.provider === "local"
                  ? audioConfig?.localReady
                    ? "local pronto"
                    : "local pendente"
                  : audioConfig?.apiKeySet
                    ? "groq pronto"
                    : "sem key"}
              </span>
            </div>
            {true && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() =>
                      updateAudioConfig({
                        provider: "local",
                      })
                    }
                    className={`text-left p-2 rounded border transition-all ${audioConfig?.provider === "local" ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200" : "border-white/10 bg-white/[0.02] text-gray-500 hover:text-gray-300 hover:border-white/20"}`}
                  >
                    <div className="flex items-center gap-1.5 mb-1 font-mono text-[10px] font-bold uppercase tracking-widest">
                      <Cpu size={12} strokeWidth={1.5} />
                      Local
                    </div>
                    <p className="font-mono text-[9px] leading-relaxed text-gray-500">
                      Zero custo. Usa CPU/GPU e modelo no disco.
                    </p>
                  </button>
                  <button
                    onClick={() =>
                      updateAudioConfig({
                        provider: "groq",
                      })
                    }
                    className={`text-left p-2 rounded border transition-all ${audioConfig?.provider === "groq" ? "border-indigo-500/40 bg-indigo-500/10 text-red-200" : "border-white/10 bg-white/[0.02] text-gray-500 hover:text-gray-300 hover:border-white/20"}`}
                  >
                    <div className="flex items-center gap-1.5 mb-1 font-mono text-[10px] font-bold uppercase tracking-widest">
                      <Cloud size={12} strokeWidth={1.5} />
                      Groq
                    </div>
                    <p className="font-mono text-[9px] leading-relaxed text-gray-500">
                      Cloud rápido. Usa API key e pode gerar custo.
                    </p>
                  </button>
                </div>
                {audioConfig?.provider === "local" ? (
                  <div className="space-y-2">
                    <div>
                      <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
                        Binário whisper.cpp
                      </p>
                      <input
                        value={audioConfig?.localBinaryPath ?? ""}
                        onChange={(e) =>
                          updateAudioConfig({
                            localBinaryPath: e.target.value,
                          })
                        }
                        className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-cyan-500/40"
                        placeholder="Auto: whisper-cli no PATH"
                        spellCheck={false}
                      />
                    </div>
                    <div>
                      <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
                        Modelo local .bin
                      </p>
                      <input
                        value={audioConfig?.localModelPath ?? ""}
                        onChange={(e) =>
                          updateAudioConfig({
                            localModelPath: e.target.value,
                          })
                        }
                        className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-cyan-500/40"
                        placeholder="ex: ~/.codebrain-app/models/ggml-small.bin"
                        spellCheck={false}
                      />
                      <p className="font-mono text-[9px] text-gray-700 mt-1">
                        Para testar: whisper.cpp + modelo ggml. O Codebrain converte chunks com
                        ffmpeg.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
                      Groq API Key
                    </p>
                    <input
                      type="password"
                      value={audioKey}
                      onChange={(e) => setAudioKey(e.target.value)}
                      className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-indigo-500/40"
                      placeholder={audioConfig?.apiKeySet ? "********" : "gsk_..."}
                      spellCheck={false}
                    />
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleAudioSave}
                    disabled={audioBusy || !audioConfig}
                    className="flex items-center gap-2 px-3 py-1.5 rounded border border-cyan-500/20 text-cyan-300 hover:text-cyan-200 hover:border-cyan-500/40 hover:bg-cyan-500/5 disabled:opacity-50 transition-all font-mono text-[10px]"
                  >
                    {audioBusy ? (
                      <RefreshCw size={12} strokeWidth={1.5} className="animate-spin" />
                    ) : audioConfig?.apiKeySet ? (
                      <Save size={12} strokeWidth={1.5} />
                    ) : (
                      <Mic size={12} strokeWidth={1.5} />
                    )}
                    {audioBusy ? "Salvando…" : "Salvar voz"}
                  </button>
                  {audioMsg && <p className="font-mono text-[9px] text-gray-500">{audioMsg}</p>}
                </div>
                <div className="rounded border border-white/10 bg-white/[0.02] px-2.5 py-2">
                  <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
                    Saída automática
                  </p>
                  <p className="font-mono text-[10px] text-gray-300">
                    {isConversationVoiceMode(audioConfig?.interactionMode)
                      ? "CHAT mantém o texto em português/original."
                      : "CODE traduz para inglês técnico e mantém resposta final em PT-BR."}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
                    Captura
                  </p>
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      onClick={() =>
                        updateAudioConfig({
                          captureMode: "hold",
                        })
                      }
                      className={`px-2 py-1.5 rounded border font-mono text-[10px] font-bold uppercase tracking-wider transition-all ${(audioConfig?.captureMode ?? "hold") === "hold" ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200" : "border-white/10 text-gray-500 hover:text-gray-300 hover:border-white/20"}`}
                    >
                      Hold
                    </button>
                    <button
                      onClick={() =>
                        updateAudioConfig({
                          captureMode: "toggle",
                        })
                      }
                      className={`px-2 py-1.5 rounded border font-mono text-[10px] font-bold uppercase tracking-wider transition-all ${audioConfig?.captureMode === "toggle" ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-200" : "border-white/10 text-gray-500 hover:text-gray-300 hover:border-white/20"}`}
                    >
                      Toggle
                    </button>
                  </div>
                </div>
                <div>
                  <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
                    Modo
                  </p>
                  <button
                    onClick={() => {
                      const currentMode = normalizedVoiceMode(audioConfig?.interactionMode);
                      const nextMode = currentMode === "coding" ? "conversation" : "coding";
                      updateAudioConfig({
                        interactionMode: nextMode,
                        outputMode: outputModeForInteractionMode(nextMode),
                      });
                    }}
                    className="w-full px-2 py-1.5 rounded border border-white/10 bg-white/[0.02] font-mono text-[10px] font-bold uppercase tracking-wider text-gray-300 transition-all hover:text-white hover:border-white/20 hover:bg-white/[0.05]"
                  >
                    {normalizedVoiceMode(audioConfig?.interactionMode) === "coding"
                      ? "Code"
                      : "Chat"}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {audioConfig?.provider !== "local" && (
                    <div>
                      <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
                        Modelo
                      </p>
                      <select
                        value={audioConfig?.model ?? "whisper-large-v3"}
                        onChange={(e) =>
                          updateAudioConfig({
                            model: e.target.value,
                          })
                        }
                        className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-indigo-500/40 appearance-none"
                      >
                        <option value="whisper-large-v3">whisper-large-v3</option>
                        <option value="whisper-large-v3-turbo">whisper-large-v3-turbo</option>
                      </select>
                    </div>
                  )}
                  <div>
                    <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
                      Idioma
                    </p>
                    <select
                      value={audioConfig?.language ?? ""}
                      onChange={(e) =>
                        updateAudioConfig({
                          language: e.target.value,
                        })
                      }
                      className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-indigo-500/40 appearance-none"
                    >
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
                  <input
                    type="range"
                    min={1800}
                    max={6e3}
                    step={100}
                    value={audioConfig?.chunkMs ?? 2800}
                    onChange={(e) =>
                      updateAudioConfig({
                        chunkMs: Number(e.target.value),
                      })
                    }
                    className="w-full accent-indigo-500"
                  />
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
                  <input
                    type="range"
                    min={80}
                    max={240}
                    step={5}
                    value={audioConfig?.targetWpm ?? 150}
                    onChange={(e) =>
                      updateAudioConfig({
                        targetWpm: Number(e.target.value),
                      })
                    }
                    className="w-full accent-cyan-500"
                  />
                </div>
                <div>
                  <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
                    Prompt STT
                  </p>
                  <input
                    value={audioConfig?.prompt ?? ""}
                    onChange={(e) =>
                      updateAudioConfig({
                        prompt: e.target.value,
                      })
                    }
                    className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-indigo-500/40"
                    placeholder="CodeBrain, Claude, Codex, MCP, Supabase, Groq"
                    spellCheck={false}
                  />
                </div>
              </div>
            )}
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
              Skill BFLabs CodeBrain
            </p>
            <button
              onClick={handleSkillToggle}
              disabled={skillBusy || skillInstalled === null}
              className={`flex items-center gap-2 px-3 py-1.5 rounded border transition-all font-mono text-[10px] disabled:opacity-50 ${skillInstalled ? "border-green-500/30 text-green-300 hover:border-green-500/60 hover:bg-green-500/5" : "border-white/10 text-gray-300 hover:text-white hover:border-white/30"}`}
            >
              {skillBusy ? (
                <RefreshCw size={12} strokeWidth={1.5} className="animate-spin" />
              ) : skillInstalled ? (
                <Check size={12} strokeWidth={1.5} />
              ) : (
                <Sparkles size={12} strokeWidth={1.5} />
              )}
              {skillBusy
                ? skillInstalled
                  ? "Removendo…"
                  : "Instalando…"
                : skillInstalled
                  ? "Skill instalada — clique pra remover"
                  : "Instalar skill (BFLabsAI/codebrain-skill)"}
              {skillInstalled && !skillBusy && (
                <Trash2 size={11} strokeWidth={1.5} className="ml-1 opacity-60" />
              )}
            </button>
            {skillMsg && <p className="font-mono text-[9px] text-gray-500 mt-1.5">{skillMsg}</p>}
            <p className="font-mono text-[9px] text-gray-700 mt-1.5">
              Clona em ~/.claude/skills/codebrain-skill — ensina o Claude as 7 ferramentas MCP do
              CodeBrain + padrões de orquestração.
            </p>
          </section>
          <section>
            <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-2">
              CLIs detectados
            </p>
            <button
              onClick={handleRedetect}
              disabled={redetecting}
              className="flex items-center gap-2 px-3 py-1.5 rounded border border-white/10 text-gray-300 hover:text-white hover:border-white/30 disabled:opacity-50 transition-all font-mono text-[10px]"
            >
              <RefreshCw
                size={12}
                strokeWidth={1.5}
                className={redetecting ? "animate-spin" : ""}
              />
              {redetecting ? "Detectando…" : "Redetectar OpenClaude"}
            </button>
            {redetectMsg && (
              <p className="font-mono text-[9px] text-gray-500 mt-1.5">{redetectMsg}</p>
            )}
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
          <section>
            <CostPanel />
          </section>
          {(() => {
            const ua = navigator.userAgent;
            const isMac = /Mac/i.test(ua) && !/Windows/i.test(ua);
            const macShortcuts = [
              ["⌘T", "Novo pane"],
              ["⌘W", "Fechar pane"],
              ["⌘1–9", "Trocar workspace"],
              ["Ctrl+1–9", "Trocar pane"],
              ["⌘⇧] / [", "Workspace ±"],
              ["Ctrl+Tab", "Cycle workspace"],
              ["⌘+ / − / 0", "Zoom interface"],
              ["Shift+Enter", "Nova linha"],
              ["Shift+Bksp", "Apagar linha"],
              ["⌘← / →", "Início / fim"],
              ["⌘Bksp", "Apagar palavra"],
              ["⌘Del", "Apagar linha"],
              ["Opt← / →", "Palavra ±"],
              ["Opt+Bksp", "Palavra atrás"],
              ["Ctrl+Bksp", "Palavra atrás"],
              ["Ctrl+Del", "Palavra frente"],
            ];
            const winLinuxShortcuts = [
              ["Ctrl+T", "Novo pane"],
              ["Ctrl+W", "Fechar pane"],
              ["Ctrl+Tab", "Workspace seguinte"],
              ["Ctrl+Shift+Tab", "Workspace anterior"],
              ["Ctrl+1–9", "Trocar pane"],
              ["Ctrl++ / − / 0", "Zoom interface"],
              ["Shift+Enter", "Nova linha"],
              ["Shift+Bksp", "Apagar linha"],
              ["Ctrl+← / →", "Palavra ±"],
              ["Ctrl+Bksp", "Palavra atrás"],
              ["Ctrl+Del", "Palavra frente"],
              ["Alt+← / →", "Palavra ±"],
              ["Alt+Bksp", "Palavra atrás"],
            ];
            const shortcuts = isMac ? macShortcuts : winLinuxShortcuts;
            return (
              <details className="group">
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
                  {shortcuts.map(([key, desc]) => (
                    <div className="flex items-center gap-1.5 min-w-0 py-0.5">
                      <kbd className="font-mono text-[9px] text-indigo-300 bg-red-500/[0.08] border border-indigo-500/15 rounded px-1 py-px shrink-0 whitespace-nowrap">
                        {key}
                      </kbd>
                      <span className="text-gray-500 truncate">{desc}</span>
                    </div>
                  ))}
                </div>
              </details>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
export function BrainVoiceUpgradeCard() {
  return (
    <div className="border border-indigo-500/20 bg-red-500/[0.04] rounded-lg overflow-hidden">
      <div className="p-3 border-b border-indigo-500/10">
        <div className="flex items-center gap-2 mb-2">
          <div className="h-8 w-8 rounded border border-indigo-500/25 bg-indigo-500/10 flex items-center justify-center shrink-0">
            <Mic size={15} strokeWidth={1.6} className="text-indigo-300" />
          </div>
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-indigo-300">
              BrainVoice
            </p>
            <p className="font-mono text-[9px] uppercase tracking-widest text-gray-600">
              Exclusivo Boost Pro
            </p>
          </div>
        </div>
        <p className="font-mono text-[10px] leading-relaxed text-gray-400">
          Fale em portugues dentro de qualquer pane. O CodeBrain prepara a fala para o agente
          executar melhor e mantem a resposta final em PT-BR.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-px bg-indigo-500/10">
        {[
          ["Espaço para falar", "Hold ou Toggle"],
          ["CODE / CHAT", "Execucao ou conversa"],
          ["VOL + PPM", "Volume e ritmo ao vivo"],
          ["Local ou Groq", "Custo zero ou cloud rapido"],
        ].map(([title, text]) => (
          <div className="bg-[#0a0a0a] p-2.5">
            <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-gray-200">
              {title}
            </p>
            <p className="font-mono text-[9px] leading-relaxed text-gray-600 mt-1">{text}</p>
          </div>
        ))}
      </div>
      <div className="p-3 flex items-center justify-between gap-3">
        <p className="font-mono text-[9px] leading-relaxed text-gray-600">
          As configuracoes de voz aparecem depois do upgrade.
        </p>
        <button
          onClick={() => window.codeBrainApp?.auth?.openBilling?.()}
          className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded border border-indigo-500/40 bg-indigo-500/10 text-red-200 hover:bg-indigo-500/15 hover:border-indigo-500/60 transition-all font-mono text-[9px] font-bold uppercase tracking-widest shrink-0"
        >
          Fazer upgrade
          <ArrowUpRight size={12} strokeWidth={1.7} />
        </button>
      </div>
    </div>
  );
}
