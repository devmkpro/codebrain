// @vitest-environment node
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { archiveOperation, getOperationsSnapshot } from "./operations";
import { removeWorkspace } from "./workspace-list";

let temporaryDirectory: string;
let workspace: string;
beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "codebrain-operations-"));
  workspace = path.join(temporaryDirectory, "project");
  fs.mkdirSync(workspace);
});
afterEach(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

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

  it("keeps a registered existing workspace visible even when not selected", () => {
    const ctx = contextFor(workspace);
    ctx.currentWorkspacePath = path.join(temporaryDirectory, "other");
    ctx.WORKSPACES_FILE = path.join(temporaryDirectory, "workspaces.json");
    fs.writeFileSync(ctx.WORKSPACES_FILE, JSON.stringify([workspace]));
    expect(getOperationsSnapshot(ctx, workspace).missions).toHaveLength(1);
  });

  it("keeps the active existing workspace visible before it is in recents", () => {
    const ctx = contextFor(workspace);
    ctx.WORKSPACES_FILE = path.join(temporaryDirectory, "workspaces.json");
    fs.writeFileSync(ctx.WORKSPACES_FILE, "[]");
    expect(getOperationsSnapshot(ctx, workspace).missions).toHaveLength(1);
  });

  it("hides an unlinked workspace without deleting its historical records", () => {
    const historicalTasks = [{ id: "historical-task", column_name: "done", mission_id: null }];
    const listTasks = vi.fn(() => ({ tasks: historicalTasks }));
    const ctx = contextFor(workspace, { listKanbanTasks: listTasks });
    ctx.WORKSPACES_FILE = path.join(temporaryDirectory, "workspaces.json");
    fs.writeFileSync(ctx.WORKSPACES_FILE, JSON.stringify([workspace]));
    expect(getOperationsSnapshot(ctx, workspace).missions).toHaveLength(1);
    removeWorkspace(ctx, workspace);
    listTasks.mockClear();
    const snapshot = getOperationsSnapshot(ctx, workspace);
    expect(snapshot.missions).toEqual([]);
    expect(snapshot.tasks).toEqual([]);
    expect(listTasks).not.toHaveBeenCalled();
    expect(historicalTasks).toEqual([{ id: "historical-task", column_name: "done", mission_id: null }]);
    expect(fs.existsSync(workspace)).toBe(true);
  });

  it("ignores a stale selected tab when its directory was deleted externally", () => {
    const ctx = contextFor(workspace);
    fs.rmdirSync(workspace);
    expect(getOperationsSnapshot(ctx, workspace).missions).toEqual([]);
    expect(getOperationsSnapshot(ctx, workspace).totals.actors).toBe(0);
  });

  it("does not use an existing unregistered directory's history as discovery", () => {
    const ctx = contextFor(workspace);
    ctx.currentWorkspacePath = path.join(temporaryDirectory, "different");
    expect(getOperationsSnapshot(ctx, workspace).missions).toEqual([]);
  });
});

describe("individual operation archives", () => {
  function archiveContext() {
    const missions = [{ id: "m1", title: "One", workspace }, { id: "m2", title: "Two", workspace }];
    const actors = ["m1", "m2"].map((mission_id, index) => ({ pane_id: `p${index + 1}`, mission_id, agent: "codex", status: "running", workspace }));
    const tasks = missions.map(({ id }) => ({ id: `task-${id}`, mission_id: id, column_name: "in_progress" }));
    const ctx = contextFor(workspace, {
      listMissions: () => ({ missions }), actorList: () => ({ actors }),
      listKanbanTasks: () => ({ tasks }), listAgentMessages: () => ({ messages: [] }),
    });
    ctx.DATA_DIR = path.join(temporaryDirectory, "profile");
    ctx.ptyManager = { list: () => actors.map((actor) => ({ paneId: actor.pane_id, agent: "codex", cwd: workspace })), kill: vi.fn() };
    return { ctx, missions, actors, tasks };
  }

  it("requires confirmation for the selected operation's live panes", () => {
    const { ctx } = archiveContext();
    expect(archiveOperation(ctx, { workspace, missionId: "m1" })).toMatchObject({ ok: false, requiresConfirmation: true, activePaneIds: ["p1"] });
    expect(getOperationsSnapshot(ctx, workspace).missions.map((mission) => mission.id)).toEqual(["m1", "m2"]);
  });

  it("persists only the selected archive across refresh and a new main context, without deleting history or killing panes", () => {
    const { ctx, missions, actors, tasks } = archiveContext();
    fs.writeFileSync(path.join(workspace, "keep.txt"), "history stays");
    expect(archiveOperation(ctx, { workspace, missionId: "m1", confirmedActive: true }).ok).toBe(true);
    expect(getOperationsSnapshot(ctx, workspace).missions.map((mission) => mission.id)).toEqual(["m2"]);
    const restarted = archiveContext().ctx;
    expect(getOperationsSnapshot(restarted, workspace).missions.map((mission) => mission.id)).toEqual(["m2"]);
    expect(getOperationsSnapshot(restarted, workspace).tasks.map((task) => task.id)).toEqual(["task-m2"]);
    expect(missions).toHaveLength(2);
    expect(actors).toHaveLength(2);
    expect(tasks).toHaveLength(2);
    expect(ctx.ptyManager.kill).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(workspace, "keep.txt"), "utf8")).toBe("history stays");
  });

  it("does not revive an archived derived workspace card on refresh or restart", () => {
    const ctx = contextFor(workspace);
    ctx.DATA_DIR = path.join(temporaryDirectory, "profile");
    const missionId = `workspace:${workspace}`;
    expect(archiveOperation(ctx, { workspace, missionId, confirmedActive: true }).ok).toBe(true);
    expect(getOperationsSnapshot({ ...ctx }, workspace).missions).toEqual([]);
    expect(getOperationsSnapshot({ ...ctx }, workspace).actors).toEqual([]);
  });

  it("does not create a synthetic replacement when the sole backend operation is archived", () => {
    const { ctx } = archiveContext();
    ctx.memoryStore.listMissions = () => ({ missions: [{ id: "m1", title: "One", workspace }] });
    ctx.memoryStore.actorList = () => ({ actors: [{ pane_id: "p1", mission_id: "m1", agent: "codex", status: "running" }] });
    ctx.memoryStore.listKanbanTasks = () => ({ tasks: [] });
    ctx.ptyManager.list = () => [{ paneId: "p1", cwd: workspace, agent: "codex" }];
    archiveOperation(ctx, { workspace, missionId: "m1", confirmedActive: true });
    expect(getOperationsSnapshot(ctx, workspace).missions).toEqual([]);
  });

  it("keeps unassigned work separate from a sole backend mission", () => {
    const ctx = contextFor(workspace, { listMissions: () => ({ missions: [{ id: "m1", title: "One", workspace }] }) });
    ctx.DATA_DIR = path.join(temporaryDirectory, "profile");
    archiveOperation(ctx, { workspace, missionId: "m1" });
    expect(getOperationsSnapshot(ctx, workspace).missions.map((mission) => mission.id)).toEqual([`workspace:${workspace}`]);
  });

  it("allows genuinely new unassigned work without reviving archived panes and tasks", () => {
    const ctx = contextFor(workspace);
    ctx.DATA_DIR = path.join(temporaryDirectory, "profile");
    archiveOperation(ctx, { workspace, missionId: `workspace:${workspace}`, confirmedActive: true });
    ctx.ptyManager.list = () => [{ paneId: "pane-codex", agent: "codex", cwd: workspace }, { paneId: "new-pane", agent: "codex", cwd: workspace }];
    const refreshed = getOperationsSnapshot(ctx, workspace);
    expect(refreshed.missions).toHaveLength(1);
    expect(refreshed.missions[0].actorIds).toEqual(["new-pane"]);
    expect(refreshed.tasks).toEqual([]);
    expect(refreshed.messages).toEqual([]);
    expect(archiveOperation(ctx, { workspace, missionId: `workspace:${workspace}`, confirmedActive: true }).ok).toBe(true);
    expect(getOperationsSnapshot(ctx, workspace).missions).toEqual([]);
  });

  it("does not archive an identically named mission in another workspace", () => {
    const { ctx } = archiveContext();
    archiveOperation(ctx, { workspace, missionId: "m1", confirmedActive: true });
    const other = path.join(temporaryDirectory, "other");
    fs.mkdirSync(other);
    const otherCtx = contextFor(other, { listMissions: () => ({ missions: [{ id: "m1", title: "Other", workspace: other }] }), listKanbanTasks: () => ({ tasks: [] }), listAgentMessages: () => ({ messages: [] }), actorList: () => ({ actors: [] }) });
    otherCtx.DATA_DIR = ctx.DATA_DIR;
    otherCtx.ptyManager.list = () => [];
    expect(getOperationsSnapshot(otherCtx, other).missions.map((mission) => mission.title)).toEqual(["Other"]);
  });

  it("keeps archived associations hidden even after they fall outside the backend mission page", () => {
    const { ctx } = archiveContext();
    archiveOperation(ctx, { workspace, missionId: "m1", confirmedActive: true });
    ctx.memoryStore.listMissions = () => ({ missions: [{ id: "m2", title: "Two", workspace }] });
    expect(getOperationsSnapshot(ctx, workspace).missions.map((mission) => mission.id)).toEqual(["m2"]);
  });

  it("rejects an unknown operation instead of writing a broad workspace archive", () => {
    const { ctx } = archiveContext();
    expect(archiveOperation(ctx, { workspace, missionId: "not-a-mission", confirmedActive: true }).ok).toBe(false);
    expect(fs.existsSync(path.join(ctx.DATA_DIR, "operations-archives.json"))).toBe(false);
  });

  it("does not revive archived handoffs and messages as synthetic work after all PTYs exit", () => {
    const { ctx } = archiveContext();
    ctx.memoryStore.listHandoffs = () => ({ handoffs: [{ id: "h1", pane_id: "p1", status: "done", submitted_at: Date.now() }] });
    ctx.memoryStore.listAgentMessages = () => ({ messages: [{ id: "msg1", from_pane: "p1", to_pane: "unknown", content: "done", created_at: Date.now() }] });
    archiveOperation(ctx, { workspace, missionId: "m1", confirmedActive: true });
    ctx.ptyManager.list = () => [];
    expect(getOperationsSnapshot(ctx, workspace).missions.map((mission) => mission.id)).toEqual(["m2"]);
    expect(getOperationsSnapshot(ctx, workspace).handoffs).toEqual([]);
    expect(getOperationsSnapshot(ctx, workspace).messages).toEqual([]);
  });
});
