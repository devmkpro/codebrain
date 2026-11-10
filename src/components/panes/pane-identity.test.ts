import { describe, expect, it } from "vitest";

import { cliIdentity, deliveryBadge, groupPanesForRail, effortLabel, modelShortName, paneDisplayName, pathBasename, roleLabel } from "./pane-identity";

describe("paneDisplayName", () => {
  it("prefers the objective", () => {
    expect(paneDisplayName({ agent: "claude", title: "claude", label: "Corrigir login no Safari" })).toEqual({
      name: "Corrigir login no Safari",
      isDefault: false,
    });
  });

  it("falls back to the CLI when the title is only the agent name", () => {
    expect(paneDisplayName({ agent: "codex", title: "codex", label: "   " })).toEqual({ name: "codex", isDefault: true });
  });

  it("keeps a title someone changed", () => {
    expect(paneDisplayName({ agent: "shell", title: "browser" }).name).toBe("browser");
  });
});

describe("cliIdentity", () => {
  it("knows every supported CLI and colors them with tokens", () => {
    for (const agent of ["claude", "codex", "gemini", "kimi", "cursor", "copilot", "openclaude", "shell"]) {
      expect(cliIdentity(agent).label).toBe(agent);
      expect(cliIdentity(agent).color).toMatch(/^var\(--cb-/);
    }
  });

  it("shows unknown agents by name", () => {
    expect(cliIdentity("aider").label).toBe("aider");
  });
});

describe("metadata formatting", () => {
  it("shortens model names", () => {
    expect(modelShortName("claude-opus-4-8")).toBe("opus-4-8");
    expect(modelShortName("anthropic/claude-3.5-sonnet")).toBe("3.5-sonnet");
    expect(modelShortName(undefined)).toBe(null);
  });

  it("takes basenames from both path styles", () => {
    expect(pathBasename("D:\\Projetos\\codebrain\\")).toBe("codebrain");
    expect(pathBasename("/home/me/app")).toBe("app");
    expect(pathBasename(undefined)).toBe("");
  });

  it("translates effort and passes unknown values through", () => {
    expect(effortLabel("high")).toBe("alto");
    expect(effortLabel("ultra")).toBe("ultra");
    expect(effortLabel(undefined)).toBe(null);
  });

  it("shows a role only when there is a real one", () => {
    expect(roleLabel({ role: "orchestrator" })).toBe("piloto");
    expect(roleLabel({ parentPaneId: "abc" })).toBe("ajudante");
    expect(roleLabel({ role: "worker" })).toBe(null);
  });
});

describe("deliveryBadge", () => {
  it("is absent before any handoff", () => {
    expect(deliveryBadge({})).toBe(null);
  });

  it("summarizes evidence without the backend prefix", () => {
    expect(deliveryBadge({ handoffStatus: "done", evidence: "evidência: 3 checks, 2 comandos" })).toEqual({
      tone: "ok",
      text: "3 checks, 2 comandos",
    });
  });

  it("warns when a handoff has no evidence", () => {
    expect(deliveryBadge({ handoffStatus: "done" })?.tone).toBe("warn");
    expect(deliveryBadge({ handoffStatus: "done", evidence: "⚠ sem evidência" })).toEqual({ tone: "warn", text: "sem evidência" });
  });

  it("flags a failed contract above everything else", () => {
    expect(deliveryBadge({ contractStatus: "failed", evidence: "3 checks" })).toEqual({ tone: "danger", text: "contrato reprovado" });
    expect(deliveryBadge({ evidence: "⚠ contrato reprovado" })?.tone).toBe("danger");
  });
});

describe("groupPanesForRail", () => {
  const ids = (rows: { pane: { id: string }; depth: number }[]) => rows.map((row) => `${"-".repeat(row.depth)}${row.pane.id}`);

  it("keeps unrelated panes flat and in order", () => {
    expect(ids(groupPanesForRail([{ id: "a" }, { id: "b" }]))).toEqual(["a", "b"]);
  });

  it("hangs helpers under their pilot by parentPaneId", () => {
    const rows = groupPanesForRail([{ id: "h1", parentPaneId: "p" }, { id: "solo" }, { id: "p", role: "orchestrator" }, { id: "h2", parentPaneId: "p" }]);
    expect(ids(rows)).toEqual(["solo", "p", "-h1", "-h2"]);
    expect(rows.map((row) => row.last)).toEqual([true, false, false, true]);
  });

  it("falls back to the shared mission, ignoring plain shells", () => {
    const rows = groupPanesForRail([
      { id: "p", role: "orchestrator", registryMissionId: "m1" },
      { id: "w", role: "worker", registryMissionId: "m1" },
      { id: "s", agent: "shell", registryMissionId: "m1" },
    ]);
    expect(ids(rows)).toEqual(["p", "-w", "s"]);
  });

  it("flattens deep chains and survives cycles", () => {
    expect(ids(groupPanesForRail([{ id: "a" }, { id: "b", parentPaneId: "a" }, { id: "c", parentPaneId: "b" }]))).toEqual(["a", "-b", "-c"]);
    expect(groupPanesForRail([{ id: "x", parentPaneId: "y" }, { id: "y", parentPaneId: "x" }])).toHaveLength(2);
  });
});
