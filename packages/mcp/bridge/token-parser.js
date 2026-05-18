"use strict";

/**
 * Token Parser — extracts token usage from PTY output of CLI agents.
 *
 * Supports:
 *   - Claude Code / OpenClaude: JSON blocks with input_tokens/output_tokens
 *   - Gemini CLI: "Token count" patterns
 *   - MIMO: similar to Claude Code (Anthropic-compatible)
 *   - Generic: "Input tokens: N / Output tokens: N" formats
 */

/**
 * Strip ANSI escape codes from a string.
 */
function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\r/g, "");
}

/**
 * Parse a token number string that might use k/m suffixes.
 * "1.2k" → 1200, "2M" → 2000000, "1,234" → 1234
 */
function parseTokenNumber(s) {
  const clean = s.replace(/,/g, "").trim();
  const m = clean.match(/^([\d.]+)\s*([kKmM])?$/);
  if (!m) return parseInt(clean, 10) || 0;
  const num = parseFloat(m[1]);
  const suffix = (m[2] || "").toLowerCase();
  if (suffix === "k") return Math.round(num * 1000);
  if (suffix === "m") return Math.round(num * 1_000_000);
  return Math.round(num);
}

/**
 * Pattern 1: JSON block with token fields
 */
function parseJsonTokenBlock(lines) {
  const joined = lines.join("\n");
  const patterns = [
    /\{[^{}]*"input_tokens"\s*:\s*(\d+)[^{}]*"output_tokens"\s*:\s*(\d+)[^{}]*\}/,
    /\{[^{}]*"output_tokens"\s*:\s*(\d+)[^{}]*"input_tokens"\s*:\s*(\d+)[^{}]*\}/,
    /\{[^{}]*"inputTokens"\s*:\s*(\d+)[^{}]*"outputTokens"\s*:\s*(\d+)[^{}]*\}/,
  ];

  for (const pat of patterns) {
    const m = joined.match(pat);
    if (m) {
      const inputTokens = parseInt(m[1], 10);
      const outputTokens = parseInt(m[2], 10);
      if (inputTokens > 0 || outputTokens > 0) {
        const result = { inputTokens, outputTokens };
        const modelMatch = joined.match(/"model"\s*:\s*"([^"]+)"/);
        if (modelMatch) result.model = modelMatch[1];
        const totalMatch = joined.match(/"total_tokens"\s*:\s*(\d+)/);
        if (totalMatch) result.totalTokens = parseInt(totalMatch[1], 10);
        return result;
      }
    }
  }
  return null;
}

/**
 * Pattern 2: Claude Code summary line
 */
function parseClaudeCodeSummary(lines) {
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 50); i--) {
    const line = stripAnsi(lines[i]);

    const m1 = line.match(/Tokens?:\s*([\d.,]+[kKmM]?)\s*in\s*[/|]\s*([\d.,]+[kKmM]?)\s*out/i);
    if (m1) {
      return { inputTokens: parseTokenNumber(m1[1]), outputTokens: parseTokenNumber(m1[2]) };
    }

    const m2 = line.match(/Total\s+tokens?:\s*[\d.,]+[kKmM]?\s*\(in:\s*([\d.,]+[kKmM]?),\s*out:\s*([\d.,]+[kKmM]?)\)/i);
    if (m2) {
      return { inputTokens: parseTokenNumber(m2[1]), outputTokens: parseTokenNumber(m2[2]) };
    }

    const m3 = line.match(/Input:\s*([\d.,]+[kKmM]?)\s*tokens?\s*[|/]\s*Output:\s*([\d.,]+[kKmM]?)\s*tokens?/i);
    if (m3) {
      return { inputTokens: parseTokenNumber(m3[1]), outputTokens: parseTokenNumber(m3[2]) };
    }

    const m4 = line.match(/input\s*tokens?:\s*([\d.,]+[kKmM]?)/i);
    if (m4) {
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
 */
function parseGeminiTokenCount(lines) {
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 50); i--) {
    const line = stripAnsi(lines[i]);

    const m1 = line.match(/token\s*count:\s*([\d.,]+[kKmM]?)/i);
    if (m1) {
      const total = parseTokenNumber(m1[1]);
      return { inputTokens: Math.floor(total * 0.7), outputTokens: Math.ceil(total * 0.3), totalTokens: total };
    }

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
 */
function parseGenericTokenLine(lines) {
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 30); i--) {
    const line = stripAnsi(lines[i]);

    const m1 = line.match(/([\d.,]+[kKmM]?)\s*input\s*[+&]\s*([\d.,]+[kKmM]?)\s*output\s*tokens?/i);
    if (m1) {
      return { inputTokens: parseTokenNumber(m1[1]), outputTokens: parseTokenNumber(m1[2]) };
    }

    const m2 = line.match(/Used\s+([\d.,]+[kKmM]?)\s+tokens?/i);
    if (m2) {
      const total = parseTokenNumber(m2[1]);
      if (total > 10) {
        return { inputTokens: Math.floor(total * 0.7), outputTokens: Math.ceil(total * 0.3), totalTokens: total };
      }
    }
  }
  return null;
}

/**
 * Try to extract token usage from an array of output lines.
 * @param {string[]} lines - Array of raw PTY output lines
 * @returns {{ inputTokens: number, outputTokens: number, model?: string, totalTokens?: number } | null}
 */
function parseTokenUsage(lines) {
  if (!lines || lines.length === 0) return null;
  const recent = lines.slice(-200);
  return (
    parseJsonTokenBlock(recent) ||
    parseClaudeCodeSummary(recent) ||
    parseGeminiTokenCount(recent) ||
    parseGenericTokenLine(recent) ||
    null
  );
}

module.exports = { parseTokenUsage, stripAnsi, parseTokenNumber };
