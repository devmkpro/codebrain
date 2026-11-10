import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  canUse,
  cliOptionLabel,
  cliOptions,
  entriesFromDetect,
  multiAccountClis,
  normalizeRegistry,
  useCliRegistry,
  type CliEntry,
} from "./cli-registry";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const kimi: CliEntry = {
  id: "kimi",
  label: "Kimi",
  found: false,
  verified: false,
  capabilities: { model: false, multiAccount: false },
};
const claude: CliEntry = {
  id: "claude",
  label: "Claude Code",
  found: true,
  verified: true,
  capabilities: { model: true, effort: true, multiAccount: true },
};

describe("registro de CLIs", () => {
  it("aceita lista pura ou embrulhada e rejeita o resto", () => {
    expect(normalizeRegistry([claude])?.[0].id).toBe("claude");
    expect(normalizeRegistry({ ok: true, clis: [claude] })?.[0].id).toBe("claude");
    expect(normalizeRegistry(undefined)).toBeNull();
    expect(normalizeRegistry({ ok: false })).toBeNull();
  });

  it("converte cli.detect() sem trazer o que não é agente", () => {
    const entries = entriesFromDetect({
      claude: { found: true, version: "1" },
      shell: { found: true },
      "9router": { found: false },
      codex: { found: false },
    });
    expect(entries.map((entry) => entry.id)).toEqual(["claude", "codex"]);
    expect(entries[0].capabilities).toBeUndefined();
  });

  it("só confirma capacidades declaradas como verdadeiras", () => {
    expect(canUse(kimi, "model")).toBe(false);
    expect(canUse(claude, "model")).toBe(true);
    expect(canUse({ id: "x", label: "x", found: true }, "effort")).toBe(false);
    expect(canUse(undefined, "effort")).toBe(false);
  });

  it("filtra contas estritamente por multiAccount", () => {
    expect(
      multiAccountClis([kimi, claude, { id: "x", label: "x", found: true }]).map(
        (entry) => entry.id
      )
    ).toEqual(["claude"]);
  });

  it("marca não instalada e experimental, mas deixa escolher", () => {
    expect(cliOptionLabel(kimi)).toBe("Kimi (não instalada, experimental)");
    expect(cliOptionLabel(claude)).toContain("suportada");
    expect(cliOptionLabel({ id: "x", label: "x", found: true })).toContain(
      "suporte não verificado"
    );
    expect(cliOptions([kimi, claude], "kimi").map((option) => option.value)).toEqual([
      "kimi",
      "claude",
    ]);
  });

  it("não some com um valor salvo que saiu do registro", () => {
    expect(cliOptions([claude], "antiga").at(-1)).toEqual({
      value: "antiga",
      label: "antiga (fora do registro)",
    });
  });

  it("carrega as 14 escolhas, incluindo Kiro, do preload em vez da detecção", async () => {
    const ids = [
      "openclaude",
      "claude",
      "codex",
      "gemini",
      "kimi",
      "cursor",
      "copilot",
      "kiro",
      "opencode",
      "grok",
      "antigravity",
      "hermes",
      "muse",
      "commandcode",
    ];
    const registry = vi.fn().mockResolvedValue(ids.map((id) => ({ ...claude, id, label: id })));
    const detect = vi.fn().mockResolvedValue({ claude: { found: true } });
    vi.stubGlobal("codeBrainApp", { cli: { registry, detect } });
    const { result } = renderHook(useCliRegistry);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(cliOptions(result.current.entries, "").map((option) => option.value)).toEqual(ids);
    expect(detect).not.toHaveBeenCalled();
    expect(result.current.find("kiro")?.label).toBe("kiro");
  });

  it("mostra falha do registro e permite tentar novamente sem esconder escolhas em detect", async () => {
    const registry = vi
      .fn()
      .mockRejectedValueOnce(new Error("registro offline"))
      .mockResolvedValue([{ ...claude, id: "novo-harness" }]);
    const detect = vi.fn();
    vi.stubGlobal("codeBrainApp", { cli: { registry, detect } });
    const { result } = renderHook(useCliRegistry);
    await waitFor(() => expect(result.current.error).toBe("registro offline"));
    expect(result.current.ready).toBe(false);
    await act(async () => {
      await result.current.reload();
    });
    await waitFor(() => expect(result.current.find("novo-harness")).toBeDefined());
    expect(detect).not.toHaveBeenCalled();
  });
});
