// @vitest-environment node
import { expect, it } from "vitest";
import { OutputBuffer } from "./output-buffer";
import { inferShellBusyFromPrompt } from "../../packages/mcp/bridge/coordination/pane-safety.js";

it("exposes the live SSH prompt before newline, including split ANSI and OSC sequences", () => {
  const buffer = new OutputBuffer();
  buffer.push("Last login: today\r\n-bash: alias: source: not found\r\n");
  buffer.push("\x1b]0;deploy@example-host: ~\x07\x1b[?2004h\x1b[01;");
  buffer.push("32mdeploy@example-host\x1b[0m:\x1b[34m~\x1b[0m$ ");
  expect(buffer.readPlain(1)).toEqual(["deploy@example-host:~$ "]);
  expect(inferShellBusyFromPrompt({ read: (_id: string, n: number) => buffer.readPlain(n) }, "ssh")).toBe(false);
  buffer.push("sleep 100");
  expect(inferShellBusyFromPrompt({ read: () => buffer.readPlain() }, "ssh")).toBeNull();
  buffer.push("\r\nWorking...");
  expect(buffer.readPlain(1)).toEqual(["Working..."]);
});

it("does not duplicate a partial line when it is completed and keeps the requested limit", () => {
  const buffer = new OutputBuffer(2);
  buffer.push("one\ntwo\nthree");
  expect(buffer.readPlain(2)).toEqual(["two", "three"]);
  buffer.push("\nfour");
  expect(buffer.readPlain(2)).toEqual(["three", "four"]);
  buffer.clear();
  expect(buffer.readPlain()).toEqual([]);
});

it.each(["\x07", "\x1b\\", "\x9c"])("strips OSC terminated by %j consistently across Node versions", terminator => {
  const buffer = new OutputBuffer();
  buffer.push(`\x1b]0;Terminal title${terminator}deploy@example-host:~$ `);
  expect(buffer.readPlain(1)).toEqual(["deploy@example-host:~$ "]);
});
