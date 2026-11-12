import { describe, expect, it } from "vitest";

import { buildOffice, isOfficeAgentPane, officeActivity, roomLabels, roomsSignature } from "./office-model";

const pane = (over: Record<string, unknown>) => ({ id: "p", kind: "terminal", agent: "kiro", status: "running", cwd: "D:\\Projetos\\app", ...over });

describe("office-model", () => {
  it("keeps terminals of any harness and drops browsers, offices and dead panes", () => {
    expect(isOfficeAgentPane(pane({ agent: "codex" }))).toBe(true);
    expect(isOfficeAgentPane(pane({ agent: "shell" }))).toBe(true);
    expect(isOfficeAgentPane(pane({ kind: "browser" }))).toBe(false);
    expect(isOfficeAgentPane(pane({ kind: "office" }))).toBe(false);
    expect(isOfficeAgentPane(pane({ status: "exited" }))).toBe(false);
  });

  it("maps pane activity to the office states", () => {
    expect(officeActivity(pane({ live: "running" }))).toBe("active");
    expect(officeActivity(pane({ live: "thinking" }))).toBe("active");
    expect(officeActivity(pane({ live: "waiting" }))).toBe("waiting");
    expect(officeActivity(pane({ status: "idle" }))).toBe("idle");
  });

  it("names rooms after the project folder and disambiguates clashes", () => {
    const labels = roomLabels(["D:\\Projetos\\api", "C:/work/client/app", "C:/work/admin/app"]);
    expect(labels.get("D:\\Projetos\\api")).toBe("api");
    expect(labels.get("C:/work/client/app")).toBe("client/app");
    expect(labels.get("C:/work/admin/app")).toBe("admin/app");
  });

  it("builds one room per workspace sized by its agents", () => {
    const office = buildOffice([
      pane({ id: "a", workspacePath: "D:\\Projetos\\lactom" }),
      pane({ id: "b", agent: "codex", model: "gpt-6.1-sol", workspacePath: "D:\\Projetos\\lactom" }),
      pane({ id: "c", workspacePath: "C:\\Users\\dev\\damas" }),
      pane({ id: "d", kind: "browser", workspacePath: "C:\\Users\\dev\\damas" }),
    ]);
    expect(office.rooms).toEqual([{ label: "damas", agents: 1 }, { label: "lactom", agents: 2 }]);
    expect(office.agents.map((agent) => agent.room)).toEqual(["lactom", "lactom", "damas"]);
    expect(office.agents[1].name).toContain("gpt-6.1-sol");
  });

  it("only changes the room signature when the desks change", () => {
    expect(roomsSignature([{ label: "a", agents: 1 }])).toBe(roomsSignature([{ label: "a", agents: 2 }]));
    expect(roomsSignature([{ label: "a", agents: 2 }])).not.toBe(roomsSignature([{ label: "a", agents: 3 }]));
  });
});
