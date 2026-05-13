import { EventEmitter } from "node:events";
import type { OutputBuffer } from "./output-buffer";

const IDLE_TIMEOUT_MS = 3000;

export class IdleDetector extends EventEmitter {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  activity(paneId: string, buffer: OutputBuffer): void {
    this.cancel(paneId);
    const timer = setTimeout(() => {
      this.timers.delete(paneId);
      const lines = buffer.readPlain(50);
      this.emit("idle", { paneId, lastOutput: lines });
    }, IDLE_TIMEOUT_MS);
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
