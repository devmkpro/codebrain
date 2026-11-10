/** Serializes input so delayed paste chunks cannot be overtaken by Enter. */
export class PtyInputQueue {
  private pending: Array<{ text: string; pause: number }> = [];
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
    for (let offset = 0; offset < text.length;) {
      let end = Math.min(offset + 2048, text.length);
      // Never split an emoji's UTF-16 surrogate pair across native writes.
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      this.pending.push({ text: text.slice(offset, end), pause: end < text.length ? 15 : pauseAfterMs });
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
        this.cancel();
        throw error;
      }
      if (chunk.pause > 0) {
        this.timer = setTimeout(() => {
          try { this.drain(); } catch (error) { this.onError(error); }
        }, chunk.pause);
        return;
      }
    }
  }

  cancel(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending.length = 0;
  }
}
