// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPaneHandlers } from "./pane-handlers.js";

afterEach(() => vi.useRealTimers());

function setup(agent, role = "worker", withMemory = true) {
  const pty = Object.assign(new EventEmitter(), {
    hasPane: () => true, list: () => [{ paneId: "p", agent }],
    writeSilent: vi.fn(), write: vi.fn(),
  });
  const paneMemoryState = withMemory ? new Map() : undefined;
  const opts = { paneConfigs: new Map([["p", { agent, parentPaneId: "owner", shellBusy: false }]]), roleMap: new Map([["p", role]]), paneMemoryState, getCallerPaneId: () => "owner" };
  return { pty, opts, api: createPaneHandlers(pty, opts) };
}

describe("pane_write transport", () => {
  it("accepts the SSH owner after output without a newline and rejects another pane", async () => {
    const { api, pty, opts } = setup("shell");
    opts.paneConfigs.set("p", { agent: "shell", ownerPaneId: "owner" });
    pty.read = () => ["user@host:~$ cat state.json", '{}user@host:~$ '];
    expect((await api.writePane("p", "echo ok", false, { fromPaneId: "other" })).code).toBe("shell_owner_mismatch");
    expect(await api.writePane("p", "echo ok", false, { fromPaneId: "owner" })).toEqual({ ok: true });
    expect(pty.writeSilent).toHaveBeenCalledExactlyOnceWith("p", "echo ok", true);
  });

  it("allows raw q in an owned git diff pager", async () => {
    const { api, pty, opts } = setup("shell");
    opts.paneConfigs.get("p").shellBusy = null;
    pty.read = () => ["user@host:~$ git diff -- file", "diff --git a/file b/file", "@@ -1 +1 @@", "+new", ":"];
    expect(await api.writePane("p", "q", false, { fromPaneId: "owner" })).toEqual({ ok: true });
    expect(pty.write).toHaveBeenCalledExactlyOnceWith("p", "q");
    expect(pty.writeSilent).not.toHaveBeenCalled();
  });

  it("allows the owner to exit a systemctl pager without submitting a command", async () => {
    const { api, pty, opts } = setup("shell");
    opts.paneConfigs.get("p").shellBusy = null;
    pty.read = () => ["user@host:~$ systemctl --user cat tunnel.service", "# /home/user/.config/systemd/user/tunnel.service", "[Unit]", "lines 1-15/15 (END)"];
    expect(await api.writePane("p", "q", false, { fromPaneId: "owner" })).toEqual({ ok: true });
    expect(pty.write).toHaveBeenCalledExactlyOnceWith("p", "q");
    expect((await api.writePane("p", "q", false, { fromPaneId: "other" })).code).toBe("shell_owner_mismatch");
  });

  it("keeps ownership, read-only and command guards for pager input", async () => {
    const { api, pty, opts } = setup("shell");
    opts.paneConfigs.get("p").shellBusy = null;
    pty.read = () => ["user@host:~$ git diff", "diff --git a/file b/file", ":"];
    expect((await api.writePane("p", "q", false, { fromPaneId: "other" })).code).toBe("shell_owner_mismatch");
    expect((await api.writePane("p", "q", true, { fromPaneId: "owner" })).code).toBe("shell_state_unknown");
    expect((await api.writePane("p", "q; whoami", false, { fromPaneId: "owner" })).code).toBe("shell_state_unknown");
    opts.paneConfigs.get("p").readOnly = true;
    expect((await api.writePane("p", "q", false, { fromPaneId: "owner" })).ok).toBe(false);
    expect(pty.write).not.toHaveBeenCalled();
    expect(pty.writeSilent).not.toHaveBeenCalled();
  });

  it("does not send q to other unknown processes", async () => {
    const { api, pty, opts } = setup("shell");
    opts.paneConfigs.get("p").shellBusy = null;
    pty.read = () => ["user@host:~$ tail -f app.log", "waiting:"];
    expect((await api.writePane("p", "q", false, { fromPaneId: "owner" })).code).toBe("shell_state_unknown");
    expect(pty.write).not.toHaveBeenCalled();
  });

  it.each([
    ["shell", "worker", true], ["shell", "orchestrator", true],
    ["shell", "worker", false], ["browser", "worker", true],
    [undefined, "worker", true],
  ])("preserva comando literal em terminal %s com papel %s e memória %s", async (agent, role, memory) => {
    vi.useFakeTimers();
    const { api, pty, opts } = setup(agent, role, memory);
    const command = "printf 'test tarefa';\n" + "docker logs --since 1h --tail 500 worker | tail -10; ".repeat(3);
    const pending = api.writePane("p", command, true);
    await vi.advanceTimersByTimeAsync(4000);
    expect(await pending).toEqual({ ok: true });
    expect(pty.writeSilent).toHaveBeenCalledExactlyOnceWith("p", command, true);
    expect(pty.write).toHaveBeenCalledExactlyOnceWith("p", "\r");
    expect(opts.paneMemoryState?.size ?? 0).toBe(0);
  });

  it("mantém protocolo para tasks de agentes e banner para orquestradores", async () => {
    for (const role of ["worker", "orchestrator"]) {
      const { api, pty } = setup("claude", role);
      await api.writePane("p", "Corrigir esta tarefa de implementação com evidência. ".repeat(3), false);
      const text = pty.writeSilent.mock.calls[0][1];
      expect(text).toContain("Contexto: para task");
      expect(text.includes("ORCHESTRATOR:")).toBe(role === "orchestrator");
    }
  });

  it("mantém handoff para tasks submetidas a agentes sem memória", async () => {
    vi.useFakeTimers();
    const { api, pty } = setup("claude", "worker", false);
    const pending = api.writePane("p", "Uma tarefa longa para o agente implementar com evidência. ".repeat(3));
    await vi.advanceTimersByTimeAsync(4000);
    await pending;
    expect(pty.writeSilent.mock.calls[0][1]).toContain("Final da task:");
  });
});
