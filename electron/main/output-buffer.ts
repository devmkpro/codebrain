import { stripVTControlCharacters } from "node:util";

export class OutputBuffer {
  private rawChunks: string[] = [];
  private rawChunkChars = 0;
  private rawLines: string[] = [];
  private plainLines: string[] = [];
  private maxLines: number;
  private maxRawChars: number;
  private partial = "";

  constructor(maxLines = 1000) {
    this.maxLines = maxLines;
    this.maxRawChars = maxLines * 1000;
  }

  push(raw: string): void {
    this.rawChunks.push(raw);
    this.rawChunkChars += raw.length;

    while (this.rawChunkChars > this.maxRawChars && this.rawChunks.length > 1) {
      this.rawChunkChars -= this.rawChunks.shift()?.length ?? 0;
    }

    const combined = this.partial + raw;
    const parts = combined.split("\n");
    this.partial = parts.pop() ?? "";

    for (const line of parts) {
      this.rawLines.push(line);
      this.plainLines.push(this.stripAnsi(line));
      if (this.rawLines.length > this.maxLines) {
        this.rawLines.shift();
        this.plainLines.shift();
      }
    }
  }

  readRaw(n = 50): string[] {
    return this.rawLines.slice(-n);
  }

  readRawText(): string {
    return this.rawChunks.join("");
  }

  readPlain(n = 50): string[] {
    // A shell prompt normally has no trailing newline. Excluding the current
    // line makes MCP see stale output and prevents idle SSH shells from writing.
    const tail = this.partial ? [...this.plainLines, this.stripAnsi(this.partial)] : this.plainLines;
    return tail.slice(-n);
  }

  get lineCount(): number {
    return this.rawLines.length;
  }

  clear(): void {
    this.rawChunks = [];
    this.rawChunkChars = 0;
    this.rawLines = [];
    this.plainLines = [];
    this.partial = "";
  }

  private stripAnsi(text: string): string {
    return stripVTControlCharacters(text);
  }
}
