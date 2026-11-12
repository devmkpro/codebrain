import React from "react";
import { usePanesStore } from "../../stores/panes-store";
import { classifyTerminalOutput } from "../shell/pane-status";

/* ═══════════════════════════════════════════════════════════════════════════
   RUNTIME DE PANE — UM OUVINTE SÓ
   ═══════════════════════════════════════════════════════════════════════════

   Observa o que já passa pela ponte e publica no store o que as superfícies
   mostram: metadado do backend, papel e o sinal vivo de atividade.

   Vive fora do TerminalPane de propósito. A grade só monta os terminais da
   missão ativa, então um ouvinte por componente deixaria o NavRail sem saber
   o que acontece nas outras missões. Aqui só se lê: nada escreve no PTY.
   ═══════════════════════════════════════════════════════════════════════════ */

const TICK_MS = 500;
const ROLE_POLL_MS = 10_000;
/** Sem saída há este tempo, o agente parou. */
const BUSY_WINDOW_MS = 4_000;
/** Saída logo depois de uma tecla é eco ou redesenho do campo de digitação. */
const ECHO_WINDOW_MS = 400;
const TAIL_LIMIT = 4_000;

interface Tracked {
  lastOutput: number;
  lastInput: number;
  tail: string;
}

const tracked = new Map<string, Tracked>();

function entry(paneId: string): Tracked {
  let item = tracked.get(paneId);
  if (!item) {
    item = { lastOutput: 0, lastInput: 0, tail: "" };
    tracked.set(paneId, item);
  }
  return item;
}

/** O usuário digitou: qualquer pergunta na tela está sendo respondida. */
export function notePaneInput(paneId: string) {
  const item = entry(paneId);
  item.lastInput = Date.now();
  item.tail = "";
}

function panesState() {
  return usePanesStore.getState() as any;
}

function tickActivity() {
  const { panes, setPaneLive } = panesState();
  const now = Date.now();
  for (const pane of panes) {
    if (pane.kind === "browser" || pane.kind === "office") continue;
    const item = tracked.get(pane.id);
    if (!item || pane.status !== "running") {
      if (pane.live) setPaneLive(pane.id, null);
      continue;
    }
    const busy = item.lastOutput > 0 && now - item.lastOutput < BUSY_WINDOW_MS;
    setPaneLive(pane.id, classifyTerminalOutput(pane.agent, item.tail, busy));
  }
  for (const paneId of tracked.keys()) {
    if (!panes.some((pane: any) => pane.id === paneId)) tracked.delete(paneId);
  }
}

async function pollRoles() {
  const api = (window as any).codeBrainApp;
  const { panes, updatePane } = panesState();
  await Promise.all(panes.map(async (pane: any) => {
    if (pane.kind === "browser" || pane.kind === "office" || pane.agent === "shell") return;
    try {
      const result = await api?.pty?.getRole?.(pane.id);
      if (!result?.ok || !result.role) return;
      if (result.role !== pane.role || result.missionId !== pane.registryMissionId) {
        updatePane(pane.id, { role: result.role, registryMissionId: result.missionId ?? undefined });
      }
    } catch {
      // Papel é decorativo; falhar aqui não pode afetar o pane.
    }
  }));
}

function startPaneRuntime(): () => void {
  const api = (window as any).codeBrainApp;
  const applyMeta = (info: any) => {
    if (info?.paneId) panesState().applyPaneMeta(info.paneId, info);
  };

  const stopOutput = api?.pty?.onOutput?.((paneId: string, data: string, echo?: boolean) => {
    if (echo) return;
    const item = entry(paneId);
    const now = Date.now();
    if (now - item.lastInput > ECHO_WINDOW_MS) item.lastOutput = now;
    item.tail = (item.tail + data).slice(-TAIL_LIMIT);
  });
  const stopAdded = api?.pty?.onPaneAdded?.(applyMeta);
  const stopMeta = api?.pane?.onMeta?.(applyMeta);

  void Promise.resolve(api?.pty?.list?.()).then((list: any) => {
    const panes = Array.isArray(list) ? list : list?.panes;
    if (Array.isArray(panes)) panes.forEach(applyMeta);
  }).catch(() => {});

  const activityTimer = window.setInterval(tickActivity, TICK_MS);
  const roleTimer = window.setInterval(() => void pollRoles(), ROLE_POLL_MS);
  void pollRoles();

  return () => {
    window.clearInterval(activityTimer);
    window.clearInterval(roleTimer);
    stopOutput?.();
    stopAdded?.();
    stopMeta?.();
  };
}

/** Monte uma única vez, no casco. */
export function usePaneRuntime() {
  React.useEffect(() => startPaneRuntime(), []);
}
