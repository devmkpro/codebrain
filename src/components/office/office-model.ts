/* Escritório: traduz os panes do Codebrain para o escritório do Pixel Agents.
   Lógica pura, sem React, para ser testada isoladamente. */

import { derivePaneActivity } from "../shell/pane-status";
import { cliIdentity, modelShortName, paneDisplayName } from "../panes/pane-identity";

export type OfficeActivity = "active" | "waiting" | "idle";

export interface OfficeAgent {
  paneId: string;
  /** Nome do projeto; vira a sala e o directoryName do personagem. */
  room: string;
  /** CLI · modelo (ou o rótulo do pane), mostrado sob o personagem. */
  name: string;
  activity: OfficeActivity;
}

export interface OfficeRoom {
  label: string;
  agents: number;
}

function basename(dir: string): string {
  const parts = dir.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? dir;
}

function parentName(dir: string): string {
  const parts = dir.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 2] ?? "";
}

/** Panes que viram personagem: terminais vivos de qualquer harness, inclusive shell. */
export function isOfficeAgentPane(pane: any): boolean {
  if (!pane || (pane.kind ?? "terminal") !== "terminal") return false;
  return pane.status !== "exited" && pane.status !== "error" && pane.status !== "hibernated";
}

export function officeActivity(pane: any): OfficeActivity {
  const activity = derivePaneActivity(pane);
  if (activity === "running" || activity === "thinking") return "active";
  if (activity === "waiting") return "waiting";
  return "idle";
}

/**
 * Nome de sala por workspace. Dois workspaces com a mesma pasta final ganham
 * o nome da pasta-mãe na frente, para as salas não se fundirem.
 */
export function roomLabels(workspaces: string[]): Map<string, string> {
  const unique = [...new Set(workspaces)];
  const byName = new Map<string, string[]>();
  for (const ws of unique) {
    const name = basename(ws).toLowerCase();
    byName.set(name, [...(byName.get(name) ?? []), ws]);
  }
  const labels = new Map<string, string>();
  for (const ws of unique) {
    const clash = (byName.get(basename(ws).toLowerCase()) ?? []).length > 1;
    labels.set(ws, clash && parentName(ws) ? `${parentName(ws)}/${basename(ws)}` : basename(ws));
  }
  return labels;
}

export function officeAgentName(pane: any): string {
  const { name, isDefault } = paneDisplayName(pane);
  if (!isDefault) return name;
  const cli = cliIdentity(pane.agent).label;
  const model = modelShortName(pane.model);
  return model ? `${cli} · ${model}` : cli;
}

export function buildOffice(panes: any[]): { rooms: OfficeRoom[]; agents: OfficeAgent[] } {
  const live = panes.filter(isOfficeAgentPane);
  const labels = roomLabels(live.map((pane) => pane.workspacePath ?? pane.cwd ?? ""));
  const agents: OfficeAgent[] = live.map((pane) => ({
    paneId: pane.id,
    room: labels.get(pane.workspacePath ?? pane.cwd ?? "") ?? "workspace",
    name: officeAgentName(pane),
    activity: officeActivity(pane),
  }));
  const counts = new Map<string, number>();
  for (const agent of agents) counts.set(agent.room, (counts.get(agent.room) ?? 0) + 1);
  const rooms = [...counts.entries()]
    .map(([label, count]) => ({ label, agents: count }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return { rooms, agents };
}

export function roomsSignature(rooms: OfficeRoom[]): string {
  return rooms.map((room) => `${room.label}:${Math.max(2, room.agents)}`).join("|");
}
