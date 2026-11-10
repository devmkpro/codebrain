// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { deliverHandoff, resolveHandoffDestination } from "./handoff-handlers.js";

afterEach(() => vi.useRealTimers());
function setup() {
  const alive = new Set(["a", "b", "pilot", "foreign"]);
  const actors = new Map([
    ["a", { workspace: "/a", parent_pane_id: "pilot", mission_id: "mission_a" }],
    ["b", { workspace: "/a", parent_pane_id: "pilot", mission_id: "mission_a" }],
    ["pilot", { workspace: "/a", mission_id: "mission_a" }],
    ["foreign", { workspace: "/other", mission_id: "mission_b" }],
  ]);
  const pty = {
    hasPane: (id) => alive.has(id),
    list: () => [...alive].map((paneId) => ({ paneId, agent: "kiro" })),
    writeSilent: vi.fn(),
    write: vi.fn(),
  };
  const opts = {
    memoryStore: {
      actorGet: ({ paneId }) => ({ ok: true, actor: actors.get(paneId) }),
      findOrchestrator: () => ({ ok: true, orchestrators: ["foreign"] }),
    },
  };
  return { pty, opts, actors, alive };
}

describe("handoff: destino e recibo honesto", () => {
  it("serializa entregas de workers diferentes pelo destino", async () => {
    vi.useFakeTimers();
    const { pty, opts } = setup();
    const queues = new Map();
    const first = deliverHandoff(pty, opts, queues, "a", "A");
    const second = deliverHandoff(pty, opts, queues, "b", "B");
    await vi.advanceTimersByTimeAsync(0);
    expect(pty.writeSilent.mock.calls.map((call) => call[1])).toEqual(["A"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await first).toMatchObject({ paneId: "pilot", delivered: true, acknowledged: false });
    expect(await second).toMatchObject({ paneId: "pilot", delivered: true, acknowledged: false });
    expect(pty.writeSilent.mock.calls.map((call) => call[1])).toEqual(["A", "B"]);
    expect(queues.size).toBe(0);
  });

  it("recibo não confirma entrega se Enter falhar", async () => {
    vi.useFakeTimers();
    const { pty, opts } = setup();
    pty.write.mockImplementation(() => {
      throw new Error("EPIPE");
    });
    const result = deliverHandoff(pty, opts, new Map(), "a", "A");
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toMatchObject({
      paneId: "pilot",
      delivered: false,
      reason: "write_failed",
      error: "EPIPE",
    });
  });

  it("não envia Enter a destino encerrado durante paste", async () => {
    vi.useFakeTimers();
    const { pty, opts, alive } = setup();
    const result = deliverHandoff(pty, opts, new Map(), "a", "A");
    await vi.advanceTimersByTimeAsync(0);
    alive.delete("pilot");
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toMatchObject({ delivered: false, reason: "destination_closed" });
    expect(pty.write).not.toHaveBeenCalled();
  });

  it("não envia natural language para parent shell nem piloto de outro workspace", () => {
    const { pty, opts, actors } = setup();
    pty.list = () => [
      { paneId: "pilot", agent: "shell" },
      { paneId: "foreign", agent: "kiro" },
    ];
    expect(resolveHandoffDestination(pty, opts, "a")).toBeNull();
    actors.get("a").parent_pane_id = "foreign";
    expect(resolveHandoffDestination(pty, opts, "a")).toBeNull();
  });
});
