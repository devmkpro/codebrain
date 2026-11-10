// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createCodebrainMCPServer } from "./index.js";

describe("contrato público pane_spawn", () => {
  it("preserva CLI, conta, missão e overrides de um lote através do schema MCP", async () => {
    const spawnTask = vi.fn(async () => ({ ok: true, panes: [{ ok: true, paneId: "worker" }] }));
    const server = createCodebrainMCPServer({ spawnTask });
    try {
      const tool = server._registeredTools.pane_spawn;
      const input = tool.inputSchema.parse({
        agent: "kiro", accountId: "work", missionId: "mission_1", parentPaneId: "pilot",
        panes: [{ prompt: "Pesquisar", agent: "codex", accountId: "second", missionId: "mission_2", parentPaneId: "other", skills: ["cb-evidence"], effort: "high", reuseIdle: false }],
      });
      const result = await tool.handler(input, {});
      expect(result.isError).toBe(false);
      expect(spawnTask).toHaveBeenCalledWith(expect.objectContaining({
        agent: "kiro", accountId: "work", missionId: "mission_1", parentPaneId: "pilot", panes: input.panes,
      }));
      expect(input.panes[0]).toMatchObject({ accountId: "second", skills: ["cb-evidence"], reuseIdle: false });
    } finally { await server.close(); }
  });
});
