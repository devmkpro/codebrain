import { spawn } from "node:child_process";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import { resolveCommand } from "../pty-manager";
import { sortModelIds } from "../../../src/lib/model-catalog-order";

// Anthropic Agent SDK initialize response: ModelInfo.resolvedModel is the
// native, versioned ID behind an alias. No user turn or inference is sent.
// https://code.claude.com/docs/en/agent-sdk/typescript#modelinfo
export function parseClaudeModelInfo(models: unknown): string[] {
  if (!Array.isArray(models)) return [];
  return sortModelIds(models.flatMap(entry => {
    const id = entry?.resolvedModel ?? entry?.value;
    return typeof id === "string" && /^[a-zA-Z0-9][\w./:+-]*$/.test(id) && /\d/.test(id) ? [id] : [];
  }));
}

export function claudeCatalogArgs(help: string): string[] {
  const required = ["--print", "--input-format", "--output-format", "--verbose", "--strict-mcp-config", "--mcp-config", "--settings", "--setting-sources", "--no-session-persistence"];
  if (required.some(flag => !help.includes(flag))) throw new Error("esta CLI Claude não oferece consulta de metadados validada; atualize a CLI ou use IDs manuais");
  return ["--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
    "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--settings", '{"disableAllHooks":true}',
    "--setting-sources", "user", "--no-session-persistence"];
}

export async function readClaudeModelCatalog(binary: string, help: string): Promise<string[]> {
  const args = claudeCatalogArgs(help);
  const command = process.platform === "win32" && /\.(cmd|bat)$/i.test(binary) ? resolveCommand("claude", args) : { binary, args };
  if ("unavailable" in command && command.unavailable) throw new Error("CLI Claude indisponível para consultar modelos.");
  return new Promise((resolve, reject) => {
    const requestId = `codebrain-models-${randomUUID()}`;
    const child = spawn(command.binary, command.args, { cwd: os.tmpdir(), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (models?: string[]) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      child.stdin.end();
      // EOF normally exits print mode. Bound a broken metadata-only child too.
      killTimer = setTimeout(() => { if (child.exitCode === null) child.kill(); }, 500);
      killTimer.unref?.();
      if (models?.length) resolve(models);
      else reject(new Error("a CLI Claude não retornou IDs resolvidos de modelos; use o seletor nativo ou atualize a CLI"));
    };
    const timer = setTimeout(() => finish(), 8000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) { finish(); return; }
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try {
          const message = JSON.parse(line);
          if (message.type === "control_response" && message.response?.request_id === requestId) {
            finish(message.response.subtype === "success" ? parseClaudeModelInfo(message.response.response?.models) : undefined);
          }
        } catch { /* Non-protocol stdout is never logged or returned. */ }
      }
    });
    child.stderr.resume(); // Consume, never expose credentials or raw diagnostics.
    child.on("error", () => finish());
    child.stdin.on("error", () => finish());
    child.on("close", () => { if (!settled) finish(); if (killTimer) clearTimeout(killTimer); });
    child.stdin.write(JSON.stringify({ type: "control_request", request_id: requestId, request: { subtype: "initialize" } }) + "\n");
  });
}
