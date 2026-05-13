import React from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const INITIAL_VOICE_STATS = {
  visible: false,
  phase: "idle",
  elapsedMs: 0,
  words: 0,
  wpm: 0,
  targetWpm: 150,
  pace: "idle",
  level: 0,
  levels: Array.from({ length: 24 }, () => 0),
  chunksPending: 0,
  lastText: null,
  error: null
};

// useVoiceStore
export const useVoiceStore = create(set => ({
  stats: INITIAL_VOICE_STATS,
  cancelRequestId: 0,
  setStats: stats => set({
    stats
  }),
  requestCancel: () => set(state => ({
    cancelRequestId: state.cancelRequestId + 1
  }))
}));
export const HOLD_THRESHOLD_MS = 220;
export const MIN_AUDIO_BYTES = 2e3;
export const HIDE_AFTER_MS = 1800;
export const MIN_SPEECH_RMS = 0.018;
export const MIN_SPEECH_RATIO = 0.025;
export const CODING_VOICE_PREFIX = "Coding mode. This text may be an English translation of Brazilian Portuguese dictation for a software task. Treat it as the user task. Think, plan, search, use tools, and write progress in English. Final answer to the user must be in Brazilian Portuguese. Task: ";
export function usePushToTalk({
  paneId,
  enabled
}) {
  const [stats, setStats] = React.useState(INITIAL_VOICE_STATS);
  React.useEffect(() => {
    useVoiceStore.getState().setStats(stats);
  }, [stats]);
  const cancelRequestId = useVoiceStore(s => s.cancelRequestId);
  const enabledRef = React.useRef(enabled);
  const paneIdRef = React.useRef(paneId);
  const spaceDownRef = React.useRef(false);
  const startingRef = React.useRef(false);
  const recordingRef = React.useRef(false);
  const generationRef = React.useRef(0);
  const discardSegmentRef = React.useRef(false);
  const spacePassedThroughRef = React.useRef(false);
  const lastCancelRequestIdRef = React.useRef(cancelRequestId);
  const holdTimerRef = React.useRef(null);
  const hideTimerRef = React.useRef(null);
  const elapsedTimerRef = React.useRef(null);
  const segmentTimerRef = React.useRef(null);
  const recorderRef = React.useRef(null);
  const streamRef = React.useRef(null);
  const levelAudioCtxRef = React.useRef(null);
  const levelRafRef = React.useRef(null);
  const levelLastPublishRef = React.useRef(0);
  const startedAtRef = React.useRef(0);
  const wordsRef = React.useRef(0);
  const pendingChunksRef = React.useRef(0);
  const chunkMsRef = React.useRef(2800);
  const outputModeRef = React.useRef("english");
  const captureModeRef = React.useRef("hold");
  const interactionModeRef = React.useRef("coding");
  const lastPrefixedModeRef = React.useRef(null);
  const targetWpmRef = React.useRef(150);
  const transcriptContextRef = React.useRef("");
  const levelRef = React.useRef(0);
  const levelsRef = React.useRef(Array.from({
    length: 24
  }, () => 0));
  const queueRef = React.useRef(Promise.resolve());
  React.useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  React.useEffect(() => {
    paneIdRef.current = paneId;
  }, [paneId]);
  const publish = React.useCallback((patch = {}) => {
    const elapsedMs = startedAtRef.current > 0 ? Date.now() - startedAtRef.current : 0;
    const words = wordsRef.current;
    const minutes = elapsedMs / 6e4;
    const wpm = minutes > 0 ? Math.round(words / minutes) : 0;
    const targetWpm = targetWpmRef.current;
    const pace = getPace(wpm, targetWpm, words);
    setStats(prev => ({
      ...prev,
      visible: true,
      elapsedMs,
      words,
      wpm,
      targetWpm,
      pace,
      level: levelRef.current,
      levels: levelsRef.current,
      chunksPending: pendingChunksRef.current,
      ...patch
    }));
  }, []);
  const clearHideTimer = React.useCallback(() => {
    if (!hideTimerRef.current) return;
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);
  const scheduleHide = React.useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      if (recordingRef.current || pendingChunksRef.current > 0) return;
      setStats(prev => ({
        ...prev,
        visible: false,
        phase: "idle"
      }));
    }, HIDE_AFTER_MS);
  }, [clearHideTimer]);
  const stopElapsedTimer = React.useCallback(() => {
    if (!elapsedTimerRef.current) return;
    clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = null;
  }, []);
  const stopStream = React.useCallback(() => {
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach(track => track.stop());
  }, []);
  const stopLevelMeter = React.useCallback(() => {
    if (levelRafRef.current !== null) {
      cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = null;
    }
    const ctx = levelAudioCtxRef.current;
    levelAudioCtxRef.current = null;
    ctx?.close().catch(() => {});
    levelRef.current = 0;
    levelsRef.current = levelsRef.current.map(() => 0);
  }, []);
  const resetVoiceStats = React.useCallback(() => {
    const next = {
      ...INITIAL_VOICE_STATS,
      targetWpm: targetWpmRef.current
    };
    setStats(next);
  }, []);
  const startLevelMeter = React.useCallback(stream => {
    stopLevelMeter();
    try {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return;
      const ctx = new AudioContextCtor();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.65;
      source.connect(analyser);
      levelAudioCtxRef.current = ctx;
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const value of data) {
          const centered = (value - 128) / 128;
          sum += centered * centered;
        }
        const rms = Math.sqrt(sum / data.length);
        const level = Math.max(0, Math.min(1, rms * 5));
        levelRef.current = level;
        levelsRef.current = [...levelsRef.current.slice(1), level];
        const now = Date.now();
        if (now - levelLastPublishRef.current > 55) {
          levelLastPublishRef.current = now;
          publish();
        }
        levelRafRef.current = requestAnimationFrame(tick);
      };
      levelRafRef.current = requestAnimationFrame(tick);
    } catch {}
  }, [publish, stopLevelMeter]);
  const stopCurrentRecorder = React.useCallback(() => {
    if (segmentTimerRef.current) {
      clearTimeout(segmentTimerRef.current);
      segmentTimerRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") {
      recorder.stop();
    }
  }, []);
  const endRecording = React.useCallback(() => {
    recordingRef.current = false;
    stopLevelMeter();
    publish({
      phase: pendingChunksRef.current > 0 ? "transcribing" : "idle"
    });
    stopCurrentRecorder();
  }, [publish, stopCurrentRecorder, stopLevelMeter]);
  const enqueueTranscription = React.useCallback(async blob => {
    if (blob.size < MIN_AUDIO_BYTES) return;
    const generation = generationRef.current;
    const hasSpeech = await blobLooksLikeSpeech(blob);
    if (!hasSpeech) return;
    if (generation !== generationRef.current) return;
    pendingChunksRef.current += 1;
    publish({
      phase: recordingRef.current ? "listening" : "transcribing",
      error: null
    });
    const run = async () => {
      try {
        const api = window.codeBrainApp?.audio;
        if (!api) throw new Error("audio ipc unavailable");
        const res = await api.transcribe({
          bytes: await blob.arrayBuffer(),
          mimeType: blob.type || "audio/webm",
          context: transcriptContextRef.current
        });
        if (!res.ok) throw new Error(res.error ?? "transcription failed");
        if (generation !== generationRef.current) return;
        const text = dedupeTranscript(normalizeTranscript(res.text ?? ""), transcriptContextRef.current);
        if (shouldIgnoreTranscript(text)) return;
        if (!text) return;
        wordsRef.current += countWords(text);
        transcriptContextRef.current = updateTranscriptContext(transcriptContextRef.current, text);
        window.codeBrainApp?.pty.write(paneIdRef.current, `${formatVoiceText(text, interactionModeRef.current, lastPrefixedModeRef)} `);
        publish({
          phase: recordingRef.current ? "listening" : "transcribing",
          lastText: text,
          error: null
        });
      } catch (err) {
        if (generation !== generationRef.current) return;
        publish({
          phase: "error",
          error: err instanceof Error ? err.message : String(err)
        });
      } finally {
        if (generation !== generationRef.current) return;
        pendingChunksRef.current = Math.max(0, pendingChunksRef.current - 1);
        publish({
          phase: recordingRef.current ? "listening" : pendingChunksRef.current > 0 ? "transcribing" : "idle"
        });
        if (!recordingRef.current && pendingChunksRef.current === 0) {
          stopElapsedTimer();
          scheduleHide();
        }
      }
    };
    queueRef.current = queueRef.current.catch(() => void 0).then(run);
  }, [publish, scheduleHide, stopElapsedTimer]);
  const startSegment = React.useCallback(() => {
    const stream = streamRef.current;
    if (!stream || !recordingRef.current) return;
    const mimeType = pickMimeType();
    const chunks = [];
    const recorder = new MediaRecorder(stream, mimeType ? {
      mimeType
    } : void 0);
    recorderRef.current = recorder;
    recorder.ondataavailable = event => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => {
      publish({
        phase: "error",
        error: "media recorder error"
      });
    };
    recorder.onstop = () => {
      const discardSegment = discardSegmentRef.current;
      discardSegmentRef.current = false;
      if (segmentTimerRef.current) {
        clearTimeout(segmentTimerRef.current);
        segmentTimerRef.current = null;
      }
      const type = recorder.mimeType || mimeType || "audio/webm";
      if (!discardSegment && chunks.length > 0) void enqueueTranscription(new Blob(chunks, {
        type
      }));
      recorderRef.current = null;
      if (recordingRef.current && (captureModeRef.current === "toggle" || spaceDownRef.current)) {
        startSegment();
        return;
      }
      stopStream();
      publish({
        phase: pendingChunksRef.current > 0 ? "transcribing" : "idle"
      });
      if (pendingChunksRef.current === 0) {
        stopElapsedTimer();
        scheduleHide();
      }
    };
    recorder.start();
    segmentTimerRef.current = setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, chunkMsRef.current);
  }, [enqueueTranscription, publish, scheduleHide, stopElapsedTimer, stopStream]);
  const beginRecording = React.useCallback(async () => {
    if (startingRef.current || recordingRef.current) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    discardSegmentRef.current = false;
    startingRef.current = true;
    clearHideTimer();
    publish({
      phase: "pending",
      error: null,
      lastText: null
    });
    try {
      const api = window.codeBrainApp?.audio;
      if (!api) throw new Error("audio ipc unavailable");
      const cfg = await api.getConfig();
      if (!cfg.BrainVoiceAccess.allowed) throw new Error(BrainVoiceAccessMessage(cfg.BrainVoiceAccess.reason));
      if (cfg.provider === "groq" && !cfg.apiKeySet) throw new Error("configure Groq em Configurações");
      if (cfg.provider === "local" && !cfg.localReady) throw new Error("configure whisper.cpp local em Configurações");
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("microfone indisponível");
      if (typeof MediaRecorder === "undefined") throw new Error("MediaRecorder indisponível");
      chunkMsRef.current = cfg.chunkMs;
      outputModeRef.current = cfg.outputMode;
      captureModeRef.current = cfg.captureMode ?? "hold";
      interactionModeRef.current = cfg.interactionMode ?? "coding";
      targetWpmRef.current = cfg.targetWpm;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      if (generation !== generationRef.current) {
        stream.getTracks().forEach(track => track.stop());
        startingRef.current = false;
        resetVoiceStats();
        return;
      }
      startingRef.current = false;
      if (captureModeRef.current === "hold" && !spaceDownRef.current) {
        stream.getTracks().forEach(track => track.stop());
        publish({
          phase: "idle"
        });
        scheduleHide();
        return;
      }
      streamRef.current = stream;
      recordingRef.current = true;
      startedAtRef.current = Date.now();
      wordsRef.current = 0;
      pendingChunksRef.current = 0;
      transcriptContextRef.current = "";
      levelRef.current = 0;
      levelsRef.current = levelsRef.current.map(() => 0);
      publish({
        phase: "listening",
        elapsedMs: 0,
        words: 0,
        wpm: 0,
        lastText: null,
        error: null
      });
      elapsedTimerRef.current = setInterval(() => publish(), 250);
      startLevelMeter(stream);
      startSegment();
    } catch (err) {
      startingRef.current = false;
      recordingRef.current = false;
      stopLevelMeter();
      stopStream();
      stopElapsedTimer();
      publish({
        phase: "error",
        error: err instanceof Error ? err.message : String(err)
      });
      scheduleHide();
    }
  }, [clearHideTimer, publish, resetVoiceStats, scheduleHide, startSegment, stopElapsedTimer, stopStream]);
  const cancelVoice = React.useCallback(() => {
    generationRef.current += 1;
    spaceDownRef.current = false;
    spacePassedThroughRef.current = false;
    startingRef.current = false;
    recordingRef.current = false;
    pendingChunksRef.current = 0;
    wordsRef.current = 0;
    startedAtRef.current = 0;
    transcriptContextRef.current = "";
    discardSegmentRef.current = true;
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    clearHideTimer();
    stopElapsedTimer();
    stopLevelMeter();
    stopCurrentRecorder();
    stopStream();
    resetVoiceStats();
  }, [clearHideTimer, resetVoiceStats, stopCurrentRecorder, stopElapsedTimer, stopLevelMeter, stopStream]);
  const releaseSpace = React.useCallback(writeSpaceWhenPending => {
    const spacePassedThrough = spacePassedThroughRef.current;
    spaceDownRef.current = false;
    spacePassedThroughRef.current = false;
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      if (writeSpaceWhenPending && !spacePassedThrough) window.codeBrainApp?.pty.write(paneIdRef.current, " ");
      return;
    }
    if (startingRef.current) return;
    if (!recordingRef.current) return;
    endRecording();
  }, [endRecording]);
  const pressSpace = React.useCallback(spacePassedThrough => {
    if (spaceDownRef.current) return;
    spaceDownRef.current = true;
    spacePassedThroughRef.current = spacePassedThrough;
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      if (spaceDownRef.current) {
        if (spacePassedThroughRef.current) window.codeBrainApp?.pty.write(paneIdRef.current, "");
        void beginRecording();
      }
    }, HOLD_THRESHOLD_MS);
  }, [beginRecording]);
  const handleKeyEvent = React.useCallback(event => {
    const isVoiceShortcut = isSpaceEvent(event) && !event.altKey && !event.metaKey && !event.ctrlKey;
    if (!enabledRef.current || !isVoiceShortcut) {
      return false;
    }
    const targetIsXterm = isXtermEvent(event);
    if (event.type === "keydown") {
      if (captureModeRef.current === "toggle") {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) {
          spaceDownRef.current = true;
          if (recordingRef.current) endRecording();else if (!startingRef.current) void beginRecording();
        }
        return true;
      }
      if (event.repeat) {
        if (spaceDownRef.current || startingRef.current || recordingRef.current) {
          event.preventDefault();
          event.stopPropagation();
          return true;
        }
        return false;
      }
      pressSpace(targetIsXterm);
      if (targetIsXterm) return false;
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    if (event.type === "keyup") {
      if (captureModeRef.current === "toggle") {
        event.preventDefault();
        event.stopPropagation();
        spaceDownRef.current = false;
        return true;
      }
      const shouldConsume = !targetIsXterm || startingRef.current || recordingRef.current;
      if (shouldConsume) {
        event.preventDefault();
        event.stopPropagation();
      }
      releaseSpace(true);
      return shouldConsume;
    }
    return false;
  }, [beginRecording, endRecording, pressSpace, releaseSpace]);
  React.useEffect(() => {
    const onKeyDown = event => {
      if (shouldIgnoreGlobalKeyEvent(event)) return;
      handleKeyEvent(event);
    };
    const onKeyUp = event => {
      if (shouldIgnoreGlobalKeyEvent(event)) return;
      handleKeyEvent(event);
    };
    const onBlur = () => releaseSpace(false);
    const onVisibility = () => {
      if (document.hidden) releaseSpace(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [handleKeyEvent, releaseSpace]);
  React.useEffect(() => {
    if (cancelRequestId === lastCancelRequestIdRef.current) return;
    lastCancelRequestIdRef.current = cancelRequestId;
    cancelVoice();
  }, [cancelRequestId, cancelVoice]);
  React.useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (segmentTimerRef.current) clearTimeout(segmentTimerRef.current);
      stopElapsedTimer();
      recordingRef.current = false;
      stopLevelMeter();
      stopCurrentRecorder();
      stopStream();
    };
  }, [stopCurrentRecorder, stopElapsedTimer, stopLevelMeter, stopStream]);
  return {
    stats,
    handleKeyEvent
  };
}
function pickMimeType() {
  const supported = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return supported.find(type => MediaRecorder.isTypeSupported(type)) ?? "";
}
function isSpaceEvent(event) {
  return event.code === "Space" || event.key === " " || event.key === "Spacebar";
}
function shouldIgnoreGlobalKeyEvent(event) {
  if (!isSpaceEvent(event)) return true;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest(".xterm")) return false;
  return !!target.closest('input, textarea, select, [contenteditable="true"]');
}
function isXtermEvent(event) {
  const target = event.target;
  return target instanceof HTMLElement && !!target.closest(".xterm");
}
function normalizeTranscript(text) {
  return text.replace(/\s+/g, " ").trim();
}
function formatVoiceText(text, mode, lastPrefixedModeRef) {
  if (mode !== "coding") {
    lastPrefixedModeRef.current = mode;
    return text;
  }
  if (lastPrefixedModeRef.current === mode) return text;
  lastPrefixedModeRef.current = mode;
  return `${CODING_VOICE_PREFIX}${text}`;
}
function dedupeTranscript(text, context) {
  const collapsed = collapseRepeatedTail(text);
  return removeContextOverlap(context, collapsed);
}
function collapseRepeatedTail(text) {
  const words = splitWords(text);
  const normalized = words.map(normalizeWordForDedupe);
  const maxLen = Math.floor(words.length / 2);
  for (let len = maxLen; len >= 3; len -= 1) {
    const secondStart = words.length - len;
    const firstStart = secondStart - len;
    if (firstStart < 0) continue;
    if (sameWordRange(normalized, firstStart, secondStart, len)) {
      return words.slice(0, secondStart).join(" ");
    }
  }
  return text;
}
function removeContextOverlap(context, text) {
  const words = splitWords(text);
  if (words.length === 0) return "";
  const normalized = words.map(normalizeWordForDedupe).filter(Boolean);
  if (normalized.length === 0) return "";
  const contextWords = splitWords(context).map(normalizeWordForDedupe).filter(Boolean).slice(-80);
  if (contextWords.length === 0) return text;
  if (normalized.length >= 3 && containsWordSequence(contextWords, normalized)) return "";
  const maxOverlap = Math.min(24, contextWords.length, normalized.length);
  for (let len = maxOverlap; len >= 3; len -= 1) {
    const contextStart = contextWords.length - len;
    let matches = true;
    for (let i = 0; i < len; i += 1) {
      if (contextWords[contextStart + i] !== normalized[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return words.slice(len).join(" ");
  }
  return text;
}
function splitWords(text) {
  return text.split(/\s+/).filter(Boolean);
}
function normalizeWordForDedupe(word) {
  return word.toLowerCase().normalize("NFD").replace(new RegExp("\\p{Diacritic}", "gu"), "").replace(/[^\p{L}\p{N}]/gu, "");
}
function sameWordRange(words, firstStart, secondStart, len) {
  for (let i = 0; i < len; i += 1) {
    if (!words[firstStart + i] || words[firstStart + i] !== words[secondStart + i]) return false;
  }
  return true;
}
function containsWordSequence(haystack, needle) {
  if (needle.length > haystack.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    let matches = true;
    for (let i = 0; i < needle.length; i += 1) {
      if (haystack[start + i] !== needle[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}
function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}
function getPace(wpm, targetWpm, words) {
  if (words < 3 || wpm <= 0) return "idle";
  if (wpm < targetWpm * 0.75) return "slow";
  if (wpm > targetWpm * 1.25) return "fast";
  return "ok";
}
function BrainVoiceAccessMessage(reason) {
  if (reason === "entitlement_missing") return "BrainVoice requer Boost Pro.";
  if (reason === "inactive_subscription") return "BrainVoice requer assinatura ativa Boost Pro.";
  if (reason === "no_session") return "BrainVoice requer login e assinatura Boost Pro.";
  if (reason === "license_unavailable") return "não foi possível validar o plano Boost Pro para BrainVoice.";
  return "BrainVoice indisponível.";
}
function shouldIgnoreTranscript(text) {
  const cleaned = text.toLowerCase().replace(/[^\p{L}\s.]/gu, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return true;
  const noise = ["thank you", "thanks", "uh huh", "uhhuh", "you", "bye", "okay", "ok"];
  if (noise.includes(cleaned)) return true;
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length <= 2 && words.every(word => ["thank", "you", "thanks", "uh", "huh", "ok", "okay"].includes(word))) return true;
  return false;
}
function updateTranscriptContext(previous, text) {
  return `${previous} ${text}`.replace(/\s+/g, " ").trim().slice(-700);
}
async function blobLooksLikeSpeech(blob) {
  try {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return true;
    const buffer = await blob.arrayBuffer();
    const ctx = new AudioContextCtor();
    try {
      const audio = await ctx.decodeAudioData(buffer.slice(0));
      const channel = audio.getChannelData(0);
      if (channel.length === 0) return false;
      let sum = 0;
      let speechSamples = 0;
      const stride = Math.max(1, Math.floor(channel.length / 12e3));
      let samples = 0;
      for (let i = 0; i < channel.length; i += stride) {
        const amp = Math.abs(channel[i]);
        sum += amp * amp;
        if (amp > 0.035) speechSamples += 1;
        samples += 1;
      }
      const rms = Math.sqrt(sum / Math.max(1, samples));
      const ratio = speechSamples / Math.max(1, samples);
      return rms >= MIN_SPEECH_RMS || ratio >= MIN_SPEECH_RATIO;
    } finally {
      await ctx.close().catch(() => {});
    }
  } catch {
    return true;
  }
}
export const spawnedPaneIds = new Set();
export function openWebLink(_event, uri) {
  try {
    const url = new URL(uri);
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  } catch {}
}