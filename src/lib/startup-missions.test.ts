import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileStartupMissions } from './startup-missions';
import { useMissionsStore } from '../stores/missions-store';
import { usePanesStore } from '../stores/panes-store';

const ws = 'D:/project';
beforeEach(() => {
  useMissionsStore.setState({ missionsByWorkspace: {}, activeMissionByWorkspace: {} });
  usePanesStore.setState({ panes: [], layouts: {}, activePaneId: null });
});

describe('missões na inicialização', () => {
  it('remove missões vazias de todos os workspaces e persiste a seleção válida', async () => {
    const store = useMissionsStore.getState();
    const live = store.createMission(ws, { title: 'Com agente' });
    store.createMission(ws, { title: 'Vazia' });
    store.createMission('D:/other', { title: 'Outra vazia' });
    await reconcileStartupMissions([{ paneId: 'p', agent: 'kiro', cwd: ws, missionId: live }], async () => ({ ok: false, error: 'no snapshot found' }));
    expect(store.getWorkspaceMissions(ws).map(m => m.id)).toEqual([live]);
    expect(store.getActiveMissionId(ws)).toBe(live);
    expect(store.getWorkspaceMissions('D:/other')).toEqual([]);
    await useMissionsStore.persist.rehydrate();
    expect(store.getWorkspaceMissions(ws).map(m => m.id)).toEqual([live]);
  });

  it('preserva histórico arquivado, sessões salvas e terminais SSH vivos', async () => {
    const store = useMissionsStore.getState();
    const archived = store.createMission(ws, { status: 'archived' });
    const resumed = store.createMission(ws, { operationalMissionId: 'mission_backend' });
    const ssh = store.createMission(ws, {});
    store.createMission(ws, {});
    await reconcileStartupMissions([{ paneId: 'ssh', agent: 'shell', cwd: ws, missionId: ssh }], async () => ({ ok: true, snapshot: { panes: [{ id: 'old', agent: 'claude', missionId: 'mission_backend' }] } }));
    expect(store.getWorkspaceMissions(ws).map(m => m.id)).toEqual([archived, resumed, ssh]);
  });

  it('não remove missões se a leitura de snapshot falhar', async () => {
    const store = useMissionsStore.getState();
    const id = store.createMission(ws, {});
    await reconcileStartupMissions([], async () => { throw new Error('IPC'); });
    await reconcileStartupMissions([], async () => ({ ok: false }));
    expect(store.getWorkspaceMissions(ws).map(m => m.id)).toEqual([id]);
  });

  it('preserva missão criada e pane recebido enquanto aguarda o snapshot', async () => {
    const store = useMissionsStore.getState();
    const old = store.createMission(ws, {});
    let created = '';
    await reconcileStartupMissions([], async () => {
      created = store.createMission(ws, {});
      (usePanesStore.getState() as any).addPane({ id: 'arrived', cwd: ws, missionId: old, agent: 'kiro' });
      return { ok: true, snapshot: null };
    });
    expect(store.getWorkspaceMissions(ws).map(m => m.id)).toEqual([old, created]);
  });
});
