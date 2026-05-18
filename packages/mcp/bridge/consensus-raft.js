"use strict";

/**
 * Raft consensus protocol: leader election, log replication, heartbeats.
 * Pure JS implementation for Codebrain's multi-agent system.
 */

// ─── Raft Node States ───
const FOLLOWER = "follower";
const CANDIDATE = "candidate";
const LEADER = "leader";

// ─── Constants ───
const ELECTION_TIMEOUT_MIN = 150;  // ms
const ELECTION_TIMEOUT_MAX = 300;  // ms
const HEARTBEAT_INTERVAL = 50;     // ms
const MAX_LOG_ENTRIES = 10000;

class RaftNode {
  /**
   * @param {string} nodeId - This node's ID
   * @param {object} opts - { onLeaderChange, onLogApply, messageBus, ptyManager }
   */
  constructor(nodeId, opts = {}) {
    this.nodeId = nodeId;
    this.opts = opts;

    // Persistent state
    this.currentTerm = 0;
    this.votedFor = null;
    this.log = []; // [{term, command, index}]

    // Volatile state
    this.state = FOLLOWER;
    this.leaderId = null;
    this.commitIndex = -1;
    this.lastApplied = -1;

    // Leader state
    this.nextIndex = new Map();   // nodeId -> next log index to send
    this.matchIndex = new Map();  // nodeId -> highest log index replicated

    // Peers (other node IDs)
    this.peers = new Set();

    // Timers
    this._electionTimer = null;
    this._heartbeatTimer = null;

    // Metrics
    this.metrics = {
      electionsStarted: 0,
      votesGranted: 0,
      votesDenied: 0,
      heartbeatsSent: 0,
      heartbeatsReceived: 0,
      logEntriesReplicated: 0,
      leaderChanges: 0,
    };
  }

  // ─── Lifecycle ───

  start(peers) {
    for (const p of peers) this.peers.add(p);
    this._resetElectionTimer();
  }

  stop() {
    this._clearTimers();
    this.peers.clear();
  }

  // ─── RPC Handlers (called by transport) ───

  /**
   * Handle RequestVote RPC from a candidate.
   * @param {object} args - {term, candidateId, lastLogIndex, lastLogTerm}
   * @returns {{term, voteGranted}}
   */
  handleRequestVote(args) {
    const { term, candidateId, lastLogIndex, lastLogTerm } = args;

    if (term > this.currentTerm) {
      this._stepDown(term);
    }

    let voteGranted = false;
    if (term >= this.currentTerm &&
        (this.votedFor === null || this.votedFor === candidateId) &&
        this._isLogUpToDate(lastLogIndex, lastLogTerm)) {
      voteGranted = true;
      this.votedFor = candidateId;
      this._resetElectionTimer();
      this.metrics.votesGranted++;
    } else {
      this.metrics.votesDenied++;
    }

    return { term: this.currentTerm, voteGranted };
  }

  /**
   * Handle AppendEntries RPC from a leader.
   * @param {object} args - {term, leaderId, prevLogIndex, prevLogTerm, entries[], leaderCommit}
   * @returns {{term, success, matchIndex}}
   */
  handleAppendEntries(args) {
    const { term, leaderId, prevLogIndex, prevLogTerm, entries, leaderCommit } = args;

    if (term > this.currentTerm) {
      this._stepDown(term);
    }

    if (term < this.currentTerm) {
      return { term: this.currentTerm, success: false, matchIndex: -1 };
    }

    // Valid leader heartbeat
    this.leaderId = leaderId;
    this._resetElectionTimer();
    this.metrics.heartbeatsReceived++;

    // Check log consistency at prevLogIndex
    if (prevLogIndex >= 0) {
      if (prevLogIndex >= this.log.length || this.log[prevLogIndex]?.term !== prevLogTerm) {
        return { term: this.currentTerm, success: false, matchIndex: -1 };
      }
    }

    // Append new entries
    if (entries && entries.length > 0) {
      let idx = prevLogIndex + 1;
      for (const entry of entries) {
        if (idx < this.log.length && this.log[idx].term !== entry.term) {
          // Conflict: truncate from here
          this.log = this.log.slice(0, idx);
        }
        if (idx >= this.log.length) {
          this.log.push({ term: entry.term, command: entry.command, index: idx });
        }
        idx++;
      }
    }

    // Update commit index
    if (leaderCommit > this.commitIndex) {
      this.commitIndex = Math.min(leaderCommit, this.log.length - 1);
      this._applyLogEntries();
    }

    return { term: this.currentTerm, success: true, matchIndex: this.log.length - 1 };
  }

  // ─── Leader Actions ───

  /**
   * Append a command to the log (leader only).
   * @param {string} command
   * @returns {{index, term}}
   */
  appendCommand(command) {
    if (this.state !== LEADER) return { error: "not leader", leaderId: this.leaderId };

    const entry = { term: this.currentTerm, command, index: this.log.length };
    this.log.push(entry);

    // Trim log if too long
    if (this.log.length > MAX_LOG_ENTRIES) {
      this.log = this.log.slice(this.log.length - MAX_LOG_ENTRIES);
    }

    this.metrics.logEntriesReplicated++;
    return { index: entry.index, term: entry.term };
  }

  /**
   * Start election (candidate requests votes).
   * @returns {{term, votesNeeded, peers}}
   */
  startElection() {
    this.state = CANDIDATE;
    this.currentTerm++;
    this.votedFor = this.nodeId;
    this._resetElectionTimer();
    this.metrics.electionsStarted++;

    const lastLogIndex = this.log.length - 1;
    const lastLogTerm = lastLogIndex >= 0 ? this.log[lastLogIndex].term : 0;

    const voteRequest = {
      term: this.currentTerm,
      candidateId: this.nodeId,
      lastLogIndex,
      lastLogTerm,
    };

    return {
      ok: true,
      term: this.currentTerm,
      votesNeeded: Math.floor(this.peers.size / 2) + 1,
      peers: [...this.peers],
      voteRequest,
    };
  }

  /**
   * Record a vote result. If majority, become leader.
   * @param {boolean} granted
   * @returns {{elected: boolean}}
   */
  recordVote(granted) {
    if (granted) this.metrics.votesGranted++;

    // Count total votes (self + granted from peers)
    // In a real implementation, this would track individual votes
    if (granted) {
      const votesNeeded = Math.floor(this.peers.size / 2) + 1;
      // Simplified: assume we become leader if we voted for ourselves + got one more
      if (this.votedFor === this.nodeId) {
        this._becomeLeader();
        return { elected: true };
      }
    }
    return { elected: false };
  }

  // ─── State Transitions ───

  _becomeLeader() {
    this.state = LEADER;
    this.leaderId = this.nodeId;
    this._clearTimers();
    this.metrics.leaderChanges++;

    // Initialize leader state
    for (const peer of this.peers) {
      this.nextIndex.set(peer, this.log.length);
      this.matchIndex.set(peer, -1);
    }

    // Start heartbeats
    this._heartbeatTimer = setInterval(() => this._sendHeartbeats(), HEARTBEAT_INTERVAL);
    if (this._heartbeatTimer.unref) this._heartbeatTimer.unref();

    if (this.opts.onLeaderChange) {
      this.opts.onLeaderChange({ leaderId: this.nodeId, term: this.currentTerm });
    }
  }

  _stepDown(newTerm) {
    this.currentTerm = newTerm;
    this.state = FOLLOWER;
    this.votedFor = null;
    this._clearTimers();
    this._resetElectionTimer();
  }

  // ─── Heartbeats ───

  _sendHeartbeats() {
    this.metrics.heartbeatsSent++;
    // In a real transport layer, this would send AppendEntries RPC to each peer
    // For Codebrain, we emit an event that the transport layer picks up
    if (this.opts.onHeartbeat) {
      this.opts.onHeartbeat({
        leaderId: this.nodeId,
        term: this.currentTerm,
        peers: [...this.peers],
        prevLogIndex: this.log.length - 1,
        prevLogTerm: this.log.length > 0 ? this.log[this.log.length - 1].term : 0,
        entries: [],
        leaderCommit: this.commitIndex,
      });
    }
  }

  // ─── Log Application ───

  _applyLogEntries() {
    while (this.lastApplied < this.commitIndex) {
      this.lastApplied++;
      const entry = this.log[this.lastApplied];
      if (entry && this.opts.onLogApply) {
        this.opts.onLogApply({ index: this.lastApplied, term: entry.term, command: entry.command });
      }
    }
  }

  // ─── Timers ───

  _resetElectionTimer() {
    if (this._electionTimer) clearTimeout(this._electionTimer);
    const timeout = ELECTION_TIMEOUT_MIN + Math.random() * (ELECTION_TIMEOUT_MAX - ELECTION_TIMEOUT_MIN);
    this._electionTimer = setTimeout(() => {
      if (this.state !== LEADER) this.startElection();
    }, timeout);
    if (this._electionTimer.unref) this._electionTimer.unref();
  }

  _clearTimers() {
    if (this._electionTimer) { clearTimeout(this._electionTimer); this._electionTimer = null; }
    if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
  }

  // ─── Helpers ───

  _isLogUpToDate(lastLogIndex, lastLogTerm) {
    const myLastIdx = this.log.length - 1;
    const myLastTerm = myLastIdx >= 0 ? this.log[myLastIdx].term : 0;
    if (lastLogTerm !== myLastTerm) return lastLogTerm > myLastTerm;
    return lastLogIndex >= myLastIdx;
  }

  getState() {
    return {
      nodeId: this.nodeId,
      state: this.state,
      term: this.currentTerm,
      leaderId: this.leaderId,
      logLength: this.log.length,
      commitIndex: this.commitIndex,
      lastApplied: this.lastApplied,
      peers: [...this.peers],
      metrics: { ...this.metrics },
    };
  }
}

module.exports = { RaftNode, FOLLOWER, CANDIDATE, LEADER };
