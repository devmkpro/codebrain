// @vitest-environment node

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  accountEnv,
  accountSkillDirs,
  accountsRootDir,
  addAccount,
  getAccount,
  listAccounts,
  pickAccount,
  removeAccount,
  seedUsageForTest,
  setLockedAccount,
} from "./accounts";
import type { UsageWindow } from "./account-usage";

const usage = (usedPct: number | null, tokens: number | null = null): UsageWindow[] => [
  {
    id: "5h",
    label: "5 horas",
    usedPct,
    tokens,
    resetsAt: null,
    source: usedPct === null ? "estimado" : "medido",
  },
];

let home: string;
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };

function login(configDir: string) {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, ".credentials.json"), "{}");
}

/** Conta padrão e uma extra, ambas com sessão iniciada. */
function twoClaudeAccounts() {
  login(path.join(home, ".claude"));
  const extra = addAccount("claude", "Trabalho");
  login(extra.configDir);
  return extra;
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "cb-accounts-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  seedUsageForTest("claude-default", []);
});

afterEach(() => {
  process.env.HOME = saved.HOME;
  process.env.USERPROFILE = saved.USERPROFILE;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("contas", () => {
  it("sempre lista as contas padrão", () => {
    expect(listAccounts().map((account) => account.id)).toEqual([
      "claude-default",
      "codex-default",
    ]);
  });

  it("só define variável de ambiente para conta extra", () => {
    const claude = addAccount("claude", "A");
    const codex = addAccount("codex", "B");
    expect(accountEnv("claude-default")).toEqual({});
    expect(accountEnv(claude.id)).toEqual({ CLAUDE_CONFIG_DIR: claude.configDir });
    expect(accountEnv(codex.id)).toEqual({ CODEX_HOME: codex.configDir });
  });

  it("inclui o diretório de skills de cada conta", () => {
    const extra = addAccount("claude", "A");
    expect(accountSkillDirs().map((entry) => entry.dir)).toContain(
      path.join(extra.configDir, "skills")
    );
  });

  it("não remove a conta padrão", () => {
    expect(() => removeAccount("claude-default")).toThrow();
  });

  it("recupera estado null e elimina IDs duplicados", () => {
    const dir = path.join(home, ".codebrain");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "accounts.json");
    fs.writeFileSync(file, "null");
    expect(listAccounts()).toHaveLength(2);
    const account = addAccount("claude", "A");
    fs.writeFileSync(
      file,
      JSON.stringify({ accounts: [account, account, { id: 1, cli: "claude" }] })
    );
    expect(listAccounts()).toHaveLength(3);
  });

  it("recusa CLI sem suporte e dados inválidos antes de persistir", () => {
    expect(() => addAccount("cursor" as any, "A")).toThrow();
    expect(() => setLockedAccount("cursor" as any, null)).toThrow();
    expect(() => addAccount("claude", 123 as any)).toThrow();
  });

  it("apaga o diretório da conta removida e solta a trava", () => {
    const extra = addAccount("claude", "A");
    setLockedAccount("claude", extra.id);
    removeAccount(extra.id);
    expect(fs.existsSync(extra.configDir)).toBe(false);
    expect(getAccount(extra.id)).toBeNull();
    expect(pickAccount("claude", null)).toBeNull();
  });

  it("não deixa o arquivo de estado apontar conta para fora da pasta de contas", () => {
    const outside = path.join(home, "importante");
    fs.mkdirSync(outside);
    fs.mkdirSync(path.join(home, ".codebrain"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".codebrain", "accounts.json"),
      JSON.stringify({
        accounts: [{ id: "claude-x", cli: "claude", label: "X", configDir: outside }],
        locked: {},
      })
    );
    expect(getAccount("claude-x")?.configDir).toBe(path.join(accountsRootDir(), "claude-x"));
    removeAccount("claude-x");
    expect(fs.existsSync(outside)).toBe(true);
  });
});

describe("pickAccount", () => {
  it("seleciona a única conta extra logada e respeita a conta única pedida", () => {
    const extra = addAccount("claude", "Única");
    login(extra.configDir);
    expect(pickAccount("claude")?.id).toBe(extra.id);
    expect(pickAccount("claude", extra.id)?.id).toBe(extra.id);
  });

  it("janela vencida não continua penalizando a conta", () => {
    const extra = twoClaudeAccounts();
    const windows = usage(99);
    windows[0].resetsAt = Date.now() - 1000;
    seedUsageForTest("claude-default", windows);
    seedUsageForTest(extra.id, usage(50));
    expect(pickAccount("claude")?.id).toBe("claude-default");
  });
  it("devolve null com menos de duas contas logadas", () => {
    login(path.join(home, ".claude"));
    expect(pickAccount("claude", null)).toBeNull();
  });

  it("devolve null para CLI sem suporte a contas", () => {
    expect(pickAccount("gemini", null)).toBeNull();
  });

  it("escolhe a conta com menor uso", () => {
    const extra = twoClaudeAccounts();
    seedUsageForTest("claude-default", usage(80));
    seedUsageForTest(extra.id, usage(20));
    expect(pickAccount("claude", null)).toEqual({ id: extra.id, label: "Trabalho" });
  });

  it("respeita a conta pedida, depois a travada", () => {
    const extra = twoClaudeAccounts();
    seedUsageForTest("claude-default", usage(10));
    seedUsageForTest(extra.id, usage(90));
    setLockedAccount("claude", extra.id);
    expect(pickAccount("claude", "claude-default")?.id).toBe("claude-default");
    expect(pickAccount("claude", null)?.id).toBe(extra.id);
  });

  it("avisa quando todas estão perto do limite", () => {
    const extra = twoClaudeAccounts();
    seedUsageForTest("claude-default", usage(99));
    seedUsageForTest(extra.id, usage(96));
    expect(pickAccount("claude", null)).toMatchObject({
      id: extra.id,
      note: "todas as contas perto do limite",
    });
  });

  it("sem percentual, compara tokens das 5 horas", () => {
    const extra = twoClaudeAccounts();
    seedUsageForTest("claude-default", usage(null, 500));
    seedUsageForTest(extra.id, usage(null, 100));
    expect(pickAccount("claude", null)?.id).toBe(extra.id);
  });

  it("conta sem medição vence conta medida no limite", () => {
    const extra = twoClaudeAccounts();
    seedUsageForTest("claude-default", usage(97));
    seedUsageForTest(extra.id, usage(null, 100));
    const picked = pickAccount("claude", null);
    expect(picked?.id).toBe(extra.id);
    expect(picked?.note).toBeUndefined();
  });

  it("conta medida com folga vence conta sem medição", () => {
    const extra = twoClaudeAccounts();
    seedUsageForTest("claude-default", usage(30));
    seedUsageForTest(extra.id, usage(null, 1));
    expect(pickAccount("claude", null)?.id).toBe("claude-default");
  });
});
