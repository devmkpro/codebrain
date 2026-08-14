import { describe, expect, it } from "vitest";
import { getOperationsSnapshot } from "./operations";

function contextFor(workspace: string, overrides: Record<string, unknown> = {}) {
  const actor = {
    pane_id: "pane-codex",
    agent: "codex",
    label: "Codex worker",
    role: "worker",
    mission_id: null,
    status: "running",
    workspace,
    time_created: Date.now() - 1000,
    time_updated: Date.now(),
    last_turn_time: Date.now(),
  };
  const store = {
    actorList: () => ({ ok: true, actors: [actor] }),
    listKanbanTasks: () => ({ ok: true, tasks: [{ id: "task-1", title: "Implement", column_name: "in_progress", mission_id: null }] }),
    listHandoffs: () => ({ ok: true, handoffs: [] }),
    listAgentMessages: () => ({ ok: true, messages: [{ id: "msg-1", from_pane: "pane-codex", to_pane: "pane-orq", content: "avance", type: "update", read: 0, created_at: Date.now(), workspace }] }),
    listMissions: () => ({ ok: true, missions: [] }),
    ...overrides,
  };
  return {
    currentWorkspacePath: workspace,
    memoryStore: store,
    ptyManager: { list: () => [{ paneId: "pane-codex", agent: "codex", cwd: workspace }] },
  } as any;
}

describe("operations read model", () => {
  it("derives a working mission from persisted actor/task activity", () => {
    const workspace = "/repo/saas";
    const snapshot = getOperationsSnapshot(contextFor(workspace), workspace);
    expect(snapshot.ok).toBe(true);
    expect(snapshot.missions).toHaveLength(1);
    expect(snapshot.missions[0].lane).toBe("working");
    expect(snapshot.missions[0].counts.running).toBe(1);
    expect(snapshot.missions[0].counts.messages).toBe(1);
    expect(snapshot.missions[0].source).toBe("derived");
    expect(snapshot.missions[0].latestActivity?.kind).toBe("message");
  });

  it("does not turn shell panes into agent work", () => {
    const workspace = "/repo/saas";
    const ctx = contextFor(workspace, {
      actorList: () => ({ ok: true, actors: [{ pane_id: "shell", agent: "shell", status: "running", workspace }] }),
      listKanbanTasks: () => ({ ok: true, tasks: [] }),
      listAgentMessages: () => ({ ok: true, messages: [] }),
    });
    ctx.ptyManager.list = () => [{ paneId: "shell", agent: "shell", cwd: workspace }];
    const snapshot = getOperationsSnapshot(ctx, workspace);
    expect(snapshot.actors).toHaveLength(0);
    expect(snapshot.missions[0].lane).toBe("idle");
  });

  it("does not keep orphaned running actors active after the PTY disappears", () => {
    const workspace = "/repo/saas";
    const ctx = contextFor(workspace, {
      actorList: () => ({ ok: true, actors: [{ pane_id: "orphan", agent: "codex", status: "running", workspace }] }),
      listKanbanTasks: () => ({ ok: true, tasks: [{ id: "task-2", title: "Continue", column_name: "in_progress", mission_id: null }] }),
      listAgentMessages: () => ({ ok: true, messages: [] }),
    });
    ctx.ptyManager.list = () => [];
    const snapshot = getOperationsSnapshot(ctx, workspace);
    expect(snapshot.actors).toHaveLength(0);
    expect(snapshot.missions[0].lane).toBe("attention");
    expect(snapshot.missions[0].counts.running).toBe(0);
  });
});
