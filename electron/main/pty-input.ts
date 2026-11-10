/** Serializes input so delayed paste chunks cannot be overtaken by Enter. */
export class PtyInputQueue {
  private pending: Array<{ text: string; pause: number; resolve?: () => void; reject?: (error: unknown) => void }> = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private failure: unknown;

  constructor(
    private readonly write: (text: string) => void,
    private readonly onError: (error: unknown) => void = () => {},
  ) {}

  enqueue(text: string, pauseAfterMs = 0): void {
    if (this.failure) throw this.failure;
    if (this.stopped || !text) return;
    this.append(text, pauseAfterMs);
  }

  /** Resolves only when the last chunk reaches the native write, not when queued. */
  enqueueAndWait(text: string, pauseAfterMs = 0): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.failure || this.stopped) { reject(this.failure ?? new Error("Terminal input closed.")); return; }
      if (!text) { resolve(); return; }
      this.append(text, pauseAfterMs, resolve, reject);
    });
  }

  private append(text: string, pauseAfterMs: number, resolve?: () => void, reject?: (error: unknown) => void): void {
    for (let offset = 0; offset < text.length;) {
      let end = Math.min(offset + 2048, text.length);
      // Never split an emoji's UTF-16 surrogate pair across native writes.
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      this.pending.push({ text: text.slice(offset, end), pause: end < text.length ? 15 : pauseAfterMs,
        ...(end === text.length ? { resolve, reject } : {}),
      });
      offset = end;
    }
    if (!this.timer) this.drain();
  }

  private drain(): void {
    this.timer = undefined;
    if (this.stopped) return;
    while (this.pending.length) {
      const chunk = this.pending.shift()!;
      try { this.write(chunk.text); } catch (error) {
        this.failure = error;
        chunk.reject?.(error);
        this.cancel(error);
        throw error;
      }
      if (this.stopped) { chunk.reject?.(new Error("Terminal input closed.")); return; }
      chunk.resolve?.();
      if (chunk.pause > 0) {
        this.timer = setTimeout(() => {
          try { this.drain(); } catch (error) { this.onError(error); }
        }, chunk.pause);
        return;
      }
    }
  }

  cancel(reason: unknown = new Error("Terminal input closed before submission.")): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    for (const chunk of this.pending.splice(0)) chunk.reject?.(reason);
  }
}
