import { EventEmitter } from "node:events";
import type { OutputBuffer } from "./output-buffer";

const DEFAULT_IDLE_TIMEOUT_MS = 3000;

export class IdleDetector extends EventEmitter {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Per-pane custom idle timeouts (overrides default). */
  private customTimeouts = new Map<string, number>();

  /**
   * Set a custom idle timeout for a specific pane.
   * Useful for review agents that need more time between API calls.
   */
  setIdleTimeout(paneId: string, ms: number): void {
    this.customTimeouts.set(paneId, ms);
  }

  /** Get the effective idle timeout for a pane. */
  getTimeout(paneId: string): number {
    return this.customTimeouts.get(paneId) ?? DEFAULT_IDLE_TIMEOUT_MS;
  }

  activity(paneId: string, buffer: OutputBuffer): void {
    this.cancel(paneId);
    const timeoutMs = this.getTimeout(paneId);
    const timer = setTimeout(() => {
      this.timers.delete(paneId);
      const lines = buffer.readPlain(50);
      this.emit("idle", { paneId, lastOutput: lines });
    }, timeoutMs);
    this.timers.set(paneId, timer);
  }

  cancel(paneId: string): void {
    const existing = this.timers.get(paneId);
    if (existing !== undefined) {
      clearTimeout(existing);
      this.timers.delete(paneId);
    }
  }

  cancelAll(): void {
    for (const [paneId] of this.timers) {
      this.cancel(paneId);
    }
  }
}
