"use strict";

/**
 * Knowledge graph with HNSW-like ANN index, PageRank, community detection,
 * graph-aware search, Pathfinder algorithm, LRU embedding cache, and
 * multiple distance metrics.
 */

const {
  buildTfIdf, cosineSimilarity, euclideanDistance, manhattanDistance,
  jaccardSimilarity, hammingDistance, allMetrics, EmbeddingService,
  cosineSimilarityDense, vectorToBuffer, bufferToVector, semanticHash,
} = require("./vector-store.js");

// ─── BoundedSet for dedup (100K max) ───
class BoundedSet {
  constructor(maxSize = 100000) {
    this._set = new Set();
    this._maxSize = maxSize;
    this._order = [];
  }
  has(key) { return this._set.has(key); }
  add(key) {
    if (this._set.has(key)) return;
    if (this._set.size >= this._maxSize) {
      const oldest = this._order.shift();
      if (oldest) this._set.delete(oldest);
    }
    this._set.add(key);
    this._order.push(key);
  }
  get size() { return this._set.size; }
  clear() { this._set.clear(); this._order = []; }
}

// ─── HNSW-like Approximate Nearest Neighbor Index ───
// Pure JS implementation: layered navigable small world graph.
// Each node has connections at multiple layers. Search is greedy with beam width.
class HNSWIndex {
  constructor(opts = {}) {
    this.maxM = opts.maxM || 16;             // Max connections per node per layer
    this.efConstruction = opts.efConstruction || 200;  // Beam width during construction
    this.efSearch = opts.efSearch || 50;     // Beam width during search
    this.ml = opts.ml || 1.0 / Math.log(2.0); // Level generation factor
    this.maxLevel = 0;
    this.entryPoint = null;

    // Nodes: id -> { vector, level, connections: Map<level, Set<neighborId>> }
    this.nodes = new Map();
    this._dedup = new BoundedSet(100000);
  }

  /**
   * Add a node with its vector to the index.
   * @param {string} id
   * @param {Map<string, number>} vector
   * @param {Function} distFn - distance function(a, b) → number (lower = closer)
   */
  insert(id, vector, distFn) {
    if (this.nodes.has(id)) {
      // Update vector
      const node = this.nodes.get(id);
      node.vector = vector;
      return;
    }

    const level = this._randomLevel();
    const node = { id, vector, level, connections: new Map() };
    this.nodes.set(id, node);

    // Initialize connections for each level
    for (let l = 0; l <= level; l++) {
      node.connections.set(l, new Set());
    }

    if (this.entryPoint === null) {
      this.entryPoint = id;
      this.maxLevel = level;
      return;
    }

    // Greedy search from top level down to level+1
    let currNearest = [this.entryPoint];
    let currDist = distFn(vector, this._getVector(this.entryPoint));

    for (let l = this.maxLevel; l > level; l--) {
      const nearest = this._searchLayer(vector, currNearest, 1, l, distFn);
      currNearest = nearest.length > 0 ? nearest : currNearest;
    }

    // For levels 0..level, search and connect
    for (let l = Math.min(level, this.maxLevel); l >= 0; l--) {
      const candidates = this._searchLayer(vector, currNearest, this.efConstruction, l, distFn);
      const neighbors = this._selectNeighbors(candidates, this.maxM, vector, distFn);

      for (const neighborId of neighbors) {
        this._addConnection(id, neighborId, l);
        this._addConnection(neighborId, id, l);

        // Prune neighbor's connections if over maxM
        const neighbor = this.nodes.get(neighborId);
        if (neighbor) {
          const nConns = neighbor.connections.get(l);
          if (nConns && nConns.size > this.maxM) {
            const pruned = this._selectNeighbors([...nConns], this.maxM, neighbor.vector, distFn);
            neighbor.connections.set(l, new Set(pruned));
          }
        }
      }
      currNearest = candidates;
    }

    if (level > this.maxLevel) {
      this.maxLevel = level;
      this.entryPoint = id;
    }
  }

  /**
   * Search for k nearest neighbors to a query vector.
   * @param {Map<string, number>} query
   * @param {number} k
   * @param {Function} distFn
   * @returns {Array<{id: string, distance: number}>}
   */
  search(query, k, distFn) {
    if (!this.entryPoint || this.nodes.size === 0) return [];

    let currNearest = [this.entryPoint];

    // Top-down greedy
    for (let l = this.maxLevel; l > 0; l--) {
      const nearest = this._searchLayer(query, currNearest, 1, l, distFn);
      currNearest = nearest.length > 0 ? nearest : currNearest;
    }

    // At level 0, search with efSearch
    const results = this._searchLayer(query, currNearest, Math.max(this.efSearch, k), 0, distFn);
    return results.slice(0, k).map(id => ({
      id,
      distance: distFn(query, this._getVector(id)),
    }));
  }

  get size() { return this.nodes.size; }

  /** @private */
  _getVector(id) {
    const node = this.nodes.get(id);
    return node ? node.vector : new Map();
  }

  /** @private */
  _randomLevel() {
    let level = 0;
    while (Math.random() < 0.5 && level < 16) level++;
    return level;
  }

  /** @private */
  _searchLayer(query, entryPoints, ef, layer, distFn) {
    const visited = new Set(entryPoints);
    const candidates = []; // [{id, dist}] sorted by dist ascending
    const results = [];    // [{id, dist}] sorted by dist ascending, max ef

    // Initialize
    for (const ep of entryPoints) {
      const d = distFn(query, this._getVector(ep));
      candidates.push({ id: ep, dist: d });
      results.push({ id: ep, dist: d });
    }
    candidates.sort((a, b) => a.dist - b.dist);
    results.sort((a, b) => a.dist - b.dist);

    while (candidates.length > 0) {
      const curr = candidates.shift();
      const farthestResult = results.length > 0 ? results[results.length - 1] : null;

      if (farthestResult && curr.dist > farthestResult.dist) break;

      const node = this.nodes.get(curr.id);
      if (!node) continue;

      const conns = node.connections.get(layer);
      if (!conns) continue;

      for (const neighborId of conns) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);

        const d = distFn(query, this._getVector(neighborId));
        const farthest = results.length >= ef ? results[results.length - 1] : null;

        if (!farthest || d < farthest.dist) {
          candidates.push({ id: neighborId, dist: d });
          candidates.sort((a, b) => a.dist - b.dist);
          results.push({ id: neighborId, dist: d });
          results.sort((a, b) => a.dist - b.dist);
          if (results.length > ef) results.pop();
        }
      }
    }

    return results.map(r => r.id);
  }

  /** @private */
  _selectNeighbors(candidateIds, maxM, queryVector, distFn) {
    const scored = candidateIds
      .map(id => ({ id, dist: distFn(queryVector, this._getVector(id)) }))
      .sort((a, b) => a.dist - b.dist);
    return scored.slice(0, maxM).map(s => s.id);
  }

  /** @private */
  _addConnection(fromId, toId, level) {
    const node = this.nodes.get(fromId);
    if (!node) return;
    if (!node.connections.has(level)) node.connections.set(level, new Set());
    node.connections.get(level).add(toId);
  }
}

// ─── KnowledgeGraph ───

class KnowledgeGraph {
  /**
   * @param {import("better-sqlite3").Database} db - better-sqlite3 instance
   */
  constructor(db) {
    this.db = db;
    this._ensureSchema();

    // Embedding service with LRU cache — semantic hash for dense 384-dim vectors
    this.embeddingService = new EmbeddingService({ provider: "semantic-hash", cacheMaxSize: 2000 });

    // HNSW index (rebuilt lazily from vectors table)
    this.hnsw = new HNSWIndex({ maxM: 16, efConstruction: 200, efSearch: 50 });
    this._hnswDirty = true; // needs rebuild
  }

  _ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS graph_nodes (
        memory_id   TEXT PRIMARY KEY,
        metadata    TEXT DEFAULT '{}',
        created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE IF NOT EXISTS graph_edges (
        id          TEXT PRIMARY KEY,
        from_id     TEXT NOT NULL,
        to_id       TEXT NOT NULL,
        edge_type   TEXT NOT NULL CHECK(edge_type IN ('reference','similar','temporal','co_accessed')),
        weight      REAL DEFAULT 1.0,
        created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        UNIQUE(from_id, to_id, edge_type)
      );

      CREATE INDEX IF NOT EXISTS idx_graph_edges_from ON graph_edges(from_id);
      CREATE INDEX IF NOT EXISTS idx_graph_edges_to   ON graph_edges(to_id);
      CREATE INDEX IF NOT EXISTS idx_graph_edges_type ON graph_edges(edge_type);

      CREATE TABLE IF NOT EXISTS memory_vectors (
        memory_id TEXT PRIMARY KEY,
        vector    TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS graph_community (
        memory_id  TEXT PRIMARY KEY,
        community  INTEGER NOT NULL DEFAULT 0
      );
    `);

    this._stmts = {
      insertNode: this.db.prepare(
        "INSERT OR REPLACE INTO graph_nodes (memory_id, metadata, created_at) VALUES (?, ?, ?)"
      ),
      deleteNode: this.db.prepare("DELETE FROM graph_nodes WHERE memory_id = ?"),
      deleteEdgesFrom: this.db.prepare("DELETE FROM graph_edges WHERE from_id = ?"),
      deleteEdgesTo: this.db.prepare("DELETE FROM graph_edges WHERE to_id = ?"),
      insertEdge: this.db.prepare(
        "INSERT OR IGNORE INTO graph_edges (id, from_id, to_id, edge_type, weight, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ),
      getEdgesFrom: this.db.prepare("SELECT * FROM graph_edges WHERE from_id = ?"),
      getEdgesTo: this.db.prepare("SELECT * FROM graph_edges WHERE to_id = ?"),
      getEdgesBetween: this.db.prepare(
        "SELECT * FROM graph_edges WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)"
      ),
      allNodes: this.db.prepare("SELECT memory_id, metadata FROM graph_nodes"),
      allEdges: this.db.prepare("SELECT from_id, to_id, weight FROM graph_edges"),
      insertVector: this.db.prepare(
        "INSERT OR REPLACE INTO memory_vectors (memory_id, vector) VALUES (?, ?)"
      ),
      getVector: this.db.prepare("SELECT vector FROM memory_vectors WHERE memory_id = ?"),
      allVectors: this.db.prepare("SELECT memory_id, vector FROM memory_vectors"),
      upsertCommunity: this.db.prepare(
        "INSERT OR REPLACE INTO graph_community (memory_id, community) VALUES (?, ?)"
      ),
      getCommunity: this.db.prepare("SELECT community FROM graph_community WHERE memory_id = ?"),
      nodeCount: this.db.prepare("SELECT COUNT(*) as count FROM graph_nodes"),
    };
  }

  // ─── Node/Edge CRUD ───

  addNode(memoryId, metadata = {}) {
    this._stmts.insertNode.run(memoryId, JSON.stringify(metadata), Date.now());
    this._hnswDirty = true;
  }

  addEdge(fromId, toId, edgeType = "reference", weight = 1.0) {
    if (fromId === toId) return;
    const id = `edge_${fromId}_${toId}_${edgeType}`;
    this._stmts.insertEdge.run(id, fromId, toId, edgeType, weight, Date.now());
  }

  removeNode(memoryId) {
    this._stmts.deleteEdgesFrom.run(memoryId);
    this._stmts.deleteEdgesTo.run(memoryId);
    this._stmts.deleteNode.run(memoryId);
    this._hnswDirty = true;
  }

  getNeighbors(memoryId, edgeType) {
    const outEdges = this._stmts.getEdgesFrom.all(memoryId);
    const inEdges = this._stmts.getEdgesTo.all(memoryId);
    const neighbors = [];
    for (const e of outEdges) {
      if (edgeType && e.edge_type !== edgeType) continue;
      neighbors.push({ memoryId: e.to_id, edgeType: e.edge_type, weight: e.weight, direction: "out" });
    }
    for (const e of inEdges) {
      if (edgeType && e.edge_type !== edgeType) continue;
      neighbors.push({ memoryId: e.from_id, edgeType: e.edge_type, weight: e.weight, direction: "in" });
    }
    return neighbors;
  }

  // ─── PageRank ───

  pageRank(iterations = 20, dampingFactor = 0.85) {
    const nodes = this._stmts.allNodes.all();
    const N = nodes.length;
    if (N === 0) return new Map();

    const ranks = new Map();
    for (const n of nodes) ranks.set(n.memory_id, 1.0 / N);

    const outDegree = new Map();
    const inLinks = new Map();
    const edges = this._stmts.allEdges.all();

    for (const e of edges) {
      outDegree.set(e.from_id, (outDegree.get(e.from_id) || 0) + 1);
      if (!inLinks.has(e.to_id)) inLinks.set(e.to_id, []);
      inLinks.get(e.to_id).push({ fromId: e.from_id, weight: e.weight });
    }

    for (let iter = 0; iter < iterations; iter++) {
      const newRanks = new Map();
      let danglingSum = 0;
      for (const n of nodes) {
        if (!outDegree.has(n.memory_id)) danglingSum += ranks.get(n.memory_id) || 0;
      }
      for (const n of nodes) {
        let sum = 0;
        const links = inLinks.get(n.memory_id) || [];
        for (const link of links) {
          const outD = outDegree.get(link.fromId) || 1;
          sum += ((ranks.get(link.fromId) || 0) / outD) * link.weight;
        }
        const newRank = (1 - dampingFactor) / N + dampingFactor * (sum + danglingSum / N);
        newRanks.set(n.memory_id, newRank);
      }
      for (const [k, v] of newRanks) ranks.set(k, v);
    }
    return ranks;
  }

  // ─── Community Detection ───

  communityDetection(maxIterations = 10) {
    const nodes = this._stmts.allNodes.all();
    const labels = new Map();
    nodes.forEach((n, i) => labels.set(n.memory_id, i));

    for (let iter = 0; iter < maxIterations; iter++) {
      let changed = false;
      for (const node of nodes) {
        const neighbors = this.getNeighbors(node.memory_id);
        if (neighbors.length === 0) continue;
        const counts = new Map();
        for (const nb of neighbors) {
          const lbl = labels.get(nb.memoryId);
          if (lbl === undefined) continue;
          counts.set(lbl, (counts.get(lbl) || 0) + nb.weight);
        }
        let maxLabel = labels.get(node.memory_id);
        let maxCount = 0;
        for (const [lbl, cnt] of counts) {
          if (cnt > maxCount) { maxCount = cnt; maxLabel = lbl; }
        }
        if (maxLabel !== labels.get(node.memory_id)) {
          labels.set(node.memory_id, maxLabel);
          changed = true;
        }
      }
      if (!changed) break;
    }

    const tx = this.db.transaction(() => {
      for (const [mid, comm] of labels) this._stmts.upsertCommunity.run(mid, comm);
    });
    tx();
    return labels;
  }

  // ─── Graph-aware Search ───

  graphAwareSearch(query, textResults) {
    if (!textResults || textResults.length === 0) return [];
    const pageRanks = this.pageRank();
    return textResults
      .map(r => {
        const textScore = r._score || 0.5;
        const pr = pageRanks.get(r.id) || 0;
        return { ...r, combinedScore: 0.7 * textScore + 0.3 * pr, pageRank: pr };
      })
      .sort((a, b) => b.combinedScore - a.combinedScore);
  }

  // ─── Graph Info ───

  getMemoryGraph(memoryId) {
    const node = this.db.prepare(
      "SELECT memory_id, metadata, created_at FROM graph_nodes WHERE memory_id = ?"
    ).get(memoryId);
    if (!node) return null;

    const neighbors = this.getNeighbors(memoryId);
    const community = this._stmts.getCommunity.get(memoryId);

    return {
      memoryId: node.memory_id,
      metadata: JSON.parse(node.metadata || "{}"),
      createdAt: node.created_at,
      community: community ? community.community : null,
      neighbors: neighbors.map(n => ({
        memoryId: n.memoryId, edgeType: n.edgeType, weight: n.weight, direction: n.direction,
      })),
    };
  }

  // ─── Similarity Search (uses HNSW when available) ───

  /**
   * Load a vector from DB row, handling both BLOB (dense Float32Array) and JSON (sparse Map).
   * @private
   */
  _loadVector(row) {
    const raw = row.vector;
    if (!raw) return null;
    // Buffer/BLOB → dense Float32Array
    if (Buffer.isBuffer(raw)) {
      return bufferToVector(raw);
    }
    // String → legacy sparse Map
    if (typeof raw === "string") {
      return new Map(Object.entries(JSON.parse(raw)));
    }
    return null;
  }

  /**
   * Get the appropriate distance function for a vector type.
   * @private
   */
  _getDistFn(vec) {
    if (vec instanceof Float32Array) {
      return (a, b) => 1 - cosineSimilarityDense(a, b);
    }
    return (a, b) => 1 - cosineSimilarity(a, b);
  }

  /**
   * Get the appropriate cosine similarity function for a vector type.
   * @private
   */
  _getSimFn(vec) {
    if (vec instanceof Float32Array) {
      return cosineSimilarityDense;
    }
    return cosineSimilarity;
  }

  findSimilar(memoryId, limit = 10) {
    const vecRow = this._stmts.getVector.get(memoryId);
    if (!vecRow) return [];

    const targetVec = this._loadVector(vecRow);
    if (!targetVec) return [];

    // Try HNSW first for large datasets
    if (this.nodes.size > 100 || this._shouldUseHnsw()) {
      return this._findSimilarHnsw(memoryId, targetVec, limit);
    }

    // Fallback: brute force
    const simFn = this._getSimFn(targetVec);
    const allVecs = this._stmts.allVectors.all();
    const results = [];
    for (const row of allVecs) {
      if (row.memory_id === memoryId) continue;
      const vec = this._loadVector(row);
      if (!vec) continue;
      const sim = simFn(targetVec, vec);
      if (sim > 0.01) {
        results.push({ memoryId: row.memory_id, similarity: Math.round(sim * 1000) / 1000 });
      }
    }
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit);
  }

  /**
   * HNSW-accelerated similarity search.
   * @private
   */
  _findSimilarHnsw(memoryId, targetVec, limit) {
    this._rebuildHnswIfNeeded();

    const distFn = this._getDistFn(targetVec);
    const results = this.hnsw.search(targetVec, limit + 1, distFn);

    return results
      .filter(r => r.id !== memoryId)
      .map(r => ({ memoryId: r.id, similarity: Math.round((1 - r.distance) * 1000) / 1000 }))
      .filter(r => r.similarity > 0.01)
      .slice(0, limit);
  }

  /** @private */
  _shouldUseHnsw() {
    const vectorCount = this._stmts.nodeCount.get().count;
    return vectorCount > 50; // Use HNSW for 50+ vectors
  }

  /** @private */
  _rebuildHnswIfNeeded() {
    if (!this._hnswDirty && this.hnsw.size > 0) return;

    this.hnsw = new HNSWIndex({ maxM: 16, efConstruction: 200, efSearch: 50 });

    const allVecs = this._stmts.allVectors.all();
    // Detect format from first vector
    let isDense = false;
    if (allVecs.length > 0) {
      const first = this._loadVector(allVecs[0]);
      isDense = first instanceof Float32Array;
    }
    const distFn = isDense
      ? (a, b) => 1 - cosineSimilarityDense(a, b)
      : (a, b) => 1 - cosineSimilarity(a, b);

    for (const row of allVecs) {
      const vec = this._loadVector(row);
      if (vec) this.hnsw.insert(row.memory_id, vec, distFn);
    }

    this._hnswDirty = false;
  }

  // ─── Vector Storage ───

  storeVector(memoryId, content) {
    if (!content) return;
    // Use embedding service (with LRU cache)
    const vector = this.embeddingService.embed(content, memoryId);
    if (!vector) return;

    // Dense Float32Array (semantic-hash) → store as BLOB
    if (vector instanceof Float32Array) {
      if (vector.length > 0) {
        const buf = vectorToBuffer(vector);
        this._stmts.insertVector.run(memoryId, buf);
        this._hnswDirty = true;
      }
    }
    // Sparse Map (tfidf legacy) → store as JSON
    else if (vector instanceof Map && vector.size > 0) {
      const vectorObj = Object.fromEntries(vector);
      this._stmts.insertVector.run(memoryId, JSON.stringify(vectorObj));
      this._hnswDirty = true;
    }
  }

  createSimilarEdges(memoryId, threshold = 0.3) {
    const similar = this.findSimilar(memoryId, 5);
    for (const s of similar) {
      if (s.similarity >= threshold) {
        this.addEdge(memoryId, s.memoryId, "similar", s.similarity);
      }
    }
  }

  // ─── Pathfinder Algorithm ───

  /**
   * Pathfinder: explore the graph from a seed memory, expanding via edges.
   * Returns memories within a given depth that score above a relevance threshold.
   * @param {string} seedId - Starting memory ID
   * @param {object} [opts] - { maxDepth, threshold, limit, edgeTypes }
   * @returns {Array<{memoryId: string, depth: number, path: string[], relevance: number}>}
   */
  pathfinder(seedId, opts = {}) {
    const maxDepth = opts.maxDepth || 3;
    const threshold = opts.threshold || 0.3;
    const limit = opts.limit || 20;
    const edgeTypes = opts.edgeTypes || null; // null = all types

    const seedNode = this.db.prepare(
      "SELECT memory_id FROM graph_nodes WHERE memory_id = ?"
    ).get(seedId);
    if (!seedNode) return [];

    // BFS with depth tracking
    const visited = new Map(); // memoryId -> { depth, path, relevance }
    const queue = [{ id: seedId, depth: 0, path: [seedId], relevance: 1.0 }];
    visited.set(seedId, { depth: 0, path: [seedId], relevance: 1.0 });

    // Get seed vector for similarity calculation
    const seedVecRow = this._stmts.getVector.get(seedId);
    const seedVec = seedVecRow ? new Map(Object.entries(JSON.parse(seedVecRow.vector))) : null;

    while (queue.length > 0) {
      const current = queue.shift();
      if (current.depth >= maxDepth) continue;

      const neighbors = this.getNeighbors(current.id);
      for (const nb of neighbors) {
        if (edgeTypes && !edgeTypes.includes(nb.edgeType)) continue;

        // Calculate relevance: decay by depth, weighted by edge weight
        const depthDecay = 1.0 / (1 + current.depth);
        const edgeBoost = nb.weight;
        let relevance = current.relevance * depthDecay * edgeBoost;

        // Boost with vector similarity if available
        if (seedVec) {
          const nbVecRow = this._stmts.getVector.get(nb.memoryId);
          if (nbVecRow) {
            const nbVec = new Map(Object.entries(JSON.parse(nbVecRow.vector)));
            const sim = cosineSimilarity(seedVec, nbVec);
            relevance = relevance * 0.5 + sim * 0.5;
          }
        }

        if (relevance < threshold) continue;

        const existing = visited.get(nb.memoryId);
        if (!existing || relevance > existing.relevance) {
          const newPath = [...current.path, nb.memoryId];
          visited.set(nb.memoryId, { depth: current.depth + 1, path: newPath, relevance });
          queue.push({ id: nb.memoryId, depth: current.depth + 1, path: newPath, relevance });
        }
      }
    }

    // Remove seed from results, sort by relevance
    visited.delete(seedId);
    const results = [];
    for (const [memoryId, info] of visited) {
      results.push({
        memoryId,
        depth: info.depth,
        path: info.path,
        relevance: Math.round(info.relevance * 1000) / 1000,
      });
    }
    results.sort((a, b) => b.relevance - a.relevance);
    return results.slice(0, limit);
  }

  // ─── Multi-metric Similarity ───

  /**
   * Compare two memories using all available distance metrics.
   * @param {string} memoryIdA
   * @param {string} memoryIdB
   * @returns {object|null}
   */
  compareMemories(memoryIdA, memoryIdB) {
    const vecRowA = this._stmts.getVector.get(memoryIdA);
    const vecRowB = this._stmts.getVector.get(memoryIdB);
    if (!vecRowA || !vecRowB) return null;

    const vecA = new Map(Object.entries(JSON.parse(vecRowA.vector)));
    const vecB = new Map(Object.entries(JSON.parse(vecRowB.vector)));

    return allMetrics(vecA, vecB);
  }

  // ─── Stats ───

  getStats() {
    const nodeCount = this._stmts.nodeCount.get().count;
    const edgeCount = this.db.prepare("SELECT COUNT(*) as count FROM graph_edges").get().count;
    const vectorCount = this.db.prepare("SELECT COUNT(*) as count FROM memory_vectors").get().count;
    const communityCount = this.db.prepare(
      "SELECT COUNT(DISTINCT community) as count FROM graph_community"
    ).get().count;
    const edgeTypes = this.db.prepare(
      "SELECT edge_type, COUNT(*) as count FROM graph_edges GROUP BY edge_type"
    ).all();

    return {
      nodes: nodeCount,
      edges: edgeCount,
      vectors: vectorCount,
      communities: communityCount,
      edgeTypes: Object.fromEntries(edgeTypes.map(e => [e.edge_type, e.count])),
      hnswNodes: this.hnsw.size,
      embeddingCache: this.embeddingService.cacheStats(),
    };
  }
}

module.exports = { KnowledgeGraph, HNSWIndex, BoundedSet };
