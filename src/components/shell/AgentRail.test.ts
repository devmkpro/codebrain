import { describe, expect, it } from "vitest";

import { panesForWorkspace } from "./AgentRail";

describe("panesForWorkspace", () => {
  const panes = [
    { id: "saas-root", workspacePath: "C:\\Users\\Maike\\Documents\\saas" },
    { id: "saas-subfolder", cwd: "C:\\Users\\Maike\\Documents\\saas\\apps\\web" },
    { id: "other-workspace", workspacePath: "C:\\Users\\Maike\\Documents\\quotations-bot" },
  ];

  it("shows only panes that belong to the selected workspace", () => {
    expect(panesForWorkspace(panes, "C:/Users/Maike/Documents/saas").map((pane) => pane.id))
      .toEqual(["saas-root", "saas-subfolder"]);
  });

  it("shows no panes while no workspace is selected", () => {
    expect(panesForWorkspace(panes)).toEqual([]);
  });
});
