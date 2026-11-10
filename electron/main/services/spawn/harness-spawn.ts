/**
 * Registry-driven spawn wiring: the one branch shared by every `spawn: "generic"`
 * CLI. It only writes config files and returns flags. A failed write logs and the
 * CLI still launches, without that part of the Codebrain wiring.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import log from "electron-log/main.js";
import type { ExternalMcpServer, ExternalMcpServers } from "../external-mcp";
export type { ExternalMcpServers } from "../external-mcp";
import {
  MANAGED_FILE_MARKER,
  buildHarnessArgs,
  buildOpencodeConfig,
  hermesHome,
  jsonMcpEntry,
  mergeJsonServer,
  museSettingsPath,
  upsertHermesMcpServer,
  upsertTomlMcpServer,
  type HarnessEntry,
} from "./cli-registry";

export type ExternalMcpStdioServer = ExternalMcpServer;

export interface PrepareHarnessInput {
  args: readonly string[];
  /** Mutated in place, like the other branches in pane-spawn. */
  env: Record<string, string>;
  cwd: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  resumeSessionId?: string;
  mcpUrl?: string;
  /** Validated servers from the host's external-mcp reader; never inferred paths. */
  externalMcpServers?: ExternalMcpServers;
  /** Builds the Codebrain prompt and returns its file path. */
  buildPromptFile: () => string;
}

const readOrNull = (file: string): string | null => {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

/** Write through a temp file so a concurrent spawn never reads a partial config. */
function writeAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, content, { encoding: "utf-8", flag: "wx" });
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function writeManagedFile(file: string, header: string, prompt: string): boolean {
  const current = readOrNull(file);
  if (current !== null && !current.startsWith(`${header}${MANAGED_FILE_MARKER}\n`)) {
    log.warn(`[harness-spawn] ${file} já existe e não é do Codebrain; instruções não injetadas`);
    return false;
  }
  writeAtomic(file, `${header}${MANAGED_FILE_MARKER}\n\n${prompt}`);
  return true;
}

function wireMcpFile(entry: HarnessEntry, input: PrepareHarnessInput, url: string): void {
  const mcp = entry.generic?.mcp;
  if (!mcp) return;

  const upsert = (file: string, render: (text: string | null) => string | null): void => {
    const next = render(readOrNull(file));
    if (next === null) {
      log.warn(`[harness-spawn] ${entry.id}: ${file} ilegível; MCP do Codebrain não configurado`);
      return;
    }
    writeAtomic(file, next);
    log.info(`[harness-spawn] ${entry.id}: MCP configurado em ${file}`);
  };

  if (mcp.via === "json-file") {
    upsert(path.join(input.cwd, mcp.relPath), (text) => mergeJsonServer(text, "mcpServers", jsonMcpEntry(mcp.entry, url)));
  } else if (mcp.via === "toml-file") {
    upsert(path.join(input.cwd, mcp.relPath), (text) => upsertTomlMcpServer(text ?? "", url));
  } else if (mcp.via === "hermes-yaml") {
    const merged = { ...process.env, ...input.env };
    upsert(path.join(hermesHome(merged), "config.yaml"), (text) => upsertHermesMcpServer(text ?? "", url));
  } else if (mcp.via === "muse-settings") {
    // `optional`: an unreachable Codebrain must not abort the Muse session.
    upsert(museSettingsPath({ ...process.env, ...input.env }), (text) => {
      // Both spellings are supported, but writing both disables MCP in Muse.
      const root = text ? JSON.parse(text) : {};
      const legacy = Object.hasOwn(root, "mcp_servers");
      if (legacy && Object.hasOwn(root, "mcpServers")) return null;
      const server = legacy
        ? { transport: "streamable_http", url, enabled: true, mode: "optional" }
        : { type: "streamable-http", url, enabled: true, required: false };
      return mergeJsonServer(text, legacy ? "mcp_servers" : "mcpServers", server, { schema_version: 1 });
    });
  }
}

/** Adds stdio servers only for confirmed schemas; explicit destination entries win. */
export function wireExternalMcpServers(entry: HarnessEntry, input: PrepareHarnessInput, servers: ExternalMcpServers): void {
  if (!entry.verified || !entry.capabilities.mcp || entry.spawn !== "generic") return;
  const mcp = entry.generic?.mcp;
  if (!mcp) return;
  const valid = Object.entries(servers).filter(([name, server]) =>
    name !== "codebrain" && name !== "__proto__" && name !== "constructor" && name !== "prototype" &&
    name.trim().length > 0 && server && typeof server.command === "string" && server.command.trim().length > 0 &&
    Array.isArray(server.args) && server.args.every((arg) => typeof arg === "string"));
  if (!valid.length) return;

  const merge = (text: string | null, key: string, render: (server: ExternalMcpStdioServer) => object, seed: object = {}): string => {
    const root = text === null ? {} : JSON.parse(text);
    if (!root || typeof root !== "object" || Array.isArray(root)) throw new Error("Invalid MCP config root");
    const current = root[key] === undefined ? {} : root[key];
    if (!current || typeof current !== "object" || Array.isArray(current)) throw new Error(`Invalid ${key}`);
    const additions = Object.fromEntries(valid.filter(([name]) => !Object.hasOwn(current, name)).map(([name, server]) => [name, render(server)]));
    return `${JSON.stringify({ ...seed, ...root, [key]: { ...additions, ...current } }, null, 2)}\n`;
  };

  try {
    if (mcp.via === "opencode-env" && entry.id === "opencode") {
      const existing = input.env["OPENCODE_CONFIG_CONTENT"] ?? process.env["OPENCODE_CONFIG_CONTENT"] ?? null;
      input.env["OPENCODE_CONFIG_CONTENT"] = merge(existing, "mcp", (server) => ({ type: "local", command: [server.command, ...server.args], ...(server.env ? { environment: { ...server.env } } : {}), enabled: true }));
    } else if (mcp.via === "json-file" && ["kiro", "antigravity", "commandcode"].includes(entry.id)) {
      const file = path.join(input.cwd, mcp.relPath);
      // Kiro's standard stdio entry omits `type`; Command Code uses typed stdio.
      writeAtomic(file, merge(readOrNull(file), "mcpServers", (server) => ({
        ...(entry.id === "commandcode" ? { type: "stdio" } : {}), command: server.command, args: [...server.args], ...(server.env ? { env: { ...server.env } } : {}),
      })));
    } else if (mcp.via === "muse-settings" && entry.id === "muse") {
      const file = museSettingsPath({ ...process.env, ...input.env });
      const text = readOrNull(file);
      const root = text === null ? {} : JSON.parse(text);
      if (!root || typeof root !== "object" || Array.isArray(root)) throw new Error("Invalid Muse settings");
      const legacy = Object.hasOwn(root, "mcp_servers");
      if (legacy && Object.hasOwn(root, "mcpServers")) throw new Error("Conflicting Muse MCP keys");
      writeAtomic(file, merge(text, legacy ? "mcp_servers" : "mcpServers", (server) => legacy
        ? { transport: "stdio", command: server.command, args: [...server.args], ...(server.env ? { env: { ...server.env } } : {}), enabled: true, mode: "optional" }
        : { type: "stdio", command: server.command, args: [...server.args], ...(server.env ? { env: { ...server.env } } : {}), enabled: true, required: false }, { schema_version: 1 }));
    }
  } catch {
    log.warn(`[harness-spawn] ${entry.id}: MCP externo não configurado; configuração existente preservada`);
  }
}

/** Returns the prompt text only when it must travel as a flag. */
function wireInstructions(entry: HarnessEntry, input: PrepareHarnessInput): { text?: string; promptFile?: string; extraArgs: string[] } {
  const wiring = entry.generic?.instructions;
  const none = { extraArgs: [] as string[] };
  if (!wiring) return none;
  const terminator = input.args.indexOf("--");
  const options = terminator < 0 ? input.args : input.args.slice(0, terminator);
  if (wiring.via === "kiro-agent" && options.some((arg) => arg === "--agent" || arg.startsWith("--agent="))) return none;

  if (wiring.via === "file" && wiring.unlessExists?.some((name) => fs.existsSync(path.join(input.cwd, name)))) {
    log.warn(`[harness-spawn] ${entry.id}: ${wiring.unlessExists.join(", ")} tem prioridade; instruções não injetadas`);
    return none;
  }

  const promptFile = input.buildPromptFile();
  if (wiring.via === "opencode-env") return { promptFile, extraArgs: [] };

  const prompt = fs.readFileSync(promptFile, "utf-8");
  // Shared steering/skill files race when different panes launch together.
  const name = `codebrain-${createHash("sha256").update(prompt).digest("hex").slice(0, 20)}`;
  if (wiring.via === "kiro-agent") {
    const file = path.join(input.cwd, ".kiro", "agents", `${name}.json`);
    const current = readOrNull(file);
    if (current !== null && JSON.parse(current).description !== MANAGED_FILE_MARKER) return none;
    writeAtomic(file, JSON.stringify({ name, description: MANAGED_FILE_MARKER, includeMcpJson: true, prompt }, null, 2));
    return { extraArgs: ["--agent", name] };
  }
  if (wiring.via === "flag") {
    if (prompt.length > wiring.maxChars) {
      log.warn(`[harness-spawn] ${entry.id}: prompt com ${prompt.length} caracteres excede ${wiring.flag}; instruções não injetadas`);
      return none;
    }
    return { text: prompt, extraArgs: [] };
  }
  if (wiring.via === "file") {
    writeManagedFile(path.join(input.cwd, wiring.relPath), wiring.frontmatter ?? "", prompt);
    return none;
  }

  const skillFile = path.join(hermesHome({ ...process.env, ...input.env }), "skills", name, "SKILL.md");
  const header = `---\nname: ${name}\ndescription: Contexto do workspace Codebrain e guia das ferramentas MCP.\n---\n`;
  return writeManagedFile(skillFile, header, prompt) ? { extraArgs: ["-s", name] } : none;
}

/** Applies model, effort, permissions, MCP and instructions; returns the final args. */
export function prepareGenericHarness(entry: HarnessEntry, input: PrepareHarnessInput): string[] {
  if (!entry.verified) return [...input.args];
  const skipPermissions = input.permissionMode === undefined || input.permissionMode === "bypassPermissions";

  let instructions: ReturnType<typeof wireInstructions> = { extraArgs: [] };
  try {
    instructions = wireInstructions(entry, input);
  } catch (error) {
    log.warn(`[harness-spawn] ${entry.id}: falha ao gravar instruções:`, error);
  }

  if (input.mcpUrl) {
    try {
      wireMcpFile(entry, input, input.mcpUrl);
    } catch (error) {
      log.warn(`[harness-spawn] ${entry.id}: falha ao configurar MCP:`, error);
    }
  }

  const usesOpencodeEnv = entry.generic?.mcp?.via === "opencode-env";
  if (usesOpencodeEnv) {
    const existing = input.env["OPENCODE_CONFIG_CONTENT"] ?? process.env["OPENCODE_CONFIG_CONTENT"];
    const generated = JSON.parse(buildOpencodeConfig({
      mcpUrl: input.mcpUrl,
      promptFile: instructions.promptFile,
      skipPermissions,
    }));
    try {
      const config = existing ? JSON.parse(existing) : {};
      if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Config must be an object");
      for (const key of ["mcp", "permission"]) {
        if (config[key] !== undefined && (key === "mcp" || typeof config[key] !== "string") &&
          (!config[key] || typeof config[key] !== "object" || Array.isArray(config[key]))) throw new Error(`Invalid ${key}`);
      }
      if (config.instructions !== undefined && !Array.isArray(config.instructions)) throw new Error("Invalid instructions");
      const next = { ...config };
      if (generated.mcp) next.mcp = { ...generated.mcp, ...config.mcp };
      if (generated.instructions) next.instructions = [...new Set([...(config.instructions ?? []), ...generated.instructions])];
      // Explicit user permissions always win over Codebrain's default bypass.
      if (generated.permission && config.permission === undefined) next.permission = generated.permission;
      input.env["OPENCODE_CONFIG_CONTENT"] = JSON.stringify(next);
    } catch (error) {
      log.warn("[harness-spawn] OpenCode: configuração existente inválida; preservada", error);
    }
  }

  if (input.externalMcpServers) wireExternalMcpServers(entry, input, input.externalMcpServers);

  const args = buildHarnessArgs(
    entry,
    {
      model: input.model,
      effort: input.effort,
      skipPermissions,
      resumeSessionId: input.resumeSessionId,
      instructions: instructions.text,
    },
    input.args,
  );
  const terminator = args.indexOf("--");
  args.splice(terminator < 0 ? args.length : terminator, 0, ...instructions.extraArgs);
  return args;
}
