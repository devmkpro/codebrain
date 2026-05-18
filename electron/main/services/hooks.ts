/**
 * Hooks System — Lifecycle event emitters for Codebrain.
 *
 * Inspired by Ruflo's 27 lifecycle hooks. Provides a central event bus
 * that all services can emit to and react from. Enables:
 * - Auto-notification when panes spawn/exit/idle
 * - Auto-dispatch workers on triggers
 * - Observability logging
 * - Future plugin system integration
 *
 * Hook types:
 *   pane_spawned   — a new pane was created
 *   pane_exited    — a pane terminated (expected or crash)
 *   pane_idle      — a pane became idle (no output for ~3s)
 *   message_sent   — an inter-agent message was dispatched
 *   message_received — an inter-agent message was received
 *   squad_spawned  — a squad (orchestrator + workers) was created
 *   task_started   — a worker began executing a task
 *   task_completed — a worker finished a task
 *   hook_registered — a new hook was added (meta-event)
 */

import { EventEmitter } from "node:events";
import log from "electron-log/main.js";
import type { PtyManager } from "../pty-manager";
import type { AppContext } from "../context";

export type HookEventType =
  | "pane_spawned"
  | "pane_exited"
  | "pane_idle"
  | "message_sent"
  | "message_received"
  | "squad_spawned"
  | "task_started"
  | "task_completed"
  | "hook_registered";

export interface HookEvent {
  type: HookEventType;
  paneId?: string;
  timestamp: number;
  data?: Record<string, unknown>;
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
  private maxLogSize = 500;
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

    this.emit("hook_registered", { type: "hook_registered", timestamp: Date.now(), data: { hookId: id, eventType } });
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
   */
  fire(type: HookEventType, data?: Record<string, unknown>, paneId?: string): void {
    const event: HookEvent = { type, paneId, timestamp: Date.now(), data };

    // Log the event
    this.eventLog.push(event);
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog.splice(0, this.eventLog.length - this.maxLogSize);
    }

    log.info(`[hooks] Fired "${type}"${paneId ? ` paneId=${paneId}` : ""}${data ? ` data=${JSON.stringify(data).slice(0, 200)}` : ""}`);
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
   * Get hook stats.
   */
  stats(): { totalHooks: number; totalEvents: number; byType: Record<string, number> } {
    const byType: Record<string, number> = {};
    for (const e of this.eventLog) {
      byType[e.type] = (byType[e.type] || 0) + 1;
    }
    return { totalHooks: this.hooks.size, totalEvents: this.eventLog.length, byType };
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
