/* ═══════════════════════════════════════════════════════════════════════════
   FEATURE FLAGS
   ═══════════════════════════════════════════════════════════════════════════

   A refatoração do shell é grande demais para acontecer no lugar. O shell
   novo (terminal-first) cresce em paralelo ao atual, atrás destas flags, e
   vira o padrão só quando estiver melhor em todos os aspectos. Enquanto isso,
   o app continua utilizável em toda commit.

   Precedência, do mais forte para o mais fraco:

     1. Query string      — ?ff_shellV2=1        (uma sessão, para debug)
     2. Variável de ambiente — CODEBRAIN_FF_SHELLV2=1  (build/CI)
     3. Preferência salva — localStorage via flags-store
     4. Default da flag   — o que está declarado aqui

   Chamável fora do React de propósito: o shell escolhido é decidido no boot,
   antes da árvore montar.
   ═══════════════════════════════════════════════════════════════════════════ */

export type FlagStage = "experimental" | "beta" | "stable";

export interface FlagDefinition {
  key: FlagKey;
  /** Rótulo curto, mostrado nas configurações. */
  label: string;
  /** O que muda quando está ligada. */
  description: string;
  default: boolean;
  stage: FlagStage;
}

/** Toda flag conhecida. Adicionar aqui basta para aparecer nas configurações. */
export const FLAG_DEFINITIONS = {
  shellV2: {
    key: "shellV2",
    label: "Shell v2 (terminal-first)",
    description:
      "Substitui o shell atual pela interface terminal-first: paleta ANSI unificada, " +
      "grade de células e command palette. Em construção — o shell antigo segue " +
      "disponível desligando esta opção.",
    default: false,
    stage: "experimental",
  },
  commandPalette: {
    key: "commandPalette",
    label: "Command palette (Ctrl+K)",
    description:
      "Busca única sobre toda ação, painel e workspace. Funciona nos dois shells.",
    // Ligada por padrão, ao contrário das outras: é puramente aditiva — não
    // substitui nem esconde nada do shell atual — e é o maior ganho isolado
    // de descoberta. Segurá-la atrás de um toggle que ninguém sabe que existe
    // reproduziria justamente o problema que ela resolve.
    default: true,
    stage: "beta",
  },
  specKit: {
    key: "specKit",
    label: "Spec Kit",
    description:
      "Fluxo /specify → /plan → /tasks → /implement com specs versionadas em disco.",
    default: false,
    stage: "experimental",
  },
} as const satisfies Record<string, Omit<FlagDefinition, "key"> & { key: string }>;

export type FlagKey = keyof typeof FLAG_DEFINITIONS;

export const FLAG_KEYS = Object.keys(FLAG_DEFINITIONS) as FlagKey[];

/* ── Overrides ────────────────────────────────────────────────────────── */

/**
 * Override por query string: `?ff_shellV2=1` liga, `?ff_shellV2=0` desliga.
 * Vale só para a janela atual — ideal para reproduzir um bug sem mexer nas
 * preferências de quem reportou.
 */
function queryOverride(key: FlagKey): boolean | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get(`ff_${key}`);
  if (raw === null) return null;
  return raw === "1" || raw === "true";
}

/**
 * Override por ambiente: `CODEBRAIN_FF_SHELLV2=1`.
 *
 * O renderer não tem `process.env`, então o main injeta o que existir em
 * `window.__CODEBRAIN_FLAGS__` no preload. Ausente = sem override.
 */
function envOverride(key: FlagKey): boolean | null {
  if (typeof window === "undefined") return null;
  const injected = (window as unknown as { __CODEBRAIN_FLAGS__?: Record<string, boolean> })
    .__CODEBRAIN_FLAGS__;
  if (!injected) return null;

  // A variável de ambiente é MAIÚSCULA (CODEBRAIN_FF_SHELLV2) e a chave da
  // flag é camelCase (shellV2) — casamos sem diferenciar caixa.
  const wanted = key.toLowerCase();
  for (const [name, value] of Object.entries(injected)) {
    if (name.toLowerCase() === wanted) {
      return typeof value === "boolean" ? value : null;
    }
  }
  return null;
}

/**
 * Resolve uma flag aplicando toda a cadeia de precedência.
 *
 * @param key       Flag a resolver.
 * @param stored    Preferências salvas (do flags-store). Opcional para que
 *                  chamadas de boot funcionem antes do store hidratar.
 */
export function resolveFlag(
  key: FlagKey,
  stored?: Partial<Record<FlagKey, boolean>>,
): boolean {
  const fromQuery = queryOverride(key);
  if (fromQuery !== null) return fromQuery;

  const fromEnv = envOverride(key);
  if (fromEnv !== null) return fromEnv;

  const fromStorage = stored?.[key];
  if (typeof fromStorage === "boolean") return fromStorage;

  return FLAG_DEFINITIONS[key].default;
}

/** Valores default de todas as flags — usado para semear o store. */
export function defaultFlags(): Record<FlagKey, boolean> {
  return Object.fromEntries(
    FLAG_KEYS.map((key) => [key, FLAG_DEFINITIONS[key].default]),
  ) as Record<FlagKey, boolean>;
}

/**
 * Uma flag está travada por override? Nesse caso a UI de configurações mostra
 * o controle desabilitado, com o motivo — em vez de deixar o usuário clicar
 * num toggle que não faz efeito.
 */
export function flagOverrideSource(key: FlagKey): "query" | "env" | null {
  if (queryOverride(key) !== null) return "query";
  if (envOverride(key) !== null) return "env";
  return null;
}
