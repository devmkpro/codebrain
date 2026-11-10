// @vitest-environment node
import { describe, expect, it } from "vitest";
import { inferShellBusyFromPrompt, paneSafety, shellWriteGuard } from "./pane-safety.js";

const ptyWith = (lines) => ({ list: () => [{ paneId: "ssh", agent: "shell" }], read: () => lines });
const opts = { paneConfigs: new Map([["ssh", { agent: "shell", ownerPaneId: "worker" }]]) };

describe("inferShellBusyFromPrompt", () => {
  it.each([
    "deploy@example-host:~$",
    "root@example-host:/var/www# ",
    "(venv) user@host:~/app$ ",
    "[deploy@web01 current]$",
    "PS C:\\Users\\dev> ",
    "C:\\Projetos>",
  ])("reconhece prompt ocioso: %s", (prompt) => {
    expect(inferShellBusyFromPrompt(ptyWith(["Last login: x", prompt, "", "   "]), "ssh")).toBe(false);
  });

  it.each([
    "deploy@example-host:~$ sleep 100",
    ">>> ",
    "mysql> ",
    "[sudo] password for deploy:",
    "Building assets... 42%",
  ])("mantém desconhecido fora de um prompt de shell: %s", (line) => {
    expect(inferShellBusyFromPrompt(ptyWith(["user@host:~$", line]), "ssh")).toBeNull();
  });

  it("remove sequências ANSI antes de comparar", () => {
    expect(inferShellBusyFromPrompt(ptyWith(["\x1b[01;32muser@host\x1b[00m:\x1b[01;34m~\x1b[00m$ "]), "ssh")).toBe(false);
  });

  it("sem buffer legível o estado continua desconhecido", () => {
    expect(inferShellBusyFromPrompt({}, "ssh")).toBeNull();
    expect(inferShellBusyFromPrompt(ptyWith([]), "ssh")).toBeNull();
  });
});

describe("paneSafety com terminal SSH sem estado explícito", () => {
  it("libera o dono quando o prompt está ocioso", () => {
    const info = paneSafety(ptyWith(["deploy@example-host:~$"]), opts, "ssh");
    expect(info.shellBusy).toBe(false);
    expect(shellWriteGuard(info, "worker")).toEqual({ ok: true });
    expect(shellWriteGuard(info, "other")).toMatchObject({ ok: false, code: "shell_owner_mismatch" });
  });

  it("recusa enquanto um comando ainda produz saída", () => {
    const info = paneSafety(ptyWith(["deploy@example-host:~$ tail -f app.log", "[info] request"]), opts, "ssh");
    expect(shellWriteGuard(info, "worker")).toMatchObject({ ok: false, code: "shell_state_unknown" });
  });

  it("estado explícito ocupado vence o prompt", () => {
    const busy = { paneConfigs: new Map([["ssh", { agent: "shell", ownerPaneId: "worker", shellBusy: true }]]) };
    const info = paneSafety(ptyWith(["deploy@example-host:~$"]), busy, "ssh");
    expect(shellWriteGuard(info, "worker")).toMatchObject({ ok: false, code: "shell_busy" });
  });
});
