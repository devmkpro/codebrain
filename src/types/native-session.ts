/** Native conversation identity is independent of the lifetime of its PTY. */
export interface NativeSession {
  provider: string;
  id: string;
  capturedAt: number;
  confidence: "high" | "medium" | "low";
  source: string;
  harnessId?: string;
  scopeKey?: string;
  conversationId?: string;
}

export interface NativeResumePane {
  id?: string;
  agent: string;
  cwd: string;
  workspacePath?: string;
  session?: NativeSession;
  claudeSessionId?: string;
  providerId?: string;
  model?: string;
  role?: string;
  accountId?: string;
  accountLabel?: string;
  permissionMode?: string;
  allowedSkills?: string[];
  agentName?: string;
  lastLines?: string[];
}
