/* ═══════════════════════════════════════════════════════════════════════════
   BUSCA FUZZY
   ═══════════════════════════════════════════════════════════════════════════

   Casamento por subsequência com pontuação, no estilo do que Sublime, VS Code
   e Raycast fazem: digitar `npt` acha "**N**ovo **P**ane no **T**erminal".

   O command palette é o único caminho para boa parte das ações do app, então
   a qualidade do ranqueamento *é* a qualidade da descoberta. Um matcher
   ingênuo (substring, ou subsequência sem pontuação) devolve resultado certo
   em posição errada, e o usuário conclui que a ação não existe.

   Devolve também os índices casados, para o palette destacar as letras.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface FuzzyMatch {
  /** Maior é melhor. Sem escala absoluta — só serve para ordenar. */
  score: number;
  /** Posições no texto original que casaram, em ordem crescente. */
  indices: number[];
}

/* Pesos. Calibrados por teste — ver fuzzy.test.ts, que trava as relações que
   importam (consecutivo > início de palavra espalhado, início de string >
   início de palavra, texto curto desempata). */
const SCORE_MATCH = 16;
const BONUS_CONSECUTIVE = 30; // "spa" em "spawn" > s..p..a espalhado
const BONUS_WORD_START = 22; // início de palavra
const BONUS_STRING_START = 24; // primeiro caractere do texto
const BONUS_CAMEL = 14; // maiúscula dentro de palavra: paneSpawn → S
const PENALTY_GAP_FIRST = -4; // abrir um buraco
const PENALTY_GAP_EXTRA = -1; // por caractere adicional pulado
const PENALTY_LEADING = -1; // por caractere antes do primeiro match
const MAX_LEADING_PENALTY = -12;

/** Custo de pular `gap` caracteres entre dois casamentos. */
function gapPenalty(gap: number): number {
  if (gap <= 0) return 0;
  return PENALTY_GAP_FIRST + (gap - 1) * PENALTY_GAP_EXTRA;
}

/** Separadores que iniciam uma "palavra" para efeito de bônus. */
const WORD_SEPARATORS = new Set([" ", "-", "_", ".", "/", ":", "(", "[", ","]);

function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true;
  return WORD_SEPARATORS.has(text[index - 1]);
}

function isCamelBoundary(text: string, index: number): boolean {
  if (index === 0) return false;
  const previous = text[index - 1];
  const current = text[index];
  return (
    current === current.toUpperCase() &&
    current !== current.toLowerCase() &&
    previous === previous.toLowerCase() &&
    previous !== previous.toUpperCase()
  );
}

/** Bônus posicional de casar o caractere em `index`. */
function positionBonus(text: string, index: number): number {
  if (index === 0) return BONUS_STRING_START;
  if (isWordStart(text, index)) return BONUS_WORD_START;
  if (isCamelBoundary(text, index)) return BONUS_CAMEL;
  return 0;
}

/**
 * Casa `query` contra `text`.
 *
 * Retorna null quando a query não é subsequência do texto. Query vazia casa
 * com tudo, score 0 — assim o palette mostra a lista inteira sem filtro.
 *
 * ── Por que programação dinâmica ────────────────────────────────────────
 *
 * A versão gulosa disto (varrer da esquerda, e ao achar um candidato que não
 * é início de palavra, pular para a próxima ocorrência que seja) tem um furo:
 * o salto pode consumir uma posição de que o resto da query precisava, e o
 * casamento falha inteiro. `fuzzyMatch("mem", "Memória compartilhada entre
 * agentes")` devolvia null — o "e" saltava para o "entre", e não sobrava "m"
 * depois dele.
 *
 * Escolher posição por posição é míope: a melhor posição para um caractere
 * depende de onde os seguintes vão conseguir cair. Então calculamos o
 * alinhamento ótimo de verdade.
 *
 * `best[i][j]` = melhor score casando os primeiros i+1 caracteres da query
 * com o caractere i em `text[j]`. Custo O(m·n) — a recorrência usaria O(m·n²)
 * por causa do max sobre todas as posições anteriores, mas como a penalidade
 * de buraco é linear dá para carregar o máximo corrente enquanto j avança.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  if (!query) return { score: 0, indices: [] };
  if (!text) return null;

  const needle = query.toLowerCase();
  const haystack = text.toLowerCase();

  const m = needle.length;
  const n = haystack.length;
  if (m > n) return null;

  const NEG = Number.NEGATIVE_INFINITY;

  // best[i][j] e o índice anterior escolhido, para reconstruir os índices.
  const best: number[][] = Array.from({ length: m }, () => new Array(n).fill(NEG));
  const parent: number[][] = Array.from({ length: m }, () => new Array(n).fill(-1));

  // Primeiro caractere: sem antecessor, só bônus de posição e penalidade por
  // começar fundo no texto (com teto, para não inviabilizar textos longos).
  for (let j = 0; j < n; j++) {
    if (haystack[j] !== needle[0]) continue;
    best[0][j] =
      SCORE_MATCH +
      positionBonus(text, j) +
      Math.max(MAX_LEADING_PENALTY, j * PENALTY_LEADING);
  }

  for (let i = 1; i < m; i++) {
    // Penalidade de buraco é linear: gap = j-k-1 custa
    //   PENALTY_GAP_FIRST + (gap-1)*PENALTY_GAP_EXTRA
    // Expandindo em j e k, a parte que depende de k é (best + k*|EXTRA|),
    // então basta carregar o máximo dela enquanto j avança.
    let runningBest = NEG;
    let runningBestIndex = -1;

    for (let j = i; j < n; j++) {
      const k = j - 1;
      if (best[i - 1][k] > NEG) {
        const candidate = best[i - 1][k] - k * PENALTY_GAP_EXTRA;
        if (candidate > runningBest) {
          runningBest = candidate;
          runningBestIndex = k;
        }
      }

      if (haystack[j] !== needle[i]) continue;

      const bonus = SCORE_MATCH + positionBonus(text, j);

      // Caso consecutivo: o caractere anterior casou exatamente em j-1.
      let score = NEG;
      let from = -1;
      if (best[i - 1][j - 1] > NEG) {
        score = best[i - 1][j - 1] + bonus + BONUS_CONSECUTIVE;
        from = j - 1;
      }

      // Caso com buraco: melhor antecessor em qualquer k < j-1.
      if (runningBestIndex !== -1 && runningBestIndex < j - 1) {
        const gapped =
          runningBest +
          (j - 1) * PENALTY_GAP_EXTRA +
          PENALTY_GAP_FIRST -
          PENALTY_GAP_EXTRA +
          bonus;
        if (gapped > score) {
          score = gapped;
          from = runningBestIndex;
        }
      }

      if (score > NEG) {
        best[i][j] = score;
        parent[i][j] = from;
      }
    }
  }

  // Melhor final entre todas as posições possíveis do último caractere.
  let finalScore = NEG;
  let finalIndex = -1;
  for (let j = m - 1; j < n; j++) {
    if (best[m - 1][j] > finalScore) {
      finalScore = best[m - 1][j];
      finalIndex = j;
    }
  }
  if (finalIndex === -1) return null;

  // Reconstrói os índices andando de trás para frente pelos ponteiros.
  const indices: number[] = new Array(m);
  let index = finalIndex;
  for (let i = m - 1; i >= 0; i--) {
    indices[i] = index;
    index = parent[i][index];
  }

  // Empate entre textos: o mais curto é o mais específico.
  return { score: finalScore - Math.floor(text.length / 12), indices };
}

/* ── Ranqueamento sobre vários campos ───────────────────────────────────── */

export interface RankedItem<T> {
  item: T;
  score: number;
  /** Índices casados no campo primário, para destaque. Vazio se casou por
   *  campo secundário (palavra-chave, grupo). */
  indices: number[];
}

export interface RankOptions<T> {
  /** Campo principal — o texto mostrado. Ganha peso total. */
  primary: (item: T) => string;
  /** Campos de apoio (subtítulo, palavras-chave, grupo). Peso reduzido:
   *  casar no que aparece na tela vale mais que casar em metadado. */
  secondary?: (item: T) => string[];
  /** Descarta resultados abaixo deste score. */
  threshold?: number;
}

const SECONDARY_WEIGHT = 0.5;

/**
 * Ordena itens por relevância contra a query.
 *
 * Estável: com scores iguais, mantém a ordem original — assim o palette pode
 * ordenar a lista base por prioridade e essa ordem sobrevive ao filtro.
 */
export function rankItems<T>(
  query: string,
  items: readonly T[],
  options: RankOptions<T>,
): RankedItem<T>[] {
  const { primary, secondary, threshold = 0 } = options;

  if (!query) {
    return items.map((item) => ({ item, score: 0, indices: [] }));
  }

  const ranked: (RankedItem<T> & { order: number })[] = [];

  items.forEach((item, order) => {
    const primaryMatch = fuzzyMatch(query, primary(item));

    let best = primaryMatch
      ? { score: primaryMatch.score, indices: primaryMatch.indices }
      : null;

    if (secondary) {
      for (const field of secondary(item)) {
        const match = fuzzyMatch(query, field);
        if (!match) continue;
        const weighted = match.score * SECONDARY_WEIGHT;
        // Campo secundário não produz destaque: os índices são de outro texto.
        if (!best || weighted > best.score) best = { score: weighted, indices: [] };
      }
    }

    if (best && best.score >= threshold) {
      ranked.push({ item, score: best.score, indices: best.indices, order });
    }
  });

  ranked.sort((a, b) => b.score - a.score || a.order - b.order);
  return ranked.map(({ item, score, indices }) => ({ item, score, indices }));
}

/**
 * Fatia um texto em trechos casados e não casados, para renderizar destaque
 * sem montar HTML na mão.
 */
export function highlightSegments(
  text: string,
  indices: readonly number[],
): { text: string; matched: boolean }[] {
  if (indices.length === 0) return [{ text, matched: false }];

  const segments: { text: string; matched: boolean }[] = [];
  const matched = new Set(indices);
  let buffer = "";
  let bufferMatched = matched.has(0);

  for (let i = 0; i < text.length; i++) {
    const isMatched = matched.has(i);
    if (isMatched !== bufferMatched) {
      if (buffer) segments.push({ text: buffer, matched: bufferMatched });
      buffer = "";
      bufferMatched = isMatched;
    }
    buffer += text[i];
  }
  if (buffer) segments.push({ text: buffer, matched: bufferMatched });

  return segments;
}
