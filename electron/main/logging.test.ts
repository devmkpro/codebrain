// @vitest-environment node
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { guardConsoleOutput } from "./logging";

describe("logging com launcher fechado", () => {
  it("desliga só console no EPIPE síncrono sem perder o processo", () => {
    const transport = { level: "info" as string | false, writeFn: vi.fn(() => { throw Object.assign(new Error("broken pipe"), { code: "EPIPE" }); }) };
    const dispose = guardConsoleOutput(transport, []);
    expect(() => transport.writeFn()).not.toThrow();
    expect(transport.level).toBe(false);
    dispose();
  });
  it.each([0, 1])("trata erro assíncrono do stream %s", (index) => {
    const streams = [new EventEmitter(), new EventEmitter()];
    const transport = { level: "info" as string | false, writeFn: vi.fn() };
    const dispose = guardConsoleOutput(transport, streams);
    expect(() => streams[index].emit("error", Object.assign(new Error("closed"), { code: "EPIPE" }))).not.toThrow();
    expect(transport.level).toBe(false);
    dispose();
    expect(streams[0].listenerCount("error")).toBe(0);
  });
  it("não oculta erros diferentes de pipe fechado", () => {
    const error = Object.assign(new Error("disk failure"), { code: "EIO" });
    const transport = { level: "info" as string | false, writeFn: vi.fn(() => { throw error; }) };
    const stream = new EventEmitter();
    const dispose = guardConsoleOutput(transport, [stream]);
    expect(() => transport.writeFn()).toThrow(error);
    expect(() => stream.emit("error", error)).toThrow(error);
    dispose();
  });
});
