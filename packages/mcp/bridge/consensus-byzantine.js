"use strict";

/**
 * PBFT (Practical Byzantine Fault Tolerance) consensus protocol.
 * 3-phase commit: pre-prepare, prepare, commit with SHA-256 digests.
 * Supports view change for primary rotation.
 */

const crypto = require("crypto");

// ─── PBFT Phases ───
const PHASE = {
  PRE_PREPARE: "pre-prepare",
  PREPARE: "prepare",
  COMMIT: "commit",
  VIEW_CHANGE: "view-change",
  NEW_VIEW: "new-view",
};

// ─── BoundedSet for message dedup (100K) ───
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

/**
 * Compute SHA-256 digest of a message.
 */
function digest(data) {
  return crypto.createHash("sha256").update(typeof data === "string" ? data : JSON.stringify(data)).digest("hex");
}

class PBFTNode {
  /**
   * @param {string} nodeId
   * @param {string[]} allNodes - All node IDs including self
   * @param {object} opts - { onCommit, onViewChange }
   */
  constructor(nodeId, allNodes, opts = {}) {
    this.nodeId = nodeId;
    this.allNodes = allNodes;
    this.opts = opts;
    this.n = allNodes.length;
    this.f = Math.floor((this.n - 1) / 3); // max Byzantine faults tolerated

    // State
    this.view = 0;
    this.sequence = 0;
    this.primary = allNodes[0]; // Primary determined by view % n
    this.phase = {};

    // Message log: digest -> {phase, messages: Map<nodeId, msg>}
    this.messageLog = new Map();
    this.prepared = new Set();   // digests that reached "prepared" certificate
    this.committed = new Set();  // digests that reached "committed" certificate
    this.executed = new Set();   // digests that have been executed

    // Dedup
    this._seen = new BoundedSet(100000);

    // Metrics
    this.metrics = {
      prePrepares: 0,
      prepares: 0,
      commits: 0,
      viewChanges: 0,
      requestsExecuted: 0,
    };
  }

  /**
   * Get the current primary node for the current view.
   */
  getPrimary() {
    return this.allNodes[this.view % this.n];
  }

  isPrimary() {
    return this.getPrimary() === this.nodeId;
  }

  /**
   * Primary: create pre-prepare message for a client request.
   * @param {object} request - The client request
   * @returns {object} Pre-prepare message
   */
  prePrepare(request) {
    if (!this.isPrimary()) return { error: "not primary", primary: this.getPrimary() };

    const d = digest(request);
    this.sequence++;
    const msg = {
      type: PHASE.PRE_PREPARE,
      view: this.view,
      sequence: this.sequence,
      digest: d,
      request,
      nodeId: this.nodeId,
    };

    this._seen.add(`pre-prepare:${this.view}:${this.sequence}`);
    this.metrics.prePrepares++;

    // Store in message log
    if (!this.messageLog.has(d)) {
      this.messageLog.set(d, { phase: PHASE.PRE_PREPARE, messages: new Map(), request, sequence: this.sequence });
    }
    this.messageLog.get(d).messages.set(this.nodeId, msg);

    return { ok: true, message: msg, broadcast: true };
  }

  /**
   * Replica: handle pre-prepare from primary, send prepare.
   * @param {object} prePrepare - Pre-prepare message from primary
   * @returns {object|null} Prepare message or null if invalid
   */
  handlePrePrepare(prePrepare) {
    const { view, sequence, digest: d, request, nodeId } = prePrepare;
    const msgKey = `pre-prepare:${view}:${sequence}`;

    // Dedup
    if (this._seen.has(msgKey)) return null;
    this._seen.add(msgKey);

    // Verify primary
    if (nodeId !== this.getPrimary()) return null;
    if (view !== this.view) return null;

    // Verify digest
    if (digest(request) !== d) return null;

    // Store
    if (!this.messageLog.has(d)) {
      this.messageLog.set(d, { phase: PHASE.PREPARE, messages: new Map(), request, sequence });
    }

    this.metrics.prePrepares++;

    // Send prepare
    const prepareMsg = {
      type: PHASE.PREPARE,
      view: this.view,
      sequence,
      digest: d,
      nodeId: this.nodeId,
    };

    this.messageLog.get(d).messages.set(this.nodeId, prepareMsg);
    this._seen.add(`prepare:${this.nodeId}:${d}`);
    this.metrics.prepares++;

    return { ok: true, message: prepareMsg, broadcast: true };
  }

  /**
   * Handle prepare message from a replica.
   * @param {object} prepare - Prepare message
   * @returns {object|null} Commit message if prepared certificate reached
   */
  handlePrepare(prepare) {
    const { view, sequence, digest: d, nodeId } = prepare;
    const msgKey = `prepare:${nodeId}:${d}`;

    if (this._seen.has(msgKey)) return null;
    this._seen.add(msgKey);

    if (view !== this.view) return null;

    if (!this.messageLog.has(d)) {
      this.messageLog.set(d, { phase: PHASE.PREPARE, messages: new Map(), sequence });
    }
    this.messageLog.get(d).messages.set(nodeId, prepare);
    this.metrics.prepares++;

    // Check if we have 2f+1 prepare messages (including our own)
    const prepares = this._countPhaseMessages(d, PHASE.PREPARE);
    if (prepares >= 2 * this.f + 1 && !this.prepared.has(d)) {
      this.prepared.add(d);
      this.messageLog.get(d).phase = PHASE.COMMIT;

      // Send commit
      const commitMsg = {
        type: PHASE.COMMIT,
        view: this.view,
        sequence,
        digest: d,
        nodeId: this.nodeId,
      };

      this._seen.add(`commit:${this.nodeId}:${d}`);
      this.metrics.commits++;

      return { ok: true, message: commitMsg, broadcast: true, phase: "prepared" };
    }

    return null;
  }

  /**
   * Handle commit message from a replica.
   * @param {object} commit - Commit message
   * @returns {object|null} Execution result if committed certificate reached
   */
  handleCommit(commit) {
    const { view, sequence, digest: d, nodeId } = commit;
    const msgKey = `commit:${nodeId}:${d}`;

    if (this._seen.has(msgKey)) return null;
    this._seen.add(msgKey);

    if (view !== this.view) return null;

    if (!this.messageLog.has(d)) return null;
    this.messageLog.get(d).messages.set(nodeId, commit);
    this.metrics.commits++;

    // Check if we have 2f+1 commit messages
    const commits = this._countPhaseMessages(d, PHASE.COMMIT);
    if (commits >= 2 * this.f + 1 && !this.committed.has(d)) {
      this.committed.add(d);

      // Execute the request
      if (!this.executed.has(d)) {
        this.executed.add(d);
        this.metrics.requestsExecuted++;

        const entry = this.messageLog.get(d);
        if (this.opts.onCommit && entry?.request) {
          this.opts.onCommit({
            digest: d,
            sequence,
            request: entry.request,
            view,
          });
        }

        return { ok: true, committed: true, digest: d, sequence, request: entry?.request };
      }
    }

    return null;
  }

  /**
   * Initiate view change when primary is suspected faulty.
   * @returns {object} View change message
   */
  startViewChange() {
    this.view++;
    this.primary = this.getPrimary();
    this.metrics.viewChanges++;

    // Collect prepared certificates to include in view change
    const preparedCerts = [];
    for (const d of this.prepared) {
      const entry = this.messageLog.get(d);
      if (entry) {
        preparedCerts.push({ digest: d, sequence: entry.sequence, messages: entry.messages.size });
      }
    }

    const viewChangeMsg = {
      type: PHASE.VIEW_CHANGE,
      view: this.view,
      nodeId: this.nodeId,
      preparedCertificates: preparedCerts,
    };

    if (this.opts.onViewChange) {
      this.opts.onViewChange({ view: this.view, nodeId: this.nodeId, newPrimary: this.primary });
    }

    return { ok: true, message: viewChangeMsg, broadcast: true, newView: this.view, newPrimary: this.primary };
  }

  /**
   * Handle view change messages. If new primary, create new-view message.
   * @param {object[]} viewChangeMsgs - All view change messages received
   * @returns {object|null} New-view message if this node is the new primary
   */
  handleViewChange(viewChangeMsgs) {
    const targetView = this.view;
    const validChanges = viewChangeMsgs.filter(m => m.view === targetView);

    // Need 2f+1 view change messages
    if (validChanges.length < 2 * this.f + 1) return null;

    // If this node is the new primary, create new-view
    if (this.getPrimary() !== this.nodeId) return null;

    const newViewMsg = {
      type: PHASE.NEW_VIEW,
      view: targetView,
      nodeId: this.nodeId,
      viewChanges: validChanges.map(m => ({ nodeId: m.nodeId, preparedCertificates: m.preparedCertificates })),
    };

    return { ok: true, message: newViewMsg, broadcast: true };
  }

  // ─── Helpers ───

  _countPhaseMessages(d, phase) {
    const entry = this.messageLog.get(d);
    if (!entry) return 0;
    let count = 0;
    for (const [, msg] of entry.messages) {
      if (msg.type === phase) count++;
    }
    return count;
  }

  getState() {
    return {
      nodeId: this.nodeId,
      view: this.view,
      primary: this.getPrimary(),
      isPrimary: this.isPrimary(),
      sequence: this.sequence,
      n: this.n,
      f: this.f,
      preparedCount: this.prepared.size,
      committedCount: this.committed.size,
      executedCount: this.executed.size,
      messageLogSize: this.messageLog.size,
      dedupSize: this._seen.size,
      metrics: { ...this.metrics },
    };
  }
}

module.exports = { PBFTNode, PHASE, digest, BoundedSet };
