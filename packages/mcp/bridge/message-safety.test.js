// @vitest-environment node
import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { createPaneHandlers } from "./pane-handlers.js";
it("does not inject natural-language agent messages into a shell/dev-server stdin", async () => {
  const pty = Object.assign(new EventEmitter(), { hasPane: () => true,
    list: () => [{ paneId: "server", agent: "shell" }], writeSilent: vi.fn(), write: vi.fn() });
  const result = await createPaneHandlers(pty, {}).messagePane("server", "Nova regra para os agentes", true);
  expect(result.ok).toBe(false);
  expect(pty.writeSilent).not.toHaveBeenCalled(); expect(pty.write).not.toHaveBeenCalled();
});
