"use strict";

/**
 * Gossip protocol for state dissemination and anti-entropy sync.
 * Features: fanout=3, 100ms interval, max 10 hops, convergence detection.
 */

// ─── BoundedSet for message dedup ───
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

const DEFAULT_FANOUT = 3;
const DEFAULT_INTERVAL_MS = 100;
const DEFAULT_MAX_HOPS = 10;
const DEFAULT_CONVERGENCE_THRESHOLD = 0.9;

class GossipNode {
  /**
   * @param {string} nodeId
   * @param {object} opts - { fanout, intervalMs, maxHops, convergenceThreshold, onStateUpdate }
   */
  constructor(nodeId, opts = {}) {
    this.nodeId = nodeId;
    this.fanout = opts.fanout || DEFAULT_FANOUT;
    this.intervalMs = opts.intervalMs || DEFAULT_INTERVAL_MS;
    this.maxHops = opts.maxHops || DEFAULT_MAX_HOPS;
    this.convergenceThreshold = opts.convergenceThreshold || DEFAULT_CONVERGENCE_THRESHOLD;
    this.opts = opts;

    // Local state: key -> {value, version, originId, hops, timestamp}
    this.state = new Map();

    // Known peers
    this.peers = new Set();

    // Message dedup
    this._seen = new BoundedSet(100000);

    // Timer
    this._gossipTimer = null;

    // Metrics
    this.metrics = {
      messagesSent: 0,
      messagesReceived: 0,
      stateUpdates: 0,
      antiEntropySyncs: 0,
      roundsCompleted: 0,
      convergenceScore: 0,
    };

    // Anti-entropy: track last sync time per peer
    this._lastSync = new Map();
  }

  // ─── Lifecycle ───

  start(peers) {
    for (const p of peers) this.peers.add(p);
    this._gossipTimer = setInterval(() => this._gossipRound(), this.intervalMs);
    if (this._gossipTimer.unref) this._gossipTimer.unref();
  }

  stop() {
    if (this._gossipTimer) {
      clearInterval(this._gossipTimer);
      this._gossipTimer = null;
    }
    this.peers.clear();
  }

  // ─── State Management ───

  /**
   * Set a local state value. This will be gossiped to peers.
   * @param {string} key
   * @param {*} value
   * @returns {object}
   */
  set(key, value) {
    const existing = this.state.get(key);
    const version = existing ? existing.version + 1 : 1;
    this.state.set(key, {
      value,
      version,
      originId: this.nodeId,
      hops: 0,
      timestamp: Date.now(),
    });
    this.metrics.stateUpdates++;
    return { key, version, nodeId: this.nodeId };
  }

  /**
   * Get a local state value.
   */
  get(key) {
    const entry = this.state.get(key);
    return entry ? entry.value : undefined;
  }

  /**
   * Get the full local state snapshot.
   */
  getSnapshot() {
    const snapshot = {};
    for (const [key, entry] of this.state) {
      snapshot[key] = { value: entry.value, version: entry.version, originId: entry.originId, hops: entry.hops };
    }
    return snapshot;
  }

  /**
   * Get all state keys.
   */
  getKeys() {
    return [...this.state.keys()];
  }

  // ─── Gossip Protocol ───

  /**
   * One gossip round: pick random peers and send state digests.
   * @returns {object} Round summary
   */
  _gossipRound() {
    this.metrics.roundsCompleted++;

    const peerList = [...this.peers];
    if (peerList.length === 0) return { sent: 0 };

    // Select random peers (fanout)
    const selected = this._selectRandom(peerList, this.fanout);

    // Build digest: just send keys + versions (not full state)
    const digest = {};
    for (const [key, entry] of this.state) {
      digest[key] = { version: entry.version, originId: entry.originId };
    }

    let sent = 0;
    for (const peerId of selected) {
      const gossipMsg = {
        type: "gossip",
        from: this.nodeId,
        to: peerId,
        digest,
        timestamp: Date.now(),
      };

      this._seen.add(`gossip:${this.nodeId}:${peerId}:${this.metrics.roundsCompleted}`);
      this.metrics.messagesSent++;
      sent++;

      // In real transport: send to peer
      if (this.opts.onGossip) {
        this.opts.onGossip(gossipMsg);
      }
    }

    // Anti-entropy: full state sync with one random peer
    this._antiEntropyRound(peerList);

    // Calculate convergence
    this._updateConvergence();

    return { sent, round: this.metrics.roundsCompleted };
  }

  /**
   * Handle incoming gossip digest from a peer.
   * @param {object} gossipMsg - {from, digest}
   * @returns {object} Response with keys we need (pull) or full entries (push)
   */
  handleGossip(gossipMsg) {
    const { from, digest: peerDigest } = gossipMsg;
    this.metrics.messagesReceived++;

    const toPull = [];  // Keys peer has that we need
    const toPush = [];  // Keys we have that peer needs

    // Compare digests
    for (const [key, peerEntry] of Object.entries(peerDigest)) {
      const localEntry = this.state.get(key);
      if (!localEntry || localEntry.version < peerEntry.version) {
        toPull.push(key);
      }
    }

    for (const [key, localEntry] of this.state) {
      const peerEntry = peerDigest[key];
      if (!peerEntry || peerEntry.version < localEntry.version) {
        toPush.push({ key, value: localEntry.value, version: localEntry.version, originId: localEntry.originId });
      }
    }

    return {
      ok: true,
      from: this.nodeId,
      to: from,
      toPull,
      toPush,
      convergence: this.metrics.convergenceScore,
    };
  }

  /**
   * Handle state entries pushed from a peer (full entries).
   * @param {Array<{key, value, version, originId}>} entries
   * @returns {{updated: number}}
   */
  handlePush(entries) {
    let updated = 0;
    for (const entry of entries) {
      const local = this.state.get(entry.key);
      if (!local || local.version < entry.version) {
        this.state.set(entry.key, {
          value: entry.value,
          version: entry.version,
          originId: entry.originId,
          hops: (local?.hops || 0) + 1,
          timestamp: Date.now(),
        });
        updated++;
        this.metrics.stateUpdates++;

        if (this.opts.onStateUpdate) {
          this.opts.onStateUpdate({ key: entry.key, value: entry.value, version: entry.version, from: entry.originId });
        }
      }
    }
    return { updated };
  }

  /**
   * Handle pull request: return entries for the requested keys.
   * @param {string[]} keys
   * @returns {Array<{key, value, version, originId}>}
   */
  handlePull(keys) {
    const entries = [];
    for (const key of keys) {
      const entry = this.state.get(key);
      if (entry) {
        entries.push({ key, value: entry.value, version: entry.version, originId: entry.originId });
      }
    }
    return entries;
  }

  // ─── Anti-Entropy ───

  /**
   * Anti-entropy: full state sync with one random peer.
   * Unlike gossip (digest exchange), this sends the FULL state.
   */
  _antiEntropyRound(peerList) {
    if (peerList.length === 0) return;

    // Pick a random peer we haven't synced with recently
    const now = Date.now();
    let target = null;
    for (const peerId of this._shuffle(peerList)) {
      const lastSync = this._lastSync.get(peerId) || 0;
      if (now - lastSync > this.intervalMs * 10) {
        target = peerId;
        break;
      }
    }

    if (!target) target = peerList[0];

    const fullState = this.getSnapshot();
    this._lastSync.set(target, now);
    this.metrics.antiEntropySyncs++;

    if (this.opts.onAntiEntropy) {
      this.opts.onAntiEntropy({
        type: "anti-entropy",
        from: this.nodeId,
        to: target,
        state: fullState,
        timestamp: now,
      });
    }
  }

  /**
   * Handle anti-entropy sync from a peer (full state merge).
   * @param {object} remoteState - Full state snapshot from peer
   * @returns {{updated: number, conflicts: number}}
   */
  handleAntiEntropy(remoteState) {
    let updated = 0;
    let conflicts = 0;

    for (const [key, remoteEntry] of Object.entries(remoteState)) {
      const localEntry = this.state.get(key);
      if (!localEntry) {
        // New key from remote
        this.state.set(key, {
          value: remoteEntry.value,
          version: remoteEntry.version,
          originId: remoteEntry.originId,
          hops: (remoteEntry.hops || 0) + 1,
          timestamp: Date.now(),
        });
        updated++;
      } else if (remoteEntry.version > localEntry.version) {
        // Remote is newer
        this.state.set(key, {
          value: remoteEntry.value,
          version: remoteEntry.version,
          originId: remoteEntry.originId,
          hops: Math.max(localEntry.hops, remoteEntry.hops || 0) + 1,
          timestamp: Date.now(),
        });
        updated++;
      } else if (remoteEntry.version === localEntry.version && remoteEntry.originId !== localEntry.originId) {
        // Same version, different origin = conflict (resolve by originId)
        conflicts++;
      }
    }

    return { updated, conflicts };
  }

  // ─── Convergence ───

  _updateConvergence() {
    // Convergence score: percentage of state that is consistent across known peers
    // Since we don't have direct access to peer states, we estimate based on:
    // 1. How many anti-entropy syncs have occurred
    // 2. How many unique origins we see in our state
    // 3. Round progress vs max hops
    const totalEntries = this.state.size;
    if (totalEntries === 0) {
      this.metrics.convergenceScore = 1.0;
      return;
    }

    let maxHops = 0;
    for (const [, entry] of this.state) {
      if (entry.hops > maxHops) maxHops = entry.hops;
    }

    // If max hops is at or below threshold, we're converged
    const hopScore = Math.max(0, 1 - (maxHops / this.maxHops));
    const syncScore = Math.min(1, this.metrics.antiEntropySyncs / Math.max(1, this.peers.size));
    this.metrics.convergenceScore = Math.round((hopScore * 0.6 + syncScore * 0.4) * 100) / 100;
  }

  /**
   * Check if the network has converged.
   */
  isConverged() {
    return this.metrics.convergenceScore >= this.convergenceThreshold;
  }

  // ─── Utilities ───

  _selectRandom(arr, n) {
    const shuffled = this._shuffle(arr);
    return shuffled.slice(0, Math.min(n, arr.length));
  }

  _shuffle(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  getState() {
    return {
      nodeId: this.nodeId,
      peers: [...this.peers],
      stateSize: this.state.size,
      fanout: this.fanout,
      intervalMs: this.intervalMs,
      maxHops: this.maxHops,
      convergenceScore: this.metrics.convergenceScore,
      converged: this.isConverged(),
      metrics: { ...this.metrics },
    };
  }
}

module.exports = { GossipNode, BoundedSet };
