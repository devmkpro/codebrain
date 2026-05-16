export interface SpawnPaneConfig {
  agent?: string;
  providerId?: string;
  model?: string;
  cwd?: string;
  paneId?: string;
  args?: string[];
  permissionMode?: string;
  claudeSessionId?: string;
  squadOrchestratorWorkerId?: string;
  role?: string;
  sessionContext?: string;
  env?: Record<string, string>;
  activityId?: string;
  session?: PaneSession;
}

export interface SpawnPaneResult {
  ok: boolean;
  paneId?: string;
  providerId?: string;
  error?: string;
}

export interface PaneSession {
  provider: string;
  id: string;
  capturedAt?: number;
  confidence?: "high" | "low";
  source?: string;
}

export interface PaneInfo {
  paneId: string;
  agent: string;
  cwd: string;
  providerId?: string;
  model?: string;
  role?: string;
}

export interface PtyWriteResult { ok: boolean; error?: string; }
export interface PtyReadResult { ok: boolean; lines: string[]; error?: string; }
export interface PtyListResult { ok: boolean; panes: PaneInfo[]; }
