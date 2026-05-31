import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';

export type MissionStatus = 'active' | 'running' | 'blocked' | 'ready_to_integrate' | 'archived';

export interface Mission {
  id: string;
  title: string;
  objective?: string;
  status: MissionStatus;
  branch?: string;
  worktreePath?: string;
  createdAt: number;
  updatedAt: number;
}

interface MissionsState {
  missionsByWorkspace: Record<string, Mission[]>;
  activeMissionByWorkspace: Record<string, string>;
  ensureMissionForWorkspace: (workspacePath: string) => string;
  getWorkspaceMissions: (workspacePath: string) => Mission[];
  getActiveMissionId: (workspacePath: string) => string | null;
  setActiveMission: (workspacePath: string, missionId: string) => void;
  createMission: (workspacePath: string, mission: Partial<Mission>) => string;
  updateMission: (workspacePath: string, missionId: string, patch: Partial<Mission>) => void;
  archiveMission: (workspacePath: string, missionId: string) => void;
}

const EMPTY_MISSIONS: Mission[] = [];

function nextMissionTitle(existing: Mission[]): string {
  const nums = existing
    .map(m => {
      const match = /^Miss[aã]o\s*(\d+)$/i.exec(m.title);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((n): n is number => n !== null);
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `Missão ${max + 1}`;
}

function activeMissionOrFallback(
  state: Pick<MissionsState, 'missionsByWorkspace' | 'activeMissionByWorkspace'>,
  workspacePath: string,
): string | null {
  const missions = (state.missionsByWorkspace[workspacePath] ?? []).filter(
    m => m.status !== 'archived',
  );
  if (!missions || missions.length === 0) return null;
  const active = state.activeMissionByWorkspace[workspacePath];
  const activeExists = active ? missions.some(m => m.id === active) : false;
  return activeExists ? active : missions[0]?.id ?? null;
}

export const useMissionsStore = create<MissionsState>()(
  persist(
    (set, get) => ({
      missionsByWorkspace: {},
      activeMissionByWorkspace: {},

      ensureMissionForWorkspace: (workspacePath) => {
        const state = get();
        const existing = (state.missionsByWorkspace[workspacePath] ?? []).filter(
          m => m.status !== 'archived',
        );
        if (existing.length > 0) {
          const active = activeMissionOrFallback(state, workspacePath);
          if (active) {
            set({
              activeMissionByWorkspace: {
                ...state.activeMissionByWorkspace,
                [workspacePath]: active,
              },
            });
            return active;
          }
        }
        const now = Date.now();
        const mission: Mission = {
          id: nanoid(),
          title: nextMissionTitle(existing),
          status: 'active',
          createdAt: now,
          updatedAt: now,
        };
        set(s => ({
          missionsByWorkspace: {
            ...s.missionsByWorkspace,
            [workspacePath]: [mission],
          },
          activeMissionByWorkspace: {
            ...s.activeMissionByWorkspace,
            [workspacePath]: mission.id,
          },
        }));
        return mission.id;
      },

      getWorkspaceMissions: (workspacePath) =>
        get().missionsByWorkspace[workspacePath] ?? EMPTY_MISSIONS,

      getActiveMissionId: (workspacePath) => {
        const state = get();
        return activeMissionOrFallback(state, workspacePath);
      },

      setActiveMission: (workspacePath, missionId) => {
        const state = get();
        const missions = (state.missionsByWorkspace[workspacePath] ?? []).filter(
          m => m.status !== 'archived',
        );
        if (!missions.some(m => m.id === missionId)) return;
        set({
          activeMissionByWorkspace: {
            ...state.activeMissionByWorkspace,
            [workspacePath]: missionId,
          },
        });
      },

      createMission: (workspacePath, mission) => {
        const state = get();
        const existing = state.missionsByWorkspace[workspacePath] ?? [];
        const now = Date.now();
        const next: Mission = {
          id: nanoid(),
          title: mission.title?.trim() || nextMissionTitle(existing),
          objective: mission.objective?.trim(),
          status: mission.status ?? 'active',
          branch: mission.branch?.trim(),
          worktreePath: mission.worktreePath?.trim(),
          createdAt: now,
          updatedAt: now,
        };
        set(s => ({
          missionsByWorkspace: {
            ...s.missionsByWorkspace,
            [workspacePath]: [...(s.missionsByWorkspace[workspacePath] ?? []), next],
          },
          activeMissionByWorkspace: {
            ...s.activeMissionByWorkspace,
            [workspacePath]: next.id,
          },
        }));
        return next.id;
      },

      updateMission: (workspacePath, missionId, patch) => {
        set(s => {
          const missions = s.missionsByWorkspace[workspacePath];
          if (!missions) return s;
          const nextList = missions.map(item =>
            item.id === missionId ? { ...item, ...patch, updatedAt: Date.now() } : item,
          );
          return { missionsByWorkspace: { ...s.missionsByWorkspace, [workspacePath]: nextList } };
        });
      },

      archiveMission: (workspacePath, missionId) => {
        set(s => {
          const missions = s.missionsByWorkspace[workspacePath];
          if (!missions) return s;
          const now = Date.now();
          const nextList = missions.map(m =>
            m.id === missionId ? { ...m, status: 'archived' as MissionStatus, updatedAt: now } : m,
          );
          const remaining = nextList.filter(m => m.status !== 'archived');
          const nextActive =
            s.activeMissionByWorkspace[workspacePath] === missionId
              ? remaining[0]?.id
              : s.activeMissionByWorkspace[workspacePath];
          const activeMissionByWorkspace = { ...s.activeMissionByWorkspace };
          if (nextActive) activeMissionByWorkspace[workspacePath] = nextActive;
          else delete activeMissionByWorkspace[workspacePath];
          return {
            missionsByWorkspace: { ...s.missionsByWorkspace, [workspacePath]: nextList },
            activeMissionByWorkspace,
          };
        });
        if (!get().getActiveMissionId(workspacePath)) {
          get().ensureMissionForWorkspace(workspacePath);
        }
      },
    }),
    { name: 'codebrain-missions' },
  ),
);

export const MISSION_STATUS_DOT_CLASS: Record<MissionStatus, string> = {
  active: 'bg-green-400',
  running: 'bg-blue-400',
  blocked: 'bg-amber-400',
  ready_to_integrate: 'bg-emerald-400',
  archived: 'bg-gray-600',
};

export const MISSION_STATUS_TITLE: Record<MissionStatus, string> = {
  active: 'Ativa',
  running: 'Rodando',
  blocked: 'Bloqueada',
  ready_to_integrate: 'Pronta para integrar',
  archived: 'Arquivada',
};

export function sortMissionsByTitle(lhs: Mission, rhs: Mission): number {
  return lhs.title.localeCompare(rhs.title, 'pt-BR', { numeric: true, sensitivity: 'base' });
}

export function compactMissionTitle(mission: Mission): string {
  const title = mission.title.trim() || 'Missão';
  const defaultMatch = /^miss[aã]o(?:\s+(\d+))?$/i.exec(title);
  if (defaultMatch) return `M${defaultMatch[1] ?? '1'}`;
  return title.length > 14 ? `${title.slice(0, 13)}…` : title;
}
