import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import type { NativeSession } from "../../../src/types/native-session";
import { resumeHarnessId, validateSessionId } from "./spawn/session-resume";

export interface SavedConversationPane {
  id: string;
  agent: string;
  cwd: string;
  workspacePath: string;
  providerId?: string;
  model?: string;
  role?: string;
  accountId?: string;
  accountLabel?: string;
  permissionMode?: string;
  allowedSkills?: string[];
  agentName?: string;
  session: NativeSession;
}

export function sessionScope(agent: string, cwd: string, accountId?: string, env: NodeJS.ProcessEnv = process.env): string {
  const rootVars: Record<string, string> = { codex: "CODEX_HOME", claude: "CLAUDE_CONFIG_DIR", openclaude: "OPENCLAUDE_CONFIG_DIR", gemini: "GEMINI_CLI_HOME", kimi: "KIMI_CODE_HOME", copilot: "COPILOT_HOME", kiro: "KIRO_HOME", grok: "GROK_HOME", hermes: "HERMES_HOME" };
  const harness = resumeHarnessId(agent);
  const normalized = path.resolve(cwd);
  return createHash("sha256").update(JSON.stringify([
    os.hostname(), os.homedir(), harness, process.platform === "win32" ? normalized.toLowerCase() : normalized,
    accountId ?? "", env[rootVars[harness]] ?? "",
  ])).digest("hex");
}

/** Local metadata only. The harness remains the owner of the full transcript.
 * One atomic file per conversation: no migration of the user's memory database,
 * no env, auth keys, command line arguments or terminal contents are serialized.
 */
export class NativeSessionStore {
  constructor(private readonly directory: string) {}

  save(pane: SavedConversationPane): SavedConversationPane {
    validateSessionId(pane.session.id);
    const key = createHash("sha256").update(JSON.stringify([pane.agent, pane.session.scopeKey, pane.session.id])).digest("hex");
    const saved: SavedConversationPane = {
      id: key, agent: pane.agent, cwd: pane.cwd, workspacePath: pane.workspacePath,
      providerId: pane.providerId, model: pane.model, role: pane.role,
      accountId: pane.accountId, accountLabel: pane.accountLabel, permissionMode: pane.permissionMode,
      allowedSkills: pane.allowedSkills?.filter(name => /^[a-zA-Z0-9_.-]+$/.test(name)), agentName: pane.agentName,
      session: { provider: pane.agent, harnessId: pane.agent, id: pane.session.id,
        capturedAt: pane.session.capturedAt, confidence: pane.session.confidence,
        source: pane.session.source, scopeKey: pane.session.scopeKey, conversationId: key },
    };
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const target = path.join(this.directory, `${key}.json`);
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(saved), { mode: 0o600, flag: "wx" });
      fs.renameSync(temp, target);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    return saved;
  }

  list(workspace?: string) {
    if (!fs.existsSync(this.directory)) return [];
    const rows: { id: string; workspacePath: string; savedAt: number; panes: SavedConversationPane[] }[] = [];
    for (const entry of fs.readdirSync(this.directory)) {
      if (!/^[a-f0-9]{64}\.json$/.test(entry)) continue;
      try {
        const pane = JSON.parse(fs.readFileSync(path.join(this.directory, entry), "utf8")) as SavedConversationPane;
        if (!pane.session?.id || pane.id !== entry.slice(0, -5)) continue;
        validateSessionId(pane.session.id);
        if (workspace && path.resolve(pane.workspacePath) !== path.resolve(workspace)) continue;
        rows.push({ id: pane.id, workspacePath: pane.workspacePath, savedAt: pane.session.capturedAt, panes: [pane] });
      } catch { /* A damaged metadata file must not hide the other conversations. */ }
    }
    return rows.sort((a, b) => b.savedAt - a.savedAt);
  }

  delete(id: string, workspace?: string): void {
    if (!/^[a-f0-9]{64}$/.test(id)) return;
    if (workspace && !this.list(workspace).some(row => row.id === id)) return;
    const file = path.join(this.directory, `${id}.json`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  clear(workspace?: string): void {
    for (const row of this.list(workspace)) this.delete(row.id, workspace);
  }
}
