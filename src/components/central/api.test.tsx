import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { central, useResource } from "./api";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("contratos da Central", () => {
  it("extrai os envelopes reais do main e envia workspace, tabela e conta", async () => {
    const table = { version: 1, rows: [] };
    const saveTable = vi.fn().mockResolvedValue({ ok: true, table });
    const stats = vi.fn().mockResolvedValue({ ok: true, counts: { open: 2, reopened: 1 } });
    const login = vi.fn().mockResolvedValue({ ok: true, paneId: "login-1" });
    vi.stubGlobal("codeBrainApp", {
      harness: { saveTable },
      findings: { stats },
      accounts: { login },
    });
    expect(
      await central.harness.saveTable(table as Parameters<typeof central.harness.saveTable>[0])
    ).toBe(table);
    expect(saveTable).toHaveBeenCalledWith(table);
    expect(await central.findings.stats("D:/a")).toEqual({ open: 2, reopened: 1 });
    expect(stats).toHaveBeenCalledWith({ workspace: "D:/a" });
    expect(await central.accounts.login("a", "D:/a")).toBe("login-1");
    expect(login).toHaveBeenCalledWith({ id: "a", cwd: "D:/a" });
  });

  it("preserva a razão do Decisor quando o serviço não decide", async () => {
    vi.stubGlobal("codeBrainApp", {
      harness: {
        testDecider: vi
          .fn()
          .mockResolvedValue({
            ok: false,
            decision: null,
            reason: "confiança baixa",
            error: "confiança baixa",
          }),
      },
    });
    await expect(central.harness.testDecider("pedido")).rejects.toThrow("confiança baixa");
  });
});

describe("carregamento por workspace", () => {
  it("ignora resposta pendente do workspace anterior e libera a última recarga", async () => {
    const old = deferred<string>();
    const next = deferred<string>();
    const { result, rerender } = renderHook(
      ({ workspace }) =>
        useResource(() => (workspace === "a" ? old.promise : next.promise), [workspace]),
      { initialProps: { workspace: "a" } }
    );
    rerender({ workspace: "b" });
    await act(async () => {
      next.resolve("dados de b");
    });
    await waitFor(() => expect(result.current.data).toBe("dados de b"));
    await act(async () => {
      old.resolve("dados de a");
    });
    expect(result.current.data).toBe("dados de b");
  });

  it("não deixa uma requisição em voo substituir uma mutação local", async () => {
    const pending = deferred<string>();
    const { result } = renderHook(() => useResource(() => pending.promise, []));
    act(() => result.current.mutate("salvo"));
    await act(async () => {
      pending.resolve("antigo");
    });
    expect(result.current.data).toBe("salvo");
  });

  it("conserva os últimos dados numa falha e remove o aviso após recuperar", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(["a"])
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(["b"]);
    const { result } = renderHook(() => useResource(load, []));
    await waitFor(() => expect(result.current.state).toBe("ready"));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.data).toEqual(["a"]);
    expect(result.current.stale).toBe(true);
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.data).toEqual(["b"]);
    expect(result.current.stale).toBe(false);
  });
});
