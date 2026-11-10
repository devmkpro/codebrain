// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ show: vi.fn(), run: vi.fn(), dispose: vi.fn() }));
vi.mock("electron", () => ({ dialog: { showMessageBox: mocks.show } }));
vi.mock("./command-runner", () => ({ createCommandRunner: () => ({ runCommand: mocks.run, dispose: mocks.dispose }) }));
import { commandRuntime, disposeCommands, hasRunningCommands } from "./command-runtime";
beforeEach(() => { vi.clearAllMocks(); mocks.show.mockResolvedValue({ response: 0 }); mocks.dispose.mockResolvedValue(undefined); });
const context = () => ({ mainWindow: { isDestroyed: () => false } }) as any;
const request = { command: "node --version", cwd: "C:/fixture", workspacePath: "C:/fixture" };
describe("native command consent and shutdown", () => {
  it("defaults to cancel and never treats dialog failure as permission", async () => {
    const runtime = commandRuntime(context());
    expect(await runtime.approveCommand(request)).toBe(false);
    expect(mocks.show.mock.calls[0][1]).toMatchObject({ defaultId: 0, cancelId: 0, buttons: ["Cancelar", "Executar"] });
    mocks.show.mockRejectedValueOnce(new Error("private detail"));
    expect(await runtime.approveCommand(request)).toBe(false);
  });
  it("requires an explicit click on Executar for each request", async () => {
    mocks.show.mockResolvedValueOnce({ response: 1 });
    const runtime = commandRuntime(context());
    expect(await runtime.approveCommand(request)).toBe(true);
    expect(await runtime.approveCommand(request)).toBe(false);
    expect(mocks.show).toHaveBeenCalledTimes(2);
  });
  it("refuses a missing/destroyed parent and an already aborted request", async () => {
    expect(await commandRuntime({ mainWindow: null } as any).approveCommand(request)).toBe(false);
    const controller = new AbortController(); controller.abort();
    expect(await commandRuntime(context()).approveCommand({ ...request, signal: controller.signal })).toBe(false);
    expect(mocks.show).not.toHaveBeenCalled();
  });
  it("cancels outstanding consent and command execution when disposed", async () => {
    const ctx = context(); const runtime = commandRuntime(ctx);
    let finish: (value: unknown) => void;
    mocks.show.mockImplementationOnce((_window, options) => new Promise(resolve => {
      finish = resolve; options.signal.addEventListener("abort", () => resolve({ response: 0 }));
    }));
    const approval = runtime.approveCommand(request);
    expect(hasRunningCommands(ctx)).toBe(true);
    await disposeCommands(ctx);
    finish!({ response: 1 });
    expect(await approval).toBe(false);
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(hasRunningCommands(ctx)).toBe(false);
  });
});
