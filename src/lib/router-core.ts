/* ═══════════════════════════════════════════════════════════════════════════
   ROUTER — NÚCLEO PURO
   ═══════════════════════════════════════════════════════════════════════════

   Toda a lógica de navegação, sem React e sem DOM, para ser testável direto.
   A camada React (`router.tsx`) só liga isto a `useSyncExternalStore` e ao
   `location.hash`.

   O router antigo era `useState<Route>` com três valores literais: sem
   histórico, sem voltar, sem deep-link, sem parâmetros. Um app que abre
   painéis, workspaces e specs precisa das quatro coisas.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Uma localização resolvida: caminho + parâmetros de query. */
export interface Location {
  /** Caminho normalizado, sempre iniciando com "/" e sem barra final. */
  path: string;
  /** Parâmetros de query decodificados. */
  query: Readonly<Record<string, string>>;
}

/** Pilha de histórico com um cursor — permite voltar e avançar. */
export interface HistoryState {
  entries: Location[];
  /** Índice da entrada atual em `entries`. */
  index: number;
}

export interface NavigateOptions {
  /** Substitui a entrada atual em vez de empilhar uma nova. */
  replace?: boolean;
  /** Parâmetros de query. Valores `undefined`/`null` são descartados. */
  query?: Record<string, string | number | boolean | undefined | null>;
}

/** Profundidade máxima do histórico. Evita crescimento sem limite numa
 *  sessão longa; 100 passos de "voltar" é muito além do que alguém usa. */
export const MAX_HISTORY = 100;

export const ROOT: Location = Object.freeze({ path: "/", query: Object.freeze({}) });

/* ── Normalização ─────────────────────────────────────────────────────── */

/**
 * Normaliza um caminho para forma canônica: barra inicial, sem barra final,
 * sem segmentos vazios.
 *
 *   ""            → "/"
 *   "settings"    → "/settings"
 *   "/settings/"  → "/settings"
 *   "//a//b/"     → "/a/b"
 */
export function normalizePath(raw: string): string {
  const segments = raw.split("/").filter(Boolean);
  return segments.length === 0 ? "/" : "/" + segments.join("/");
}

/** Descarta chaves nulas e converte tudo para string. */
function normalizeQuery(
  query: Record<string, string | number | boolean | undefined | null> | undefined,
): Record<string, string> {
  if (!query) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = String(value);
  }
  return out;
}

/* ── Serialização de hash ─────────────────────────────────────────────────
   Usamos hash routing porque o renderer é servido de `file://` em produção,
   onde o history API baseado em path não funciona. O hash sobrevive a
   reload e pode ser colado para abrir o app direto numa tela.               */

/**
 * Faz o parse de um `location.hash` para uma Location.
 * Aceita com ou sem o "#" inicial. Entrada inválida cai para a raiz.
 */
export function parseHash(hash: string): Location {
  const raw = hash.replace(/^#/, "");
  if (!raw) return ROOT;

  const queryStart = raw.indexOf("?");
  const pathPart = queryStart === -1 ? raw : raw.slice(0, queryStart);
  const queryPart = queryStart === -1 ? "" : raw.slice(queryStart + 1);

  const query: Record<string, string> = {};
  if (queryPart) {
    for (const [key, value] of new URLSearchParams(queryPart)) {
      query[key] = value;
    }
  }

  return { path: normalizePath(decodeURIComponent(pathPart)), query };
}

/** Serializa uma Location de volta para um hash (com "#"). */
export function serializeHash(location: Location): string {
  const params = new URLSearchParams(location.query);
  const queryString = params.toString();
  return "#" + location.path + (queryString ? "?" + queryString : "");
}

/** Duas Locations são equivalentes? Usado para evitar entradas duplicadas. */
export function isSameLocation(a: Location, b: Location): boolean {
  if (a.path !== b.path) return false;
  const aKeys = Object.keys(a.query);
  const bKeys = Object.keys(b.query);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a.query[key] === b.query[key]);
}

/* ── Transições de histórico ──────────────────────────────────────────── */

export function createHistory(initial: Location = ROOT): HistoryState {
  return { entries: [initial], index: 0 };
}

/** A localização atual de uma HistoryState. */
export function current(state: HistoryState): Location {
  return state.entries[state.index] ?? ROOT;
}

/**
 * Empilha (ou substitui) uma entrada.
 *
 * Como num browser, navegar a partir do meio do histórico trunca tudo o que
 * estava à frente — o "avançar" desaparece assim que você segue outro rumo.
 *
 * Navegar para o lugar onde já se está é ignorado, para que apertar o mesmo
 * item de menu duas vezes não encha o histórico de duplicatas.
 */
export function push(
  state: HistoryState,
  to: Location,
  options: { replace?: boolean } = {},
): HistoryState {
  if (isSameLocation(current(state), to)) {
    // Mesmo destino: no máximo atualiza no lugar, nunca empilha.
    if (!options.replace) return state;
  }

  if (options.replace) {
    const entries = state.entries.slice();
    entries[state.index] = to;
    return { entries, index: state.index };
  }

  // Trunca o "futuro", depois empilha.
  const truncated = state.entries.slice(0, state.index + 1);
  truncated.push(to);

  // Poda pela frente quando passa do limite, mantendo o cursor no fim.
  const overflow = Math.max(0, truncated.length - MAX_HISTORY);
  const entries = overflow ? truncated.slice(overflow) : truncated;

  return { entries, index: entries.length - 1 };
}

/** Move o cursor por `delta`. Fora dos limites, não faz nada. */
export function go(state: HistoryState, delta: number): HistoryState {
  const index = state.index + delta;
  if (index < 0 || index >= state.entries.length) return state;
  return { entries: state.entries, index };
}

export function canGoBack(state: HistoryState): boolean {
  return state.index > 0;
}

export function canGoForward(state: HistoryState): boolean {
  return state.index < state.entries.length - 1;
}

/* ── Casamento de rotas ───────────────────────────────────────────────────
   Um matcher mínimo, só o suficiente para segmentos dinâmicos. Não é
   react-router e não deve virar — se uma rota precisar de mais que isto, o
   estado provavelmente pertence a um store, não à URL.                      */

export interface RouteMatch {
  /** O padrão que casou, ex. "/spec/:id". */
  pattern: string;
  /** Segmentos dinâmicos extraídos, ex. { id: "003" }. */
  params: Record<string, string>;
}

/**
 * Casa um caminho contra um padrão com segmentos `:nome`.
 * Retorna null quando não casa.
 *
 *   match("/spec/003", "/spec/:id")  → { pattern, params: { id: "003" } }
 *   match("/spec",     "/spec/:id")  → null
 */
export function match(path: string, pattern: string): RouteMatch | null {
  const pathSegments = normalizePath(path).split("/").filter(Boolean);
  const patternSegments = normalizePath(pattern).split("/").filter(Boolean);

  if (pathSegments.length !== patternSegments.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternSegments.length; i++) {
    const patternSegment = patternSegments[i];
    const pathSegment = pathSegments[i];
    if (patternSegment.startsWith(":")) {
      params[patternSegment.slice(1)] = decodeURIComponent(pathSegment);
    } else if (patternSegment !== pathSegment) {
      return null;
    }
  }
  return { pattern, params };
}

/** Primeiro padrão que casa, na ordem dada. */
export function matchFirst(path: string, patterns: string[]): RouteMatch | null {
  for (const pattern of patterns) {
    const found = match(path, pattern);
    if (found) return found;
  }
  return null;
}

/** Constrói uma Location a partir de um caminho e opções. */
export function toLocation(path: string, options: NavigateOptions = {}): Location {
  return { path: normalizePath(path), query: normalizeQuery(options.query) };
}
