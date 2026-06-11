/**
 * Hooks System — Lifecycle event emitters for Codebrain.
 *
 * Inspired by Ruflo's 27 lifecycle hooks. Provides a central event bus
 * that all services can emit to and react from. Enables:
 * - Auto-notification when panes spawn/exit/idle
 * - Auto-dispatch workers on triggers
 * - Observability logging
 * - Future plugin system integration
 */

import { EventEmitter } from "node:events";
import { exec } from "node:child_process";
import log from "electron-log/main.js";
import type { PtyManager } from "../pty-manager";
import type { AppContext } from "../context";
import { randomBytes } from "node:crypto";

export type HookEventType =
  | "pane_spawned"
  | "pane_exited"
  | "pane_idle"
  | "message_sent"
  | "message_received"
  | "squad_spawned"
  | "task_started"
  | "task_completed"
  | "hook_registered"
  // New tool-call interception hooks
  | "pre_tool_use"
  | "post_tool_use"
  | "pre_task"
  | "post_task"
  // New observability hooks
  | "file_written"
  | "memory_written"
  | "error_occurred"
  | "performance_metric"
  | "consensus_vote"
  | "consensus_result"
  | "worker_started"
  | "worker_stopped"
  | "worker_alert";

export interface HookEvent {
  type: HookEventType;
  paneId?: string;
  timestamp: number;
  data?: Record<string, unknown>;
  correlationId?: string;
}

export type HookHandler = (event: HookEvent) => void | Promise<void>;

export interface HookRegistration {
  id: string;
  eventType: HookEventType;
  handler: HookHandler;
  once?: boolean;
  description?: string;
}

export class HooksManager extends EventEmitter {
  private hooks = new Map<string, HookRegistration>();
  private eventLog: HookEvent[] = [];
  private maxLogSize = 1000; // Increased for more detailed logging
  private hookCounter = 0;

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /**
   * Register a hook handler for a specific event type.
   */
  register(eventType: HookEventType, handler: HookHandler, opts?: { once?: boolean; description?: string }): string {
    const id = `hook_${++this.hookCounter}_${Date.now()}`;
    const reg: HookRegistration = { id, eventType, handler, once: opts?.once, description: opts?.description };
    this.hooks.set(id, reg);

    if (opts?.once) {
      this.once(eventType, handler);
    } else {
      this.on(eventType, handler);
    }

    this.fire("hook_registered", { hookId: id, eventType });
    log.info(`[hooks] Registered ${opts?.once ? "one-time " : ""}hook "${id}" for "${eventType}"${opts?.description ? `: ${opts.description}` : ""}`);
    return id;
  }

  /**
   * Unregister a hook by ID.
   */
  unregister(hookId: string): boolean {
    const reg = this.hooks.get(hookId);
    if (!reg) return false;
    this.removeListener(reg.eventType, reg.handler);
    this.hooks.delete(hookId);
    log.info(`[hooks] Unregistered hook "${hookId}" for "${reg.eventType}"`);
    return true;
  }

  /**
   * Emit a hook event. Logs it and dispatches to all registered handlers.
   * Now with correlation ID support for tracing.
   */
  fire(type: HookEventType, data?: Record<string, unknown>, paneId?: string, correlationId?: string): void {
    const event: HookEvent = {
      type,
      paneId,
      timestamp: Date.now(),
      data,
      correlationId: correlationId || `corr_${Date.now()}_${randomBytes(4).toString("hex")}`,
    };

    // Log the event
    this.eventLog.push(event);
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog.splice(0, this.eventLog.length - this.maxLogSize);
    }

    log.info(`[hooks] Fired "${type}" corrId=${event.correlationId}${paneId ? ` paneId=${paneId}` : ""}${data ? ` data=${JSON.stringify(data).slice(0, 200)}` : ""}`);
    this.emit(type, event);
  }

  /**
   * Get recent hook events (for diagnostics).
   */
  getLog(limit = 50): HookEvent[] {
    return this.eventLog.slice(-limit);
  }

  /**
   * List registered hooks.
   */
  list(): Array<{ id: string; eventType: string; description?: string; once?: boolean }> {
    return Array.from(this.hooks.values()).map((h) => ({
      id: h.id,
      eventType: h.eventType,
      description: h.description,
      once: h.once,
    }));
  }

  /**
   * Export the event log in various formats with filtering.
   */
  exportLogs(format: 'jsonl' | 'csv', opts: { since?: number; types?: HookEventType[]; limit?: number } = {}): string {
    let filteredLog = this.eventLog;

    if (opts.since) {
      filteredLog = filteredLog.filter(e => e.timestamp >= opts.since);
    }
    if (opts.types && opts.types.length > 0) {
      filteredLog = filteredLog.filter(e => opts.types.includes(e.type));
    }
    if (opts.limit) {
      filteredLog = filteredLog.slice(-opts.limit);
    }

    if (format === 'jsonl') {
      return filteredLog.map(e => JSON.stringify(e)).join('\\n');
    }

    if (format === 'csv') {
      const header = 'type,paneId,timestamp,correlationId,data_json\\n';
      const rows = filteredLog.map(e =>
        `${e.type},${e.paneId || ''},${e.timestamp},${e.correlationId || ''},"${JSON.stringify(e.data || {}).replace(/"/g, '""')}"`
      );
      return header + rows.join('\\n');
    }

    return "";
  }

  /**
   * Get advanced event statistics.
   */
  eventStats(): {
    totalEvents: number;
    eventsByType: Record<string, number>;
    eventsPerMinute: number;
    avgEventsPerCorrelation: number;
    mostActivePane: { paneId: string; count: number } | null;
  } {
    const now = Date.now();
    const last60Mins = now - 60 * 60 * 1000;
    const eventsInLastHour = this.eventLog.filter(e => e.timestamp >= last60Mins);

    const eventsByType: Record<string, number> = {};
    const eventsByCorrId: Record<string, number> = {};
    const eventsByPaneId: Record<string, number> = {};

    for (const e of this.eventLog) {
      eventsByType[e.type] = (eventsByType[e.type] || 0) + 1;
      if (e.correlationId) {
        eventsByCorrId[e.correlationId] = (eventsByCorrId[e.correlationId] || 0) + 1;
      }
      if (e.paneId) {
        eventsByPaneId[e.paneId] = (eventsByPaneId[e.paneId] || 0) + 1;
      }
    }
    
    const corrIdsCount = Object.keys(eventsByCorrId).length;
    const avgEventsPerCorrelation = corrIdsCount > 0 ? this.eventLog.length / corrIdsCount : 0;
    
    let mostActivePane: { paneId: string; count: number } | null = null;
    if (Object.keys(eventsByPaneId).length > 0) {
        const [paneId, count] = Object.entries(eventsByPaneId).sort((a, b) => b[1] - a[1])[0];
        mostActivePane = { paneId, count };
    }

    return {
      totalEvents: this.eventLog.length,
      eventsByType,
      eventsPerMinute: eventsInLastHour.length / 60,
      avgEventsPerCorrelation,
      mostActivePane
    };
  }

  /**
   * Get hook stats.
   * @deprecated Use eventStats() for more detailed metrics.
   */
  stats(): { totalHooks: number; totalEvents: number; byType: Record<string, number> } {
    const byType: Record<string, number> = {};
    for (const e of this.eventLog) {
      byType[e.type] = (byType[e.type] || 0) + 1;
    }
    return { totalHooks: this.hooks.size, totalEvents: this.eventLog.length, byType };
  }

  /**
   * Feature 9: Run any registered "pre_spawn" command-hooks before a pane spawns.
   * Hooks with a `command` field in their description are executed via child_process.exec.
   * Errors are logged but never thrown — hooks are best-effort.
   */
  async runPreSpawnHooks(paneId: string, agent: string, cwd: string): Promise<void> {
    // Collect all registered hooks whose eventType is "pre_spawn" and have a command
    const preSpawnHooks = Array.from(this.hooks.values()).filter(
      (h) => h.eventType === ("pre_spawn" as HookEventType) && typeof h.description === "string" && h.description.startsWith("cmd:")
    );
    for (const hook of preSpawnHooks) {
      const command = hook.description!.slice(4); // strip "cmd:" prefix
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 5500);
        exec(
          command,
          {
            timeout: 5000,
            env: {
              ...process.env,
              CODEBRAIN_PANE_ID: paneId,
              CODEBRAIN_AGENT: agent,
              CODEBRAIN_CWD: cwd,
            },
          },
          (err, stdout, stderr) => {
            clearTimeout(timer);
            if (err) {
              log.warn(`[hooks] pre_spawn hook failed (${command}):`, err.message);
            } else {
              if (stdout?.trim()) log.info("[hooks] pre_spawn stdout:", stdout.trim());
              if (stderr?.trim()) log.warn("[hooks] pre_spawn stderr:", stderr.trim());
            }
            resolve();
          }
        );
      });
    }
  }
}

/**
 * Wire the hooks system into PtyManager and AppContext lifecycle.
 * Call this once during app initialization.
 */
export function setupHooks(hooks: HooksManager, ptyManager: PtyManager, ctx: AppContext): void {
  // Wire PtyManager events → hooks
  ptyManager.on("exit", (paneId: string, exitCode: number) => {
    hooks.fire("pane_exited", { exitCode, agent: ctx.paneConfigs.get(paneId)?.agent }, paneId);
  });

  ptyManager.on("idle", ({ paneId, idle }: { paneId: string; idle: { lastOutput?: string[] } }) => {
    hooks.fire("pane_idle", { lastOutput: idle.lastOutput?.slice(-3) }, paneId);
  });

  log.info("[hooks] Hooks system initialized with PtyManager wiring");
}
