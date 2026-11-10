// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createMemoryStore } from "../../memory/store.js";
import { createKanbanHandlers } from "./kanban-handlers.js";

let store, dir, api, mission, oldMission, otherMission;
const WS = "C:/Users/QA/Project";
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-kanban-workspace-"));
  store = createMemoryStore(path.join(dir, "fixture.db"));
  mission = store.createMission({ title: "Atual", workspace: WS }).id;
  oldMission = store.createMission({ title: "Antiga", workspace: WS }).id;
  otherMission = store.createMission({ title: "Outro projeto", workspace: "C:/Other" }).id;
  store.actorRegister({ paneId: "qa", workspace: WS, missionId: mission, role: "worker" });
  api = createKanbanHandlers({ memoryStore: store, getCurrentWorkspacePath: () => "C:/Other" });
});
afterEach(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("kanban: paths Windows e escopo efetivo", () => {
  it.each(["C:\\Users\\QA\\Project", "c:/users/qa/project", "c:\\USERS\\qa\\PROJECT\\"])(
    "SQLite filtra variante Windows %s sem perder task",
    (workspace) => {
      const created = store.createKanbanTask({
        title: "Atual",
        workspace,
        assigned_to: "qa",
        mission_id: mission,
      });
      store.createKanbanTask({ title: "Vizinha", workspace: WS + "-other", mission_id: mission });
      expect(
        store.listKanbanTasks({ workspace: WS, mission_id: mission }).tasks.map((task) => task.id)
      ).toEqual([created.id]);
      expect(
        store.listKanbanTasks({ workspace, mission_id: mission }).tasks.map((task) => task.id)
      ).toEqual([created.id]);
    }
  );

  it("create explícito backslash -> list pelo caller/assigned_to encontra task", async () => {
    const created = await api.taskCreate({
      title: "QA real",
      workspace: "C:\\Users\\QA\\Project",
      assigned_to: "qa",
      mission_id: mission,
    });
    expect(created.ok).toBe(true);
    expect((await api.taskList({}, { callerPaneId: "qa" })).tasks.map((task) => task.id)).toEqual([
      created.id,
    ]);
    expect((await api.taskList({ assigned_to: "qa" })).tasks.map((task) => task.id)).toEqual([
      created.id,
    ]);
  });

  it("create sem workspace herda workspace e missão do assigned_to, não o projeto ativo da UI", async () => {
    const created = await api.taskCreate({ title: "Nova", assigned_to: "qa" });
    const row = store
      .listKanbanTasks({ assigned_to: "qa" })
      .tasks.find((task) => task.id === created.id);
    expect(row).toMatchObject({ workspace: WS, mission_id: mission });
    expect((await api.taskList({ assigned_to: "qa" })).count).toBe(1);
  });

  it("workspace explícito equivalente herda a missão do pane sem depender da igualdade literal de missões", async () => {
    const created = await api.taskCreate({
      title: "Variante explícita",
      assigned_to: "qa",
      workspace: "c:\\users\\qa\\project",
    });
    expect(
      store.listKanbanTasks({ workspace: WS }).tasks.find((task) => task.id === created.id)
    ).toMatchObject({ workspace: "c:\\users\\qa\\project", mission_id: mission });
    expect((await api.taskList({}, { callerPaneId: "qa" })).tasks[0].id).toBe(created.id);
  });

  it("default conhecido fica na missão do caller; workspace/missão explícitos continuam cross-scope", async () => {
    const current = store.createKanbanTask({
      title: "Atual",
      workspace: WS,
      assigned_to: "qa",
      mission_id: mission,
    });
    const old = store.createKanbanTask({
      title: "Meses atrás",
      workspace: WS,
      assigned_to: "qa",
      mission_id: oldMission,
    });
    const other = store.createKanbanTask({
      title: "Outro",
      workspace: "C:/Other",
      mission_id: otherMission,
    });
    expect((await api.taskList({}, { callerPaneId: "qa" })).tasks.map((task) => task.id)).toEqual([
      current.id,
    ]);
    expect((await api.taskList({ assigned_to: "qa" })).tasks.map((task) => task.id)).toEqual([
      current.id,
    ]);
    expect(
      new Set(
        (
          await api.taskList({ workspace: "c:\\users\\qa\\project" }, { callerPaneId: "qa" })
        ).tasks.map((task) => task.id)
      )
    ).toEqual(new Set([current.id, old.id]));
    expect(
      (await api.taskList({ mission_id: otherMission }, { callerPaneId: "qa" })).tasks.map(
        (task) => task.id
      )
    ).toEqual([other.id]);
  });

  it("create com missão explícita e workspace omitido persiste o workspace da missão", async () => {
    const created = await api.taskCreate({
      title: "Outra missão",
      assigned_to: "qa",
      mission_id: otherMission,
    });
    expect(
      store.listKanbanTasks({ assigned_to: "qa" }).tasks.find((task) => task.id === created.id)
    ).toMatchObject({ workspace: "C:/Other", mission_id: otherMission });
    expect((await api.taskList({ mission_id: otherMission })).tasks[0].id).toBe(created.id);
  });

  it("workspace e missão explícitos não são substituídos pelo assigned_to", async () => {
    const created = await api.taskCreate({
      title: "Explícita",
      assigned_to: "qa",
      workspace: "C:\\Other",
      mission_id: otherMission,
    });
    expect(
      store.listKanbanTasks({ assigned_to: "qa" }).tasks.find((task) => task.id === created.id)
    ).toMatchObject({ workspace: "C:\\Other", mission_id: otherMission });
  });

  it("normaliza UNC mas mantém case e backslash literais de paths Linux", () => {
    const unc = store.createKanbanTask({
      title: "UNC",
      workspace: "\\\\SERVER\\Share\\Project",
      mission_id: mission,
    });
    expect(
      store.listKanbanTasks({ workspace: "//server/share/project" }).tasks.map((task) => task.id)
    ).toEqual([unc.id]);
    const linux = store.createKanbanTask({
      title: "Linux",
      workspace: "/srv/Project",
      mission_id: mission,
    });
    const literal = store.createKanbanTask({
      title: "Backslash literal",
      workspace: "/srv/Project\\data",
      mission_id: mission,
    });
    expect(store.listKanbanTasks({ workspace: "/srv/project" }).count).toBe(0);
    expect(
      store.listKanbanTasks({ workspace: "/srv/Project" }).tasks.map((task) => task.id)
    ).toEqual([linux.id]);
    expect(store.listKanbanTasks({ workspace: "/srv/Project/data" }).count).toBe(0);
    expect(
      store.listKanbanTasks({ workspace: "/srv/Project\\data" }).tasks.map((task) => task.id)
    ).toEqual([literal.id]);
  });
});
