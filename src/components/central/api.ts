/// <reference types="vite/client" />
import React from "react";
import type {
  Account,
  CatalogItem,
  DeciderProvider,
  Finding,
  HarnessTable,
  MediaItem,
  MediaProvider,
  SpawnReceipt,
} from "./types";

/* Acesso à ponte de preload. Os métodos entram aqui e saem como dados ou como erro
   tipado, para cada tela ter só quatro estados: carregando, pronto, erro e
   indisponível (versão do app sem esse recurso). */

export class BridgeUnavailable extends Error {
  constructor() {
    super("Este recurso ainda não está disponível nesta versão do app.");
  }
}

/* Fixtures só existem em desenvolvimento, no preview do renderer. Em produção
   `import.meta.env.DEV` é falso e o import dinâmico inteiro cai do bundle. */
const fixturesReady: Promise<unknown> =
  import.meta.env.DEV &&
  (window as unknown as { __CODEBRAIN_PREVIEW__?: boolean }).__CODEBRAIN_PREVIEW__
    ? import("./dev-fixtures").then((module) => module.installFixtures())
    : Promise.resolve();

export const whenFixturesReady = () => fixturesReady;

type Result = { ok?: boolean; error?: string } & Record<string, unknown>;

function bridge(
  name: string
): Record<string, (...args: unknown[]) => Promise<Result | undefined>> | undefined {
  return (window as unknown as { codeBrainApp?: Record<string, never> }).codeBrainApp?.[name];
}

async function call(service: string, method: string, ...args: unknown[]): Promise<Result> {
  await fixturesReady;
  const fn = bridge(service)?.[method];
  if (typeof fn !== "function") throw new BridgeUnavailable();
  const result = await fn(...args);
  if (result == null) throw new BridgeUnavailable();
  if (result.ok === false) throw new Error(result.error || "O app recusou a operação.");
  return result;
}

const field = <T>(result: Result, key: string, fallback: T): T =>
  (result[key] as T | undefined) ?? fallback;

export const central = {
  harness: {
    getTable: async () =>
      field<HarnessTable | null>(await call("harness", "getTable"), "table", null),
    saveTable: async (table: HarnessTable) =>
      field<HarnessTable>(await call("harness", "saveTable", table), "table", table),
    receipts: async (workspace: string) =>
      field<SpawnReceipt[]>(await call("harness", "receipts", { workspace }), "receipts", []),
    deciderProviders: async () =>
      field<DeciderProvider[]>(await call("harness", "deciderProviders"), "providers", []),
    testDecider: (prompt: string) => call("harness", "testDecider", { prompt }),
  },
  findings: {
    list: async (workspace: string) =>
      field<Finding[]>(await call("findings", "list", { workspace }), "findings", []),
    update: (args: {
      workspace: string;
      id: string;
      status: string;
      actor?: string;
      note?: string;
      evidence?: string;
      commit?: string;
    }) => call("findings", "update", args),
    stats: async (workspace: string) =>
      field<Record<string, number>>(await call("findings", "stats", { workspace }), "counts", {}),
  },
  catalog: {
    scan: async (workspace?: string | null) =>
      field<CatalogItem[]>(
        await call("agentCatalog", "scan", { workspace: workspace ?? undefined }),
        "items",
        []
      ),
    setMeta: (args: {
      kind: string;
      name: string;
      disabled?: boolean;
      category?: string;
      allowedSkills?: string[];
    }) => call("agentCatalog", "setMeta", args),
    copyTo: (args: {
      name: string;
      kind?: CatalogItem["kind"];
      cli: string;
      workspace?: string | null;
    }) => call("agentCatalog", "copyTo", args),
  },
  accounts: {
    list: async () => field<Account[]>(await call("accounts", "list"), "accounts", []),
    add: async (args: { cli: string; label: string }) =>
      field<Account | null>(await call("accounts", "add", args), "account", null),
    remove: (id: string) => call("accounts", "remove", { id }),
    lock: (cli: string, id: string | null) => call("accounts", "lock", { cli, id }),
    login: async (id: string, cwd?: string | null) =>
      field<string | null>(
        await call("accounts", "login", { id, cwd: cwd ?? undefined }),
        "paneId",
        null
      ),
  },
  media: {
    providers: async () =>
      field<MediaProvider[]>(await call("media", "providers"), "providers", []),
    list: async (workspace: string) =>
      field<MediaItem[]>(await call("media", "list", { workspace }), "items", []),
    generate: (args: {
      kind: string;
      prompt: string;
      provider?: string;
      size?: string;
      style?: string;
      workspace: string;
    }) => call("media", "generate", args),
  },
};

export type ResourceState = "loading" | "ready" | "error" | "unavailable";

export interface Resource<T> {
  state: ResourceState;
  data: T | undefined;
  error: string | null;
  /** Uma releitura em segundo plano falhou; os dados na tela são os últimos bons. */
  stale: boolean;
  reload: () => void;
  mutate: (next: T) => void;
}

/** Carrega ao montar e quando `deps` muda; com `pollMs`, relê enquanto a janela está visível. */
export function useResource<T>(
  load: () => Promise<T>,
  deps: React.DependencyList,
  pollMs?: number
): Resource<T> {
  const [state, setState] = React.useState<ResourceState>("loading");
  const [data, setData] = React.useState<T | undefined>(undefined);
  const [error, setError] = React.useState<string | null>(null);
  const [stale, setStale] = React.useState(false);
  const loadRef = React.useRef(load);
  loadRef.current = load;
  const runRef = React.useRef(0);
  const hasDataRef = React.useRef(false);

  const run = React.useCallback(async () => {
    const id = ++runRef.current;
    if (!hasDataRef.current) setState("loading");
    try {
      const next = await loadRef.current();
      if (id !== runRef.current) return;
      hasDataRef.current = true;
      setData(next);
      setError(null);
      setStale(false);
      setState("ready");
    } catch (err) {
      if (id !== runRef.current) return;
      if (err instanceof BridgeUnavailable) {
        hasDataRef.current = false;
        setData(undefined);
        setState("unavailable");
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      if (hasDataRef.current) setStale(true);
      else setState("error");
    }
  }, []);

  React.useEffect(() => {
    hasDataRef.current = false;
    setState("loading");
    setData(undefined);
    setError(null);
    setStale(false);
    void run();
    const timer = pollMs
      ? window.setInterval(() => {
          if (document.visibilityState === "visible") void run();
        }, pollMs)
      : undefined;
    return () => {
      ++runRef.current;
      if (timer !== undefined) window.clearInterval(timer);
    };
    // `deps` é a chave de recarga escolhida por quem chama.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, pollMs, run]);

  const mutate = React.useCallback((next: T) => {
    ++runRef.current;
    hasDataRef.current = true;
    setData(next);
    setError(null);
    setStale(false);
    setState("ready");
  }, []);

  return { state, data, error, stale, reload: run, mutate };
}

/** Atualiza chaves e modelos sem precisar sair da Central. */
export function useProviderRefresh(reload: () => void) {
  const reloadRef = React.useRef(reload);
  reloadRef.current = reload;
  React.useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    void whenFixturesReady().then(() => {
      if (!disposed) off = window.codeBrainApp?.providers?.onUpdated?.(() => reloadRef.current());
    });
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
}

/** Promessa de ação com estado de envio e mensagem de erro para a própria linha. */
export function useAction() {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const run = React.useCallback(async <T>(action: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error, run, clearError: React.useCallback(() => setError(null), []) };
}
