import React from "react";
import { outputModeForInteractionMode, normalizedVoiceMode } from "../stores/tasks-store";

export function useAudioConfig() {
  const [audioConfig, setAudioConfig] = React.useState<any>(null);
  const [audioModeBusy, setAudioModeBusy] = React.useState(false);

  const refreshAudioConfig = React.useCallback(() => {
    const api = window.codeBrainApp?.audio;
    if (!api) { setAudioConfig(null); return; }
    api.getConfig().then(cfg => setAudioConfig(cfg)).catch(() => setAudioConfig(null));
  }, []);

  React.useEffect(() => { refreshAudioConfig(); }, [refreshAudioConfig]);

  const saveAudioPatch = async (patch: Record<string, unknown>) => {
    if (!audioConfig || audioModeBusy) return;
    setAudioModeBusy(true);
    setAudioConfig((cfg: any) => cfg ? { ...cfg, ...patch } : cfg);
    try {
      const res = await window.codeBrainApp?.audio?.saveConfig(patch);
      if (res?.ok && res.config) setAudioConfig(res.config);
      else refreshAudioConfig();
    } finally { setAudioModeBusy(false); }
  };

  const setVoiceInteractionMode = (interactionMode: string) => {
    void saveAudioPatch({ interactionMode, outputMode: outputModeForInteractionMode(interactionMode) });
  };

  const toggleVoiceInteractionMode = () => {
    const currentMode = normalizedVoiceMode(audioConfig?.interactionMode);
    setVoiceInteractionMode(currentMode === "coding" ? "conversation" : "coding");
  };

  return { audioConfig, audioModeBusy, refreshAudioConfig, saveAudioPatch, setVoiceInteractionMode, toggleVoiceInteractionMode };
}
