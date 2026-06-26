"use strict";

/**
 * In-memory message bus with priority queues, ack/retry, TTL expiration, metrics,
 * EventEmitter events, broadcast support, batch processing, EMA latency,
 * circular buffer rate tracking, and queue eviction.
 */

const { EventEmitter } = require("node:events");

const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };
const DEFAULT_ACK_TIMEOUT = 5000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TTL = 30000;
const MAX_LATENCY_RING = 60;        // 60s circular buffer
const RATE_WINDOW_MS = 60000;       // 60s window for messages/sec
const BATCH_SIZE = 10;              // Messages per batch tick
const BATCH_INTERVAL_MS = 10;       // 10ms between batch ticks
const EMA_ALPHA = 0.1;              // Exponential moving average smoothing
const MAX_QUEUE_SIZE = 1000;        // Per-agent queue cap
const BROADCAST_SUBSCRIBERS_KEY = "__broadcast__";

// 13 recognized message types
const MESSAGE_TYPES = new Set([
  "task", "update", "question", "result",
  "task_assign", "task_complete", "task_failed",
  "heartbeat", "status_update", "status_request",
  "consensus_propose", "consensus_vote", "consensus_result",
]);

class MessageBus extends EventEmitter {
  constructor(opts = {}) {
    super();
    /** @type {Map<string, Array<object>>} paneId -> sorted array of messages */
    this.queues = new Map();
    /** @type {Map<string, {timer: NodeJS.Timeout, msg: object, retries: number}>} */
    this.pendingAck = new Map();
    this.ackTimeout = opts.ackTimeout || DEFAULT_ACK_TIMEOUT;
    this.maxRetries = opts.maxRetries || DEFAULT_MAX_RETRIES;
    this.ttl = opts.ttl || DEFAULT_TTL;
    /** @type {Set<string>} paneIds that subscribe to broadcast */
    this.subscribers = new Set();

    this.metrics = {
      sent: 0,
      received: 0,
      expired: 0,
      retried: 0,
      ackTimeouts: 0,
      evicted: 0,
      broadcasts: 0,
      batchProcessed: 0,
      startTime: Date.now(),
    };

    // EMA latency (exponential moving average)
    this._emaLatency = 0;
    this._emaInitialized = false;

    // 60s circular buffer for rate calculation
    /** @type {Array<{ts: number, count: number}>} */
    this._rateBuffer = [];
    this._rateBufferInterval = null;

    // Batch queue: messages waiting to be flushed
    this._batchQueue = []; // Array<{to, msg}>
    this._batchTimer = null;

    // Periodic cleanup every 5s
    this._cleanupInterval = setInterval(() => this._cleanup(), 5000);
    if (this._cleanupInterval.unref) this._cleanupInterval.unref();

    // Rate buffer aggregation: snapshot current second's count every 1s
    this._rateBufferInterval = setInterval(() => this._snapshotRate(), 1000);
    if (this._rateBufferInterval.unref) this._rateBufferInterval.unref();

    // Batch flush timer
    this._batchTimer = setInterval(() => this._flushBatch(), BATCH_INTERVAL_MS);
    if (this._batchTimer.unref) this._batchTimer.unref();

    // Per-second send counter for rate buffer
    this._currentSecondCount = 0;
  }

  /**
   * Subscribe a pane to broadcast messages.
   * @param {string} paneId
   */
  subscribe(paneId) {
    this.subscribers.add(paneId);
  }

  /**
   * Unsubscribe a pane from broadcast messages.
   * @param {string} paneId
   */
  unsubscribe(paneId) {
    this.subscribers.delete(paneId);
  }

  /**
   * Send a message to a target pane. If to === 'broadcast', sends to all subscribers.
   * Messages are validated against the 13 known types.
   * @param {string} to - target paneId or 'broadcast'
   * @param {object} msg - { id, from, to, content, type, priority?, timestamp?, read? }
   */
  send(to, msg) {
    // Validate message type
    const type = msg.type || "update";
    if (!MESSAGE_TYPES.has(type)) {
      // Allow unknown types but emit a warning event
      this.emit("unknown_type", { type, from: msg.from, to });
    }

    // Broadcast support
    if (to === "broadcast" || to === BROADCAST_SUBSCRIBERS_KEY) {
      this.metrics.broadcasts++;
      const msgId = msg.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      for (const subscriberId of this.subscribers) {
        if (subscriberId !== msg.from) { // Don't send to self
          this._enqueueMessage(subscriberId, { ...msg, id: `${msgId}_${subscriberId}`, type });
        }
      }
      this.emit("broadcast", { from: msg.from, type, subscriberCount: this.subscribers.size });
      return msgId;
    }

    return this._enqueueMessage(to, { ...msg, type });
  }

  /**
   * Enqueue a message to a single pane (internal).
   */
  _enqueueMessage(to, msg) {
    const now = Date.now();
    const priority = msg.priority || "normal";
    const fullMsg = {
      id: msg.id || `msg_${now}_${Math.random().toString(36).slice(2, 8)}`,
      from: msg.from,
      to: to,
      content: msg.content,
      type: msg.type || "update",
      priority,
      timestamp: msg.timestamp || now,
      read: false,
      ttl: now + (msg.ttl || this.ttl),
      _sendTime: now,
    };

    // Insert into priority queue
    const queue = this._getOrCreateQueue(to);

    // Queue eviction: if at capacity, drop lowest priority messages
    if (queue.length >= MAX_QUEUE_SIZE) {
      this._evictLowest(queue);
    }

    this._insertSorted(queue, fullMsg);

    // Start ack timer
    this._startAckTimer(fullMsg);

    this.metrics.sent++;
    this._currentSecondCount++;

    this.emit("send", { id: fullMsg.id, from: fullMsg.from, to, type: fullMsg.type, priority });
    return fullMsg.id;
  }

  /**
   * Batch send: queue messages for batch processing instead of immediate send.
   * Messages are flushed in batches of BATCH_SIZE every BATCH_INTERVAL_MS.
   * @param {string} to
   * @param {object} msg
   */
  sendBatch(to, msg) {
    this._batchQueue.push({ to, msg });
    // If batch is full, flush immediately
    if (this._batchQueue.length >= BATCH_SIZE) {
      this._flushBatch();
    }
  }

  /**
   * Flush the batch queue (up to BATCH_SIZE messages per call).
   */
  _flushBatch() {
    if (this._batchQueue.length === 0) return;
    const batch = this._batchQueue.splice(0, BATCH_SIZE);
    for (const { to, msg } of batch) {
      this.send(to, msg);
    }
    this.metrics.batchProcessed += batch.length;
  }

  /**
   * Receive messages for a pane.
   * @param {string} paneId
   * @param {boolean} unreadOnly
   * @returns {Array<object>}
   */
  receive(paneId, unreadOnly = true) {
    const queue = this.queues.get(paneId);
    if (!queue || queue.length === 0) return [];

    const now = Date.now();
    const messages = [];

    if (unreadOnly) {
      for (const msg of queue) {
        if (!msg.read && now < msg.ttl) {
          msg.read = true;
          messages.push(this._sanitize(msg));
          this._clearAckTimer(msg.id);
          this.metrics.received++;
          // EMA latency update
          const latency = now - msg._sendTime;
          this._updateEmaLatency(latency);
          this.emit("receive", { id: msg.id, to: paneId, type: msg.type, latency });
        }
      }
    } else {
      for (const msg of queue) {
        if (now < msg.ttl) {
          messages.push(this._sanitize(msg));
        }
      }
    }

    return messages;
  }

  /**
   * Explicitly acknowledge a message.
   * @param {string} messageId
   */
  ack(messageId) {
    this._clearAckTimer(messageId);
    this.metrics.received++;
  }

  /**
   * Get metrics snapshot with EMA latency and 60s rate.
   */
  getMetrics() {
    const elapsed = (Date.now() - this.metrics.startTime) / 1000;

    // 60s windowed messages/sec
    const messagesPerSec = this._calculateRate();

    const queueDepths = {};
    for (const [paneId, queue] of this.queues) {
      const unread = queue.filter(m => !m.read && Date.now() < m.ttl).length;
      queueDepths[paneId] = { total: queue.length, unread };
    }

    return {
      ok: true,
      sent: this.metrics.sent,
      received: this.metrics.received,
      expired: this.metrics.expired,
      retried: this.metrics.retried,
      ackTimeouts: this.metrics.ackTimeouts,
      evicted: this.metrics.evicted,
      broadcasts: this.metrics.broadcasts,
      batchProcessed: this.metrics.batchProcessed,
      messagesPerSec: messagesPerSec.toFixed(2),
      avgLatencyMs: Math.round(this._emaLatency),
      emaLatencyMs: Math.round(this._emaLatency * 100) / 100,
      activeQueues: this.queues.size,
      pendingAcks: this.pendingAck.size,
      subscribers: this.subscribers.size,
      batchQueueSize: this._batchQueue.length,
      rateBufferSize: this._rateBuffer.length,
      queueDepths,
    };
  }

  /**
   * Get queue depth for a specific pane.
   */
  getQueueDepth(paneId) {
    const queue = this.queues.get(paneId);
    if (!queue) return 0;
    return queue.filter(m => !m.read && Date.now() < m.ttl).length;
  }

  // ─── Metrics Internals ───

  /**
   * Update EMA latency (exponential moving average, alpha=0.1).
   */
  _updateEmaLatency(latency) {
    if (!this._emaInitialized) {
      this._emaLatency = latency;
      this._emaInitialized = true;
    } else {
      this._emaLatency = EMA_ALPHA * latency + (1 - EMA_ALPHA) * this._emaLatency;
    }
  }

  /**
   * Snapshot current second's send count into the 60s circular buffer.
   */
  _snapshotRate() {
    const now = Date.now();
    if (this._currentSecondCount > 0) {
      this._rateBuffer.push({ ts: now, count: this._currentSecondCount });
      this._currentSecondCount = 0;
    }
    // Prune entries older than 60s
    const cutoff = now - RATE_WINDOW_MS;
    while (this._rateBuffer.length > 0 && this._rateBuffer[0].ts < cutoff) {
      this._rateBuffer.shift();
    }
  }

  /**
   * Calculate messages/sec from the 60s circular buffer.
   */
  _calculateRate() {
    if (this._rateBuffer.length === 0) return 0;
    const totalCount = this._rateBuffer.reduce((sum, e) => sum + e.count, 0);
    const windowMs = Date.now() - this._rateBuffer[0].ts;
    const windowSec = Math.max(windowMs / 1000, 1);
    return totalCount / windowSec;
  }

  // ─── Queue Management ───

  /**
   * Evict lowest-priority messages when queue is full.
   */
  _evictLowest(queue) {
    // Find and remove the lowest-priority, oldest message
    let worstIdx = -1;
    let worstPriority = -1;
    let worstTimestamp = Infinity;

    for (let i = 0; i < queue.length; i++) {
      const p = PRIORITY_ORDER[queue[i].priority] ?? 2;
      if (p > worstPriority || (p === worstPriority && queue[i].timestamp < worstTimestamp)) {
        worstPriority = p;
        worstTimestamp = queue[i].timestamp;
        worstIdx = i;
      }
    }

    if (worstIdx >= 0) {
      const evicted = queue.splice(worstIdx, 1)[0];
      this._clearAckTimer(evicted.id);
      this.metrics.evicted++;
      this.emit("evict", { id: evicted.id, priority: evicted.priority, to: evicted.to });
    }
  }

  /**
   * Clean up expired messages.
   */
  _cleanup() {
    const now = Date.now();
    for (const [paneId, queue] of this.queues) {
      for (let i = queue.length - 1; i >= 0; i--) {
        if (now >= queue[i].ttl) {
          const msg = queue[i];
          queue.splice(i, 1);
          this._clearAckTimer(msg.id);
          this.metrics.expired++;
          this.emit("expire", { id: msg.id, to: paneId, type: msg.type });
        }
      }
      if (queue.length === 0) {
        this.queues.delete(paneId);
      }
    }
  }

  /**
   * Insert message into sorted queue (priority ascending, then timestamp ascending).
   */
  _insertSorted(queue, msg) {
    const pOrder = PRIORITY_ORDER[msg.priority] ?? 2;
    let i = 0;
    for (; i < queue.length; i++) {
      const qP = PRIORITY_ORDER[queue[i].priority] ?? 2;
      if (pOrder < qP) break;
      if (pOrder === qP && msg.timestamp < queue[i].timestamp) break;
    }
    queue.splice(i, 0, msg);
  }

  /**
   * Start ack timer for a message. On timeout: retry or drop.
   */
  _startAckTimer(msg) {
    const timer = setTimeout(() => {
      const entry = this.pendingAck.get(msg.id);
      if (!entry) return;

      if (entry.retries < this.maxRetries) {
        entry.retries++;
        this.metrics.retried++;
        const escalated = this._escalatePriority(msg.priority);
        msg.priority = escalated;
        msg._ackDeadline = Date.now() + this.ackTimeout;
        this._insertSorted(this._getOrCreateQueue(msg.to), msg);
        const newTimer = setTimeout(() => this._onAckTimeout(msg), this.ackTimeout);
        if (newTimer.unref) newTimer.unref();
        this.pendingAck.set(msg.id, { timer: newTimer, msg, retries: entry.retries });
        this.emit("retry", { id: msg.id, retries: entry.retries, to: msg.to });
      } else {
        this.metrics.ackTimeouts++;
        this.pendingAck.delete(msg.id);
        this.emit("ack_timeout", { id: msg.id, to: msg.to });
      }
    }, this.ackTimeout);

    if (timer.unref) timer.unref();
    this.pendingAck.set(msg.id, { timer, msg, retries: 0 });
  }

  _onAckTimeout(msg) {
    const entry = this.pendingAck.get(msg.id);
    if (!entry) return;

    if (entry.retries < this.maxRetries) {
      entry.retries++;
      this.metrics.retried++;
      const escalated = this._escalatePriority(msg.priority);
      msg.priority = escalated;
      this._insertSorted(this._getOrCreateQueue(msg.to), msg);
      const newTimer = setTimeout(() => this._onAckTimeout(msg), this.ackTimeout);
      if (newTimer.unref) newTimer.unref();
      this.pendingAck.set(msg.id, { timer: newTimer, msg, retries: entry.retries });
      this.emit("retry", { id: msg.id, retries: entry.retries, to: msg.to });
    } else {
      this.metrics.ackTimeouts++;
      this.pendingAck.delete(msg.id);
      this.emit("ack_timeout", { id: msg.id, to: msg.to });
    }
  }

  _clearAckTimer(messageId) {
    const entry = this.pendingAck.get(messageId);
    if (entry) {
      clearTimeout(entry.timer);
      this.pendingAck.delete(messageId);
    }
  }

  _escalatePriority(current) {
    const order = PRIORITY_ORDER[current] ?? 2;
    if (order > 0) {
      return Object.keys(PRIORITY_ORDER).find(k => PRIORITY_ORDER[k] === order - 1) || current;
    }
    return current;
  }

  _getOrCreateQueue(paneId) {
    if (!this.queues.has(paneId)) {
      this.queues.set(paneId, []);
    }
    return this.queues.get(paneId);
  }

  _sanitize(msg) {
    return {
      id: msg.id,
      from: msg.from,
      to: msg.to,
      content: msg.content,
      type: msg.type,
      priority: msg.priority,
      timestamp: msg.timestamp,
      read: msg.read,
    };
  }

  /**
   * Shut down the bus: clear all timers, flush batch, remove listeners.
   */
  close() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
    if (this._rateBufferInterval) {
      clearInterval(this._rateBufferInterval);
      this._rateBufferInterval = null;
    }
    if (this._batchTimer) {
      clearInterval(this._batchTimer);
      this._batchTimer = null;
    }
    // Flush remaining batch
    this._flushBatch();
    for (const [, entry] of this.pendingAck) {
      clearTimeout(entry.timer);
    }
    this.pendingAck.clear();
    this.queues.clear();
    this.subscribers.clear();
    this._rateBuffer = [];
    this.removeAllListeners();
  }
}

module.exports = { MessageBus, MESSAGE_TYPES };
