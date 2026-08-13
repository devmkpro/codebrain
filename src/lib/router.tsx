/* ═══════════════════════════════════════════════════════════════════════════
   ROUTER — LIGAÇÃO REACT
   ═══════════════════════════════════════════════════════════════════════════

   Liga o núcleo puro (`router-core.ts`) ao React e ao `location.hash`.

   O store vive no escopo de módulo, não num Context, de propósito: o command
   palette, os atalhos de teclado e os handlers de IPC precisam navegar de
   fora da árvore React. `navigate()` é importável de qualquer lugar.

   `RouterProvider`, `useRouter().route` e `<Link href>` mantêm as assinaturas
   antigas para que o shell atual continue funcionando sem alteração.
   ═══════════════════════════════════════════════════════════════════════════ */

import React from "react";
import {
  canGoBack as coreCanGoBack,
  canGoForward as coreCanGoForward,
  createHistory,
  current,
  go,
  type HistoryState,
  isSameLocation,
  type Location,
  match,
  type NavigateOptions,
  parseHash,
  push,
  ROOT,
  serializeHash,
  toLocation,
} from "./router-core";

/** Compat: as três rotas home originais continuam sendo strings de caminho. */
export type Route = string;

/* ── Store ────────────────────────────────────────────────────────────── */

type Listener = () => void;

const hasWindow = typeof window !== "undefined";

/** Verdadeiro enquanto aplicamos nós mesmos o hash, para que o handler de
 *  `hashchange` não trate a própria escrita como uma navegação externa. */
let writingHash = false;

let state: HistoryState = createHistory(
  hasWindow ? parseHash(window.location.hash) : ROOT,
);

const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setState(next: HistoryState): void {
  if (next === state) return;
  state = next;
  syncHash();
  emit();
}

/** Espelha a localização atual no hash da janela, sem sujar o histórico
 *  nativo do browser — mantemos a nossa própria pilha. */
function syncHash(): void {
  if (!hasWindow) return;
  const target = serializeHash(current(state));
  if (window.location.hash === target) return;
  writingHash = true;
  try {
    // `replaceState` mantém o histórico do Electron limpo; nossa pilha é a
    // fonte da verdade para voltar/avançar.
    window.history.replaceState(null, "", target);
  } catch {
    // `file://` em alguns modos rejeita replaceState — cair para escrita
    // direta ainda funciona, só cria uma entrada nativa a mais.
    window.location.hash = target;
  } finally {
    writingHash = false;
  }
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): HistoryState {
  return state;
}

/* Hash alterado por fora (deep-link colado, botões de navegação do
   Electron) — adota como uma navegação normal. */
if (hasWindow) {
  window.addEventListener("hashchange", () => {
    if (writingHash) return;
    const incoming = parseHash(window.location.hash);
    if (isSameLocation(current(state), incoming)) return;
    state = push(state, incoming);
    emit();
  });
}

/* ── API imperativa (utilizável fora do React) ────────────────────────── */

/** Navega para um caminho. Seguro de chamar de qualquer lugar. */
export function navigate(path: string, options: NavigateOptions = {}): void {
  setState(push(state, toLocation(path, options), { replace: options.replace }));
}

/** Volta uma entrada. Sem efeito no início do histórico. */
export function back(): void {
  setState(go(state, -1));
}

/** Avança uma entrada. Sem efeito no fim do histórico. */
export function forward(): void {
  setState(go(state, 1));
}

/** A localização atual, para leitores fora do React. */
export function getLocation(): Location {
  return current(state);
}

/* ── Hooks ────────────────────────────────────────────────────────────── */

function useHistoryState(): HistoryState {
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export interface RouterApi {
  /** Localização completa: caminho + query. */
  location: Location;
  /** Compat: só o caminho. O shell atual compara com "/", "/settings", … */
  route: Route;
  /** Parâmetros de query da localização atual. */
  query: Readonly<Record<string, string>>;
  navigate: (path: string, options?: NavigateOptions) => void;
  back: () => void;
  forward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
}

export function useRouter(): RouterApi {
  const history = useHistoryState();
  const location = current(history);

  return React.useMemo(
    () => ({
      location,
      route: location.path,
      query: location.query,
      navigate,
      back,
      forward,
      canGoBack: coreCanGoBack(history),
      canGoForward: coreCanGoForward(history),
    }),
    [history, location],
  );
}

/**
 * Extrai segmentos dinâmicos quando a rota atual casa com o padrão.
 * Retorna null quando não casa — dá pra usar como guarda de renderização.
 *
 *   const params = useRouteMatch("/spec/:id");
 *   if (!params) return null;
 */
export function useRouteMatch(pattern: string): Record<string, string> | null {
  const { location } = useRouter();
  return React.useMemo(() => match(location.path, pattern)?.params ?? null, [
    location.path,
    pattern,
  ]);
}

/* ── Provider (compat) ────────────────────────────────────────────────────
   O store é global, então o provider não carrega mais estado. Fica por dois
   motivos: manter a árvore de componentes atual intacta, e dar um lugar para
   a sincronização inicial do hash acontecer uma vez.                         */

export function RouterProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    syncHash();
  }, []);
  return <>{children}</>;
}

/* ── Link ─────────────────────────────────────────────────────────────── */

type LinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: Route;
  /** Substitui a entrada atual em vez de empilhar. */
  replace?: boolean;
};

export function Link({ href, replace, onClick, children, ...props }: LinkProps) {
  const { route } = useRouter();
  const isActive = route === href;

  return (
    <a
      href={serializeHash(toLocation(href))}
      aria-current={isActive ? "page" : undefined}
      onClick={(event) => {
        // Deixa passar cliques com modificador (abrir em nova janela etc.).
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(href, { replace });
        (onClick as React.MouseEventHandler<HTMLAnchorElement>)?.(event);
      }}
      {...props}
    >
      {children}
    </a>
  );
}

/* ── Só para teste ────────────────────────────────────────────────────────
   Reinicia o store entre testes. Não usar em código de aplicação.           */
export function __resetRouter(initial: Location = ROOT): void {
  state = createHistory(initial);
  emit();
}
