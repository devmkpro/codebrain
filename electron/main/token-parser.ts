/**
 * Token Parser — extracts token usage from PTY output of CLI agents.
 *
 * Supports:
 *   - Claude Code / OpenClaude: JSON blocks with input_tokens/output_tokens
 *   - Gemini CLI: "Token count" or "token_count" patterns
 *   - MIMO: similar to Claude Code (Anthropic-compatible)
 *   - Generic: "Input tokens: N / Output tokens: N" or "Tokens: N in/out"
 *
 * @module token-parser
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  model?: string;
  totalTokens?: number;
}

/**
 * Try to extract token usage from an array of output lines.
 * Scans the most recent lines first (most likely to contain final usage stats).
 *
 * @param lines - Array of raw PTY output lines
 * @returns TokenUsage if found, null otherwise
 */
export function parseTokenUsage(lines: string[]): TokenUsage | null {
  if (!lines || lines.length === 0) return null;

  // Scan last 200 lines (usage typically appears near the end)
  const recent = lines.slice(-200);

  // Try each parser in order of specificity
  return (
    parseJsonTokenBlock(recent) ||
    parseClaudeCodeSummary(recent) ||
    parseGeminiTokenCount(recent) ||
    parseGenericTokenLine(recent) ||
    null
  );
}

/**
 * Pattern 1: JSON block with token fields
 * Matches: {"input_tokens":1234,"output_tokens":567,...}
 * Also matches: { "inputTokens": 1234, "outputTokens": 567 }
 */
function parseJsonTokenBlock(lines: string[]): TokenUsage | null {
  // Gemini headless JSON and Codex JSON events are nested objects. Parse
  // complete JSON values first so the aggregate usage object wins over a
  // per-model child object; keep the regex path below for mixed PTY lines.
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(stripAnsi(lines[i]));
      const usage = findStructuredUsage(parsed);
      if (usage) return usage;
    } catch {
      // PTY output usually mixes JSON with progress text; use regex fallback.
    }
  }

  // Join lines to catch multi-line JSON
  const joined = lines.join("\n");

  // Look for JSON-like patterns with token fields
  const patterns = [
    // Claude Code format: {"input_tokens":N,"output_tokens":N,"cache_read_input_tokens":N}
    /\{[^{}]*"input_tokens"\s*:\s*(\d+)[^{}]*"output_tokens"\s*:\s*(\d+)[^{}]*\}/,
    // Alternative order: output first
    /\{[^{}]*"output_tokens"\s*:\s*(\d+)[^{}]*"input_tokens"\s*:\s*(\d+)[^{}]*\}/,
    // camelCase variant
    /\{[^{}]*"inputTokens"\s*:\s*(\d+)[^{}]*"outputTokens"\s*:\s*(\d+)[^{}]*\}/,
  ];

  for (const pat of patterns) {
    const m = joined.match(pat);
    if (m) {
      const inputTokens = parseInt(m[1], 10);
      const outputTokens = parseInt(m[2], 10);
      if (inputTokens > 0 || outputTokens > 0) {
        const cacheReadMatch = joined.match(/"(?:cache_read_input_tokens|cached_content_token_count|cached)"\s*:\s*(\d+)/);
        const cacheWriteMatch = joined.match(/"(?:cache_creation_input_tokens|cache_write_input_tokens)"\s*:\s*(\d+)/);
        const result: TokenUsage = {
          inputTokens,
          outputTokens,
          cacheReadTokens: cacheReadMatch ? parseInt(cacheReadMatch[1], 10) : 0,
          cacheWriteTokens: cacheWriteMatch ? parseInt(cacheWriteMatch[1], 10) : 0,
        };
        // Try to extract model from the same JSON block
        const modelMatch = joined.match(/"model"\s*:\s*"([^"]+)"/);
        if (modelMatch) result.model = modelMatch[1];
        // Try total_tokens
        const totalMatch = joined.match(/"total_tokens"\s*:\s*(\d+)/);
        if (totalMatch) result.totalTokens = parseInt(totalMatch[1], 10);
        return result;
      }
    }
  }

  return null;
}

function findStructuredUsage(value: unknown, inheritedModel?: string): TokenUsage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const model = typeof record.model === "string" ? record.model : inheritedModel;
  const input = numberFrom(record, [
    "input_tokens", "inputTokens", "prompt_tokens", "promptTokenCount",
  ]) ?? numberFrom(record.tokens, ["prompt", "input"]);
  const output = numberFrom(record, [
    "output_tokens", "outputTokens", "completion_tokens", "candidatesTokenCount",
  ]) ?? numberFrom(record.tokens, ["candidates", "output"]);
  if (input !== undefined && output !== undefined && (input > 0 || output > 0)) {
    return {
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: numberFrom(record, [
        "cache_read_input_tokens", "cacheReadTokens", "cached_content_token_count", "cached",
      ]) ?? 0,
      cacheWriteTokens: numberFrom(record, ["cache_creation_input_tokens", "cacheWriteTokens"]) ?? 0,
      model,
      totalTokens: numberFrom(record, ["total_tokens", "totalTokens", "totalTokenCount"]),
    };
  }

  const values = Object.values(record);
  for (let i = values.length - 1; i >= 0; i--) {
    const nested = findStructuredUsage(values[i], model);
    if (nested) return nested;
  }
  return null;
}

function numberFrom(value: unknown, keys: string[]): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === "number" && Number.isFinite(record[key])) return record[key] as number;
  }
  return undefined;
}

/**
 * Pattern 2: Claude Code summary line
 * Matches: "Tokens: 1.2k in / 3.4k out" or "Total tokens: 1234 (in: 1000, out: 234)"
 */
function parseClaudeCodeSummary(lines: string[]): TokenUsage | null {
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 50); i--) {
    const line = stripAnsi(lines[i]);

    // "Tokens: 1.2k in / 3.4k out"
    const m1 = line.match(/Tokens?:\s*([\d.,]+[kKmM]?)\s*in\s*[/|]\s*([\d.,]+[kKmM]?)\s*out/i);
    if (m1) {
      return { inputTokens: parseTokenNumber(m1[1]), outputTokens: parseTokenNumber(m1[2]) };
    }

    // "Total tokens: 1234 (in: 1000, out: 234)"
    const m2 = line.match(/Total\s+tokens?:\s*[\d.,]+[kKmM]?\s*\(in:\s*([\d.,]+[kKmM]?),\s*out:\s*([\d.,]+[kKmM]?)\)/i);
    if (m2) {
      return { inputTokens: parseTokenNumber(m2[1]), outputTokens: parseTokenNumber(m2[2]) };
    }

    // "Input: 1234 tokens | Output: 5678 tokens"
    const m3 = line.match(/Input:\s*([\d.,]+[kKmM]?)\s*tokens?\s*[|/]\s*Output:\s*([\d.,]+[kKmM]?)\s*tokens?/i);
    if (m3) {
      return { inputTokens: parseTokenNumber(m3[1]), outputTokens: parseTokenNumber(m3[2]) };
    }

    // "▸ Input tokens: 1234"
    const m4 = line.match(/input\s*tokens?:\s*([\d.,]+[kKmM]?)/i);
    if (m4) {
      // Look for output on the next line
      const nextLine = i + 1 < lines.length ? stripAnsi(lines[i + 1]) : "";
      const m5 = nextLine.match(/output\s*tokens?:\s*([\d.,]+[kKmM]?)/i);
      if (m5) {
        return { inputTokens: parseTokenNumber(m4[1]), outputTokens: parseTokenNumber(m5[1]) };
      }
    }
  }
  return null;
}

/**
 * Pattern 3: Gemini token count
 * Matches: "Token count: 1234" or "tokens_used: 1234"
 */
function parseGeminiTokenCount(lines: string[]): TokenUsage | null {
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 50); i--) {
    const line = stripAnsi(lines[i]);

    // "Token count: 1234" (Gemini often reports total, not split)
    const m1 = line.match(/token\s*count:\s*([\d.,]+[kKmM]?)/i);
    if (m1) {
      const total = parseTokenNumber(m1[1]);
      return { inputTokens: Math.floor(total * 0.7), outputTokens: Math.ceil(total * 0.3), totalTokens: total };
    }

    // "tokens_used: 1234"
    const m2 = line.match(/tokens?_used:\s*([\d.,]+[kKmM]?)/i);
    if (m2) {
      const total = parseTokenNumber(m2[1]);
      return { inputTokens: Math.floor(total * 0.7), outputTokens: Math.ceil(total * 0.3), totalTokens: total };
    }
  }
  return null;
}

/**
 * Pattern 4: Generic token line
 * Matches various formats: "Used 1234 tokens", "1234 input + 5678 output tokens"
 */
function parseGenericTokenLine(lines: string[]): TokenUsage | null {
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 30); i--) {
    const line = stripAnsi(lines[i]);

    // "1234 input + 5678 output tokens"
    const m1 = line.match(/([\d.,]+[kKmM]?)\s*input\s*[+&]\s*([\d.,]+[kKmM]?)\s*output\s*tokens?/i);
    if (m1) {
      return { inputTokens: parseTokenNumber(m1[1]), outputTokens: parseTokenNumber(m1[2]) };
    }

    // "Used 1234 tokens" — total only
    const m2 = line.match(/Used\s+([\d.,]+[kKmM]?)\s+tokens?/i);
    if (m2) {
      const total = parseTokenNumber(m2[1]);
      if (total > 10) { // Ignore tiny numbers that might be false positives
        return { inputTokens: Math.floor(total * 0.7), outputTokens: Math.ceil(total * 0.3), totalTokens: total };
      }
    }
  }
  return null;
}

/**
 * Strip ANSI escape codes from a string.
 */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\r/g, "");
}

/**
 * Parse a token number string that might use k/m suffixes.
 * "1.2k" → 1200, "2M" → 2000000, "1,234" → 1234
 */
function parseTokenNumber(s: string): number {
  const clean = s.replace(/,/g, "").trim();
  const m = clean.match(/^([\d.]+)\s*([kKmM])?$/);
  if (!m) return parseInt(clean, 10) || 0;
  const num = parseFloat(m[1]);
  const suffix = (m[2] || "").toLowerCase();
  if (suffix === "k") return Math.round(num * 1000);
  if (suffix === "m") return Math.round(num * 1_000_000);
  return Math.round(num);
}
