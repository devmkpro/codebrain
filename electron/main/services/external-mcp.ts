import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface ExternalMcpServer {
  command: string;
  args: string[];
  env?: Record<string, string>;
}
export type ExternalMcpServers = Record<string, ExternalMcpServer>;

/** Only explicitly registered user-level servers. Never discover executables by
 * running them or import commands from an untrusted project's context files. */
export function readExternalMcpServers(home = os.homedir()): ExternalMcpServers {
  const file = path.join(home, ".codebrain", "mcp.json");
  if (!fs.existsSync(file)) return {};
  const root = JSON.parse(fs.readFileSync(file, "utf8"));
  const entries = root?.mcpServers;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) throw new Error("Registro MCP externo inválido.");
  const result: ExternalMcpServers = {};
  for (const [name, value] of Object.entries(entries).slice(0, 64)) {
    if (["codebrain", "__proto__", "constructor", "prototype"].includes(name) || !/^[a-zA-Z0-9_-]{1,80}$/.test(name)) continue;
    const server = value as any;
    if (server?.disabled === true) continue;
    if (typeof server?.command !== "string" || !server.command.trim() || /[\r\n\0]/.test(server.command)) throw new Error("Comando MCP externo inválido.");
    const args = server.args ?? [];
    if (!Array.isArray(args) || args.some((arg: unknown) => typeof arg !== "string" || arg.includes("\0"))) throw new Error("Argumentos MCP externos inválidos.");
    if (server.env && (typeof server.env !== "object" || Array.isArray(server.env) || Object.values(server.env).some(value => typeof value !== "string"))) throw new Error("Ambiente MCP externo inválido.");
    result[name] = { command: server.command, args, ...(server.env ? { env: server.env } : {}) };
  }
  return result;
}

/** User project definitions win over defaults; only the managed Codebrain
 * transport is replaced. Invalid files are not overwritten. */
export function mergeMcpFile(file: string, defaults: Record<string, unknown>, key = "mcpServers"): void {
  let root: Record<string, any> = {};
  try { root = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (!root || typeof root !== "object" || Array.isArray(root) || (root[key] && (typeof root[key] !== "object" || Array.isArray(root[key])))) throw new Error("Configuração MCP existente inválida; preservada.");
  root[key] = { ...defaults, ...root[key], ...(defaults.codebrain ? { codebrain: defaults.codebrain } : {}) };
  const text = JSON.stringify(root, null, 2) + "\n";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

/** TOML literals use JSON's basic string/array encoding; no raw shell code. */
export function externalMcpOverrides(servers: ExternalMcpServers): string[] {
  return Object.entries(servers).flatMap(([name, server]) => {
    const key = `mcp_servers.${JSON.stringify(name)}`;
    const entries: [string, unknown][] = [["command", server.command], ["args", server.args]];
    for (const [envName, value] of Object.entries(server.env ?? {})) entries.push([`env.${JSON.stringify(envName)}`, value]);
    return entries.flatMap(([field, value]) => ["-c", `${key}.${field}=${JSON.stringify(value)}`]);
  });
}
