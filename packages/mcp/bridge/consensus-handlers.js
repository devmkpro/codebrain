"use strict";

/**
 * Consensus mechanisms: voting, leader election, Raft, PBFT, Gossip.
 * Pluggable transport with local (in-process) and federation support.
 */

const { RaftNode, FOLLOWER, CANDIDATE, LEADER } = require("./consensus-raft.js");
const { PBFTNode, PHASE, digest } = require("./consensus-byzantine.js");
const { GossipNode } = require("./consensus-gossip.js");

const DEFAULT_VOTE_TIMEOUT = 10000;

// ─── Pluggable Transport ───

class LocalTransport {
  constructor() {
    this.nodes = new Map(); // nodeId -> { handler: function }
  }

  register(nodeId, handler) {
    this.nodes.set(nodeId, { handler });
  }

  unregister(nodeId) {
    this.nodes.delete(nodeId);
  }

  send(from, to, message) {
    const target = this.nodes.get(to);
    if (target && target.handler) {
      return target.handler(message);
    }
    return null;
  }

  broadcast(from, message) {
    const results = [];
    for (const [nodeId, target] of this.nodes) {
      if (nodeId !== from && target.handler) {
        results.push({ to: nodeId, result: target.handler(message) });
      }
    }
    return results;
  }
}

function createConsensusHandlers(opts) {
  const votes = new Map();
  const leaderState = { leaderId: null, electedAt: null, term: 0 };

  // Protocol instances
  const raftNodes = new Map();    // nodeId -> RaftNode
  const pbftNodes = new Map();    // nodeId -> PBFTNode
  const gossipNodes = new Map();  // nodeId -> GossipNode
  const transport = new LocalTransport();

  return {
    // ─── Voting (Original) ───

    async swarmVote({ question, options, mode = "majority", timeoutMs = DEFAULT_VOTE_TIMEOUT }) {
      if (!question || !options || options.length < 2) {
        return { ok: false, error: "question and at least 2 options are required" };
      }

      const ptyManager = opts.ptyManager;
      if (!ptyManager) return { ok: false, error: "ptyManager not available" };

      const panes = ptyManager.list().filter(p => {
        const role = opts.roleMap?.get(p.paneId) || "worker";
        return role !== "orchestrator" && p.status !== "exited";
      });

      if (panes.length === 0) return { ok: false, error: "no eligible voters" };

      const voteId = `vote_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const deadline = Date.now() + timeoutMs;

      const vote = {
        question, options, mode,
        votesMap: new Map(),
        participants: panes.map(p => p.paneId),
        deadline, status: "collecting", startedAt: Date.now(), result: null,
      };
      votes.set(voteId, vote);

      for (const pane of panes) {
        const voteRequest = JSON.stringify({
          voteId, question, options, mode, deadline,
          instruction: `VOTE REQUIRED: "${question}". Options: ${options.join(", ")}. Reply with pane_send_message containing your vote.`,
        });
        if (opts.messageBus) {
          opts.messageBus.send(pane.paneId, {
            id: `vote_req_${voteId}_${pane.paneId}`, from: "consensus", to: pane.paneId,
            content: voteRequest, type: "consensus_propose", priority: "high", timestamp: Date.now(), read: false,
          });
        } else {
          try { ptyManager.injectOutput(pane.paneId, `\n\x1b[33m[VOTE] ${voteRequest}\x1b[0m\n`); } catch (e) { /* */ }
        }
      }

      const timer = setTimeout(() => _finalizeVote(voteId), timeoutMs);
      if (timer.unref) timer.unref();

      return { ok: true, voteId, question, options, mode, participants: panes.length, deadline, timeoutMs };
    },

    async swarmCastVote({ voteId, paneId, choice }) {
      const vote = votes.get(voteId);
      if (!vote) return { ok: false, error: "vote not found" };
      if (vote.status !== "collecting") return { ok: false, error: "vote already closed" };
      if (!vote.options.includes(choice)) return { ok: false, error: `invalid choice. Options: ${vote.options.join(", ")}` };
      if (!vote.participants.includes(paneId)) return { ok: false, error: "not a participant" };

      vote.votesMap.set(paneId, choice);
      return { ok: true, voteId, paneId, choice, votesCollected: vote.votesMap.size, totalParticipants: vote.participants.length };
    },

    async swarmElectLeader() {
      const ptyManager = opts.ptyManager;
      if (!ptyManager) return { ok: false, error: "ptyManager not available" };

      const panes = ptyManager.list().filter(p => {
        const role = opts.roleMap?.get(p.paneId) || "worker";
        return role !== "orchestrator" && p.status !== "exited";
      });

      if (panes.length === 0) return { ok: false, error: "no eligible workers" };

      let bestPane = null;
      let bestScore = -1;
      for (const pane of panes) {
        let score = 50;
        if (opts.agentScorer) {
          try { score = opts.agentScorer.scoreAgent(pane.paneId, null, []).score; } catch (e) { /* */ }
        }
        if (score > bestScore) { bestScore = score; bestPane = pane; }
      }

      if (!bestPane) return { ok: false, error: "could not determine leader" };

      leaderState.leaderId = bestPane.paneId;
      leaderState.electedAt = Date.now();
      leaderState.term++;

      if (opts.roleMap) opts.roleMap.set(bestPane.paneId, "orchestrator");

      const announcement = `New leader elected: ${bestPane.paneId} (term ${leaderState.term}, score ${bestScore})`;
      for (const pane of panes) {
        if (pane.paneId !== bestPane.paneId) {
          if (opts.messageBus) {
            opts.messageBus.send(pane.paneId, {
              id: `leader_${Date.now()}_${pane.paneId}`, from: "consensus", to: pane.paneId,
              content: announcement, type: "status_update", priority: "urgent", timestamp: Date.now(), read: false,
            });
          } else {
            try { ptyManager.injectOutput(pane.paneId, `\n\x1b[33m[LEADER] ${announcement}\x1b[0m\n`); } catch (e) { /* */ }
          }
        }
      }

      return { ok: true, leaderId: bestPane.paneId, agent: bestPane.agent, label: opts.paneLabels?.get(bestPane.paneId) || bestPane.agent, score: bestScore, term: leaderState.term, electedAt: leaderState.electedAt };
    },

    async swarmConsensusStatus() {
      const activeVotes = [];
      const closedVotes = [];
      for (const [id, vote] of votes) {
        const info = { voteId: id, question: vote.question, mode: vote.mode, status: vote.status, votesCollected: vote.votesMap.size, participants: vote.participants.length, result: vote.result };
        if (vote.status === "collecting") activeVotes.push(info);
        else closedVotes.push(info);
      }

      return {
        ok: true,
        leader: { ...leaderState },
        activeVotes,
        recentVotes: closedVotes.slice(-10),
        totalVotes: votes.size,
        raftNodes: raftNodes.size,
        pbftNodes: pbftNodes.size,
        gossipNodes: gossipNodes.size,
      };
    },

    // ─── Raft Protocol ───

    async raftStart({ nodeId, peers }) {
      if (!nodeId) return { ok: false, error: "nodeId required" };
      if (raftNodes.has(nodeId)) return { ok: false, error: `Raft node ${nodeId} already exists` };

      const node = new RaftNode(nodeId, {
        onLeaderChange: (info) => {
          leaderState.leaderId = info.leaderId;
          leaderState.term = info.term;
          leaderState.electedAt = Date.now();
        },
        onLogApply: (entry) => {
          if (opts.hooksManager) {
            try { opts.hooksManager.fire("raft_log_applied", entry); } catch (e) { /* */ }
          }
        },
      });

      raftNodes.set(nodeId, node);
      transport.register(nodeId, (msg) => {
        if (msg.type === "request_vote") return node.handleRequestVote(msg);
        if (msg.type === "append_entries") return node.handleAppendEntries(msg);
        return null;
      });

      const peerList = (peers || []).filter(p => p !== nodeId);
      node.start(peerList);

      return { ok: true, nodeId, state: node.getState() };
    },

    async raftStop({ nodeId }) {
      const node = raftNodes.get(nodeId);
      if (!node) return { ok: false, error: `Raft node ${nodeId} not found` };
      node.stop();
      transport.unregister(nodeId);
      raftNodes.delete(nodeId);
      return { ok: true, nodeId };
    },

    async raftAppend({ nodeId, command }) {
      const node = raftNodes.get(nodeId);
      if (!node) return { ok: false, error: `Raft node ${nodeId} not found` };
      const result = node.appendCommand(command);
      return { ok: !result.error, ...result };
    },

    async raftStatus() {
      const nodes = {};
      for (const [id, node] of raftNodes) {
        nodes[id] = node.getState();
      }
      return { ok: true, nodes, count: raftNodes.size };
    },

    // ─── PBFT Protocol ───

    async pbftStart({ nodeId, allNodes }) {
      if (!nodeId || !allNodes) return { ok: false, error: "nodeId and allNodes required" };
      if (pbftNodes.has(nodeId)) return { ok: false, error: `PBFT node ${nodeId} already exists` };

      const node = new PBFTNode(nodeId, allNodes, {
        onCommit: (info) => {
          if (opts.hooksManager) {
            try { opts.hooksManager.fire("pbft_committed", info); } catch (e) { /* */ }
          }
        },
        onViewChange: (info) => {
          if (opts.hooksManager) {
            try { opts.hooksManager.fire("pbft_view_change", info); } catch (e) { /* */ }
          }
        },
      });

      pbftNodes.set(nodeId, node);
      transport.register(`pbft:${nodeId}`, (msg) => {
        switch (msg.type) {
          case PHASE.PRE_PREPARE: return node.handlePrePrepare(msg);
          case PHASE.PREPARE: return node.handlePrepare(msg);
          case PHASE.COMMIT: return node.handleCommit(msg);
          default: return null;
        }
      });

      return { ok: true, nodeId, state: node.getState() };
    },

    async pbftStop({ nodeId }) {
      const node = pbftNodes.get(nodeId);
      if (!node) return { ok: false, error: `PBFT node ${nodeId} not found` };
      transport.unregister(`pbft:${nodeId}`);
      pbftNodes.delete(nodeId);
      return { ok: true, nodeId };
    },

    async pbftPropose({ nodeId, request }) {
      const node = pbftNodes.get(nodeId);
      if (!node) return { ok: false, error: `PBFT node ${nodeId} not found` };
      if (!node.isPrimary()) return { ok: false, error: "not primary", primary: node.getPrimary() };
      const result = node.prePrepare(request);
      return { ok: true, ...result, state: node.getState() };
    },

    async pbftViewChange({ nodeId }) {
      const node = pbftNodes.get(nodeId);
      if (!node) return { ok: false, error: `PBFT node ${nodeId} not found` };
      const result = node.startViewChange();
      return { ok: true, ...result };
    },

    async pbftStatus() {
      const nodes = {};
      for (const [id, node] of pbftNodes) {
        nodes[id] = node.getState();
      }
      return { ok: true, nodes, count: pbftNodes.size };
    },

    // ─── Gossip Protocol ───

    async gossipStart({ nodeId, peers, fanout, intervalMs }) {
      if (!nodeId) return { ok: false, error: "nodeId required" };
      if (gossipNodes.has(nodeId)) return { ok: false, error: `Gossip node ${nodeId} already exists` };

      const node = new GossipNode(nodeId, {
        fanout: fanout || 3,
        intervalMs: intervalMs || 100,
        onGossip: (msg) => {
          // Deliver to target peer if it exists locally
          const targetNode = gossipNodes.get(msg.to);
          if (targetNode) {
            const response = targetNode.handleGossip(msg);
            if (response && response.toPush.length > 0) {
              node.handlePush(response.toPush);
            }
          }
        },
        onAntiEntropy: (msg) => {
          const targetNode = gossipNodes.get(msg.to);
          if (targetNode) {
            const result = targetNode.handleAntiEntropy(msg.state);
            // Also sync target's state back
            node.handleAntiEntropy(targetNode.getSnapshot());
          }
        },
        onStateUpdate: (info) => {
          if (opts.hooksManager) {
            try { opts.hooksManager.fire("gossip_state_update", info); } catch (e) { /* */ }
          }
        },
      });

      gossipNodes.set(nodeId, node);
      const peerList = (peers || []).filter(p => p !== nodeId);
      node.start(peerList);

      return { ok: true, nodeId, state: node.getState() };
    },

    async gossipStop({ nodeId }) {
      const node = gossipNodes.get(nodeId);
      if (!node) return { ok: false, error: `Gossip node ${nodeId} not found` };
      node.stop();
      gossipNodes.delete(nodeId);
      return { ok: true, nodeId };
    },

    async gossipSet({ nodeId, key, value }) {
      const node = gossipNodes.get(nodeId);
      if (!node) return { ok: false, error: `Gossip node ${nodeId} not found` };
      const result = node.set(key, value);
      return { ok: true, ...result };
    },

    async gossipGet({ nodeId, key }) {
      const node = gossipNodes.get(nodeId);
      if (!node) return { ok: false, error: `Gossip node ${nodeId} not found` };
      return { ok: true, key, value: node.get(key) };
    },

    async gossipSync({ nodeId }) {
      const node = gossipNodes.get(nodeId);
      if (!node) return { ok: false, error: `Gossip node ${nodeId} not found` };
      // Trigger a manual gossip round
      const peers = [...node.peers];
      if (peers.length === 0) return { ok: false, error: "no peers" };
      const result = node._gossipRound();
      return { ok: true, ...result, state: node.getState() };
    },

    async gossipStatus() {
      const nodes = {};
      for (const [id, node] of gossipNodes) {
        nodes[id] = node.getState();
      }
      return { ok: true, nodes, count: gossipNodes.size };
    },
  };

  function _finalizeVote(voteId) {
    const vote = votes.get(voteId);
    if (!vote || vote.status !== "collecting") return;
    vote.status = "closed";

    const tallies = new Map();
    for (const option of vote.options) tallies.set(option, 0);
    for (const [, choice] of vote.votesMap) tallies.set(choice, (tallies.get(choice) || 0) + 1);

    const totalVotes = vote.votesMap.size;
    const totalParticipants = vote.participants.length;
    const participationRate = totalParticipants > 0 ? totalVotes / totalParticipants : 0;

    let winner = null;
    let passed = false;

    switch (vote.mode) {
      case "majority": {
        for (const [option, count] of tallies) {
          if (count > totalVotes / 2) { winner = option; passed = true; break; }
        }
        if (!winner) {
          let maxCount = 0;
          for (const [option, count] of tallies) {
            if (count > maxCount) { maxCount = count; winner = option; }
          }
          passed = false;
        }
        break;
      }
      case "unanimous": {
        for (const [option, count] of tallies) {
          if (count === totalVotes && totalVotes === totalParticipants) { winner = option; passed = true; break; }
        }
        if (!winner) { winner = "no consensus"; passed = false; }
        break;
      }
      case "weighted": {
        const weightedTallies = new Map();
        for (const option of vote.options) weightedTallies.set(option, 0);
        for (const [paneId, choice] of vote.votesMap) {
          let weight = 1;
          if (opts.agentScorer) {
            try { const score = opts.agentScorer.scoreAgent(paneId, null, []); weight = Math.max(0.1, score.score / 100); } catch (e) { /* */ }
          }
          weightedTallies.set(choice, (weightedTallies.get(choice) || 0) + weight);
        }
        let maxWeight = 0;
        for (const [option, weight] of weightedTallies) {
          if (weight > maxWeight) { maxWeight = weight; winner = option; }
        }
        passed = maxWeight > 0;
        for (const [k, v] of weightedTallies) tallies.set(k, Math.round(v * 100) / 100);
        break;
      }
    }

    const confidence = totalVotes > 0 ? Math.round(((tallies.get(winner) || 0) / totalVotes) * 100) / 100 : 0;

    vote.result = {
      winner, passed, confidence,
      tallies: Object.fromEntries(tallies),
      participationRate: Math.round(participationRate * 100) / 100,
      totalVotes, totalParticipants,
    };
  }
}

module.exports = { createConsensusHandlers, LocalTransport };
