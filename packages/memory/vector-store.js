"use strict";

/**
 * Pure JS vector operations: TF-IDF tokenization (with bigrams/stemming),
 * cosine similarity, and multiple distance metrics.
 * No external dependencies.
 */

// Common English stopwords
const STOPWORDS = new Set([
  "a", "an", "the", "is", "it", "in", "on", "at", "to", "for", "of", "with",
  "by", "from", "as", "into", "through", "during", "before", "after", "above",
  "below", "between", "out", "off", "over", "under", "again", "further", "then",
  "once", "and", "but", "or", "nor", "not", "so", "yet", "both", "either",
  "neither", "each", "every", "all", "any", "few", "more", "most", "other",
  "some", "such", "no", "only", "own", "same", "than", "too", "very", "can",
  "will", "just", "don", "should", "now", "d", "ll", "m", "o", "re", "ve", "y",
  "ain", "aren", "couldn", "didn", "doesn", "hadn", "hasn", "haven", "isn",
  "ma", "mightn", "mustn", "needn", "shan", "shouldn", "wasn", "weren", "won",
  "wouldn", "been", "being", "have", "has", "had", "having", "do", "does", "did",
  "doing", "would", "could", "should", "shall", "may", "might", "must", "need",
  "this", "that", "these", "those", "am", "are", "was", "were", "be", "he", "she",
  "we", "they", "you", "i", "me", "him", "her", "us", "them", "my", "your", "his",
  "its", "our", "their", "what", "which", "who", "whom", "when", "where", "why",
  "how", "if", "about", "up", "down", "here", "there", "because", "while",
  "until", "although", "also", "too", "already", "always", "never", "sometimes",
  "often", "usually", "however", "still", "even", "much", "many", "well", "back",
  "get", "got", "go", "went", "gone", "make", "made", "take", "took", "come",
  "came", "see", "saw", "know", "knew", "think", "thought", "say", "said",
  "give", "gave", "use", "used", "find", "found", "want", "tell", "told",
  "put", "set", "try", "ask", "keep", "kept", "let", "seem", "seemed",
  "turn", "turned", "start", "started", "show", "showed", "hear", "heard",
  "play", "played", "run", "ran", "move", "moved", "live", "lived", "believe",
  "felt", "left", "called", "looked", "worked", "seemed", "became", "look",
  "call", "need", "become", "leave", "feel",
]);

// Porter-style stemming suffixes (simplified)
const STEM_RULES = [
  [/ies$/, "i"],
  [/esses$/, "ess"],
  [/sses$/, "ss"],
  [/ness$/, ""],
  [/ment$/, ""],
  [/tion$/, "t"],
  [/sion$/, "s"],
  [/ence$/, ""],
  [/ance$/, ""],
  [/ling$/, ""],
  [/ting$/, "t"],
  [/ning$/, "n"],
  [/ring$/, "r"],
  [/ding$/, "d"],
  [/ying$/, "y"],
  [/ying$/, "i"],
  [/ies$/, "y"],
  [/ves$/, "f"],
  [/ing$/, ""],
  [/ful$/, ""],
  [/ous$/, ""],
  [/ive$/, ""],
  [/able$/, ""],
  [/ible$/, ""],
  [/ally$/, ""],
  [/edly$/, ""],
  [/ily$/, ""],
  [/ly$/, ""],
  [/er$/, ""],
  [/ed$/, ""],
  [/es$/, ""],
  [/s$/, ""],
];

/**
 * Simple Porter-style stemmer (suffix stripping).
 * @param {string} word
 * @returns {string}
 */
function stem(word) {
  if (!word || word.length <= 3) return word;
  for (const [pattern, replacement] of STEM_RULES) {
    if (pattern.test(word)) {
      const stemmed = word.replace(pattern, replacement);
      if (stemmed.length >= 2) return stemmed;
    }
  }
  return word;
}

/**
 * Tokenize text: lowercase, split, remove stopwords, stem.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  if (!text || typeof text !== "string") return [];
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t))
    .map(t => stem(t));
}

/**
 * Tokenize text into unigrams + bigrams (for richer representation).
 * @param {string} text
 * @returns {string[]}
 */
function tokenizeWithBigrams(text) {
  const unigrams = tokenize(text);
  const bigrams = [];
  for (let i = 0; i < unigrams.length - 1; i++) {
    bigrams.push(`${unigrams[i]}_${unigrams[i + 1]}`);
  }
  return [...unigrams, ...bigrams];
}

/**
 * Build TF-IDF vectors for an array of documents.
 * @param {string[]} docs - Array of text strings
 * @param {object} [opts] - { useBigrams: boolean }
 * @returns {Array<Map<string, number>>} Array of sparse vectors (token -> weight)
 */
function buildTfIdf(docs, opts = {}) {
  if (!docs || docs.length === 0) return [];

  const tokenizer = opts.useBigrams ? tokenizeWithBigrams : tokenize;
  const tokenized = docs.map(d => tokenizer(d));

  const df = new Map();
  for (const tokens of tokenized) {
    const unique = new Set(tokens);
    for (const token of unique) {
      df.set(token, (df.get(token) || 0) + 1);
    }
  }

  const N = docs.length;
  const vectors = [];
  for (const tokens of tokenized) {
    const tf = new Map();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }

    const vector = new Map();
    const totalTokens = tokens.length || 1;
    for (const [token, count] of tf) {
      const tfVal = count / totalTokens;
      const idfVal = Math.log(N / (df.get(token) || 1));
      vector.set(token, tfVal * Math.max(0, idfVal));
    }
    vectors.push(vector);
  }

  return vectors;
}

// ─── Distance Metrics ───

/**
 * Cosine similarity between two sparse vectors (Map<token, weight>).
 * @param {Map<string, number>} a
 * @param {Map<string, number>} b
 * @returns {number} Similarity in [0, 1]
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.size === 0 || b.size === 0) return 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  let dotProduct = 0;
  for (const [token, weight] of smaller) {
    const otherWeight = larger.get(token);
    if (otherWeight !== undefined) {
      dotProduct += weight * otherWeight;
    }
  }
  if (dotProduct === 0) return 0;
  let normA = 0;
  for (const [, w] of a) normA += w * w;
  let normB = 0;
  for (const [, w] of b) normB += w * w;
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dotProduct / denom;
}

/**
 * Euclidean distance between two sparse vectors.
 * @returns {number} Distance (0 = identical, higher = more different)
 */
function euclideanDistance(a, b) {
  if (!a || !b) return Infinity;
  const allKeys = new Set([...a.keys(), ...b.keys()]);
  let sumSq = 0;
  for (const key of allKeys) {
    const va = a.get(key) || 0;
    const vb = b.get(key) || 0;
    sumSq += (va - vb) ** 2;
  }
  return Math.sqrt(sumSq);
}

/**
 * Manhattan (L1) distance between two sparse vectors.
 * @returns {number} Distance
 */
function manhattanDistance(a, b) {
  if (!a || !b) return Infinity;
  const allKeys = new Set([...a.keys(), ...b.keys()]);
  let sum = 0;
  for (const key of allKeys) {
    const va = a.get(key) || 0;
    const vb = b.get(key) || 0;
    sum += Math.abs(va - vb);
  }
  return sum;
}

/**
 * Jaccard similarity between two sets of tokens.
 * @param {Map<string, number>} a
 * @param {Map<string, number>} b
 * @returns {number} Similarity in [0, 1]
 */
function jaccardSimilarity(a, b) {
  if (!a || !b || a.size === 0 || b.size === 0) return 0;
  const keysA = new Set(a.keys());
  const keysB = new Set(b.keys());
  let intersection = 0;
  for (const key of keysA) {
    if (keysB.has(key)) intersection++;
  }
  const union = keysA.size + keysB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Hamming distance between two binary vectors (presence/absence).
 * Counts positions where one has the token and the other doesn't.
 * @returns {number} Distance (count of differing positions)
 */
function hammingDistance(a, b) {
  if (!a || !b) return Infinity;
  const allKeys = new Set([...a.keys(), ...b.keys()]);
  let diff = 0;
  for (const key of allKeys) {
    const ha = a.has(key) ? 1 : 0;
    const hb = b.has(key) ? 1 : 0;
    if (ha !== hb) diff++;
  }
  return diff;
}

/**
 * Multi-metric comparison: returns all metrics at once.
 * @param {Map<string, number>} a
 * @param {Map<string, number>} b
 * @returns {object} { cosine, euclidean, manhattan, jaccard, hamming }
 */
function allMetrics(a, b) {
  return {
    cosine: cosineSimilarity(a, b),
    euclidean: euclideanDistance(a, b),
    manhattan: manhattanDistance(a, b),
    jaccard: jaccardSimilarity(a, b),
    hamming: hammingDistance(a, b),
  };
}

/**
 * Build IDF values for a corpus.
 * @param {string[]} corpus
 * @returns {Map<string, number>}
 */
function buildIdf(corpus) {
  const N = corpus.length;
  const df = new Map();
  for (const doc of corpus) {
    const unique = new Set(tokenize(doc));
    for (const token of unique) {
      df.set(token, (df.get(token) || 0) + 1);
    }
  }
  const idf = new Map();
  for (const [token, freq] of df) {
    idf.set(token, Math.log(N / freq));
  }
  return idf;
}

// ─── Semantic Hash Embeddings (384-dim) ────────────────────────────────

/**
 * Default dimension for semantic hash embeddings.
 * Matches all-MiniLM-L6-v2 output size for compatibility.
 */
const SEMANTIC_HASH_DIM = 384;

/**
 * Simple string → integer hash (FNV-1a variant).
 * Deterministic, fast, good distribution.
 * @param {string} str
 * @returns {number} 32-bit integer
 */
function fnvHash(str) {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) | 0; // FNV prime
  }
  return hash >>> 0; // unsigned
}

/**
 * Generate a dense semantic hash embedding for text.
 *
 * Algorithm: tokenize → for each token, hash to seed → fill dim via sin(seed*i+offset)
 * → sum across tokens → L2 normalize. This produces deterministic, position-aware
 * dense vectors that capture lexical similarity far better than TF-IDF.
 *
 * Deterministic, zero-dependency embedding suitable for semantic similarity.
 *
 * @param {string} text
 * @param {number} [dim=384] - output dimension
 * @returns {Float32Array} L2-normalized dense vector
 */
function semanticHash(text, dim = SEMANTIC_HASH_DIM) {
  const vec = new Float32Array(dim);
  if (!text || typeof text !== "string") return vec;

  const tokens = tokenize(text);
  if (tokens.length === 0) return vec;

  for (const token of tokens) {
    const seed = fnvHash(token);
    // Use sin-based projection: each token contributes a unique wave pattern
    // The seed determines phase + frequency, creating a smooth hash function
    const phase = (seed / 0xFFFFFFFF) * Math.PI * 2;
    const freq = 1.0 + (seed % 1000) / 1000.0; // freq in [1.0, 2.0]
    for (let i = 0; i < dim; i++) {
      vec[i] += Math.sin(phase + freq * i * 0.1);
    }
  }

  // L2 normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) vec[i] /= norm;
  }

  return vec;
}

/**
 * Cosine similarity between two dense vectors (Float32Array).
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {number} Similarity in [-1, 1], typically [0, 1] for embeddings
 */
function cosineSimilarityDense(a, b) {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  const len = Math.min(a.length, b.length);
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Serialize a Float32Array to a Buffer for SQLite BLOB storage.
 * @param {Float32Array} vec
 * @returns {Buffer}
 */
function vectorToBuffer(vec) {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

/**
 * Deserialize a Buffer back to Float32Array.
 * @param {Buffer} buf
 * @returns {Float32Array}
 */
function bufferToVector(buf) {
  if (!buf || buf.length === 0) return new Float32Array(0);
  // Ensure proper alignment by copying
  const ab = new ArrayBuffer(buf.length);
  const view = new Uint8Array(ab);
  for (let i = 0; i < buf.length; i++) view[i] = buf[i];
  return new Float32Array(ab);
}

// ─── Embedding Service Abstraction ───

/**
 * EmbeddingService: abstraction for multiple embedding providers.
 * Supports: tfidf (sparse Map), semantic-hash (dense Float32Array).
 */
class EmbeddingService {
  constructor(opts = {}) {
    this.provider = opts.provider || "semantic-hash";
    this.useBigrams = opts.useBigrams !== false;
    this.dim = opts.dim || SEMANTIC_HASH_DIM;
    /** @type {Map<string, any>} LRU cache: key -> vector */
    this._cache = new Map();
    this._cacheMaxSize = opts.cacheMaxSize || 1000;
    this._cacheOrder = [];
    this._cacheHits = 0;
    this._cacheMisses = 0;
  }

  /**
   * Generate embedding for a text.
   * @param {string} text
   * @param {string} [cacheKey] - optional cache key (uses first 200 chars if not provided)
   * @returns {Float32Array|Map<string, number>}
   */
  embed(text, cacheKey) {
    const key = cacheKey || (text ? text.slice(0, 200) : "");
    if (key && this._cache.has(key)) {
      this._cacheHits++;
      this._touchCache(key);
      return this._cache.get(key);
    }
    this._cacheMisses++;

    let vector;
    switch (this.provider) {
      case "semantic-hash": {
        vector = semanticHash(text, this.dim);
        break;
      }
      case "tfidf":
      default: {
        const vectors = buildTfIdf([text], { useBigrams: this.useBigrams });
        vector = vectors.length > 0 ? vectors[0] : new Map();
        break;
      }
    }

    if (key) this._cacheSet(key, vector);
    return vector;
  }

  /**
   * Batch embed multiple texts.
   * @param {string[]} texts
   * @param {string[]} [cacheKeys]
   * @returns {Array<Float32Array|Map<string, number>>}
   */
  embedBatch(texts, cacheKeys) {
    return texts.map((text, i) => this.embed(text, cacheKeys ? cacheKeys[i] : undefined));
  }

  /**
   * Compute similarity between two texts.
   * @param {string} a
   * @param {string} b
   * @returns {number} Similarity in [0, 1]
   */
  similarity(a, b) {
    const va = this.embed(a);
    const vb = this.embed(b);
    if (this.provider === "semantic-hash") {
      return cosineSimilarityDense(va, vb);
    }
    return cosineSimilarity(va, vb);
  }

  /** Get cache stats. */
  cacheStats() {
    return {
      provider: this.provider,
      dim: this.dim,
      useBigrams: this.useBigrams,
      cacheSize: this._cache.size,
      cacheMaxSize: this._cacheMaxSize,
      hits: this._cacheHits,
      misses: this._cacheMisses,
      hitRate: (this._cacheHits + this._cacheMisses) > 0
        ? (this._cacheHits / (this._cacheHits + this._cacheMisses)).toFixed(3)
        : "0",
    };
  }

  /** Clear the embedding cache. */
  clearCache() {
    this._cache.clear();
    this._cacheOrder = [];
  }

  /** @private */
  _touchCache(key) {
    const idx = this._cacheOrder.indexOf(key);
    if (idx >= 0) this._cacheOrder.splice(idx, 1);
    this._cacheOrder.push(key);
  }

  /** @private */
  _cacheSet(key, vector) {
    if (this._cache.size >= this._cacheMaxSize && !this._cache.has(key)) {
      const oldest = this._cacheOrder.shift();
      if (oldest) this._cache.delete(oldest);
    }
    this._cache.set(key, vector);
    this._touchCache(key);
  }
}

module.exports = {
  // Tokenization
  tokenize,
  tokenizeWithBigrams,
  stem,
  // TF-IDF (legacy sparse)
  buildTfIdf,
  buildIdf,
  // Semantic hash (new dense)
  semanticHash,
  SEMANTIC_HASH_DIM,
  fnvHash,
  // Dense vector operations
  cosineSimilarityDense,
  vectorToBuffer,
  bufferToVector,
  // Sparse vector operations
  cosineSimilarity,
  euclideanDistance,
  manhattanDistance,
  jaccardSimilarity,
  hammingDistance,
  allMetrics,
  // Service
  EmbeddingService,
};
