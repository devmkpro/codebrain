import * as fs from "node:fs";
import * as path from "node:path";

// ── Workspace Access Modes ───────────────────────────────────────────────────
// Controls whether AI agents can read/write files OUTSIDE the workspace root.
export const ACCESS_MODES = new Set(["read_external", "write_external"]);
export type AccessMode = "read_external" | "write_external";

export function normalizeAccessMode(value: unknown): AccessMode {
  if (value === "read_external") return "read_external";
  return "write_external"; // default: full access
}

/** Check if a mode allows a specific operation kind outside the workspace. */
export function accessModeAllows(mode: AccessMode, kind: "read" | "write"): boolean {
  if (kind === "read") return true; // both modes allow reading outside
  return mode === "write_external"; // only write_external allows writing outside
}

/** Human-readable error message for denied access. */
export function workspaceAccessDenied(kind: "read" | "write"): string {
  return kind === "read"
    ? "workspace access denied: choose read_external or write_external for this workspace"
    : "workspace access denied: choose write_external for this workspace";
}

/** Build a workspace access policy section for the system prompt. */
export function workspaceAccessInstruction(workspacePath: string, mode: AccessMode): string {
  const lines = [
    "Codebrain workspace access policy:",
    `- Primary workspace: ${workspacePath}`,
  ];
  if (mode === "read_external") {
    lines.push("- Mode: read_external. Read-only access is allowed outside the primary workspace.");
    lines.push("- 🔴 PROHIBIDO: You MUST NOT write, edit, create, or delete files outside the primary workspace. This includes Write, Edit, MultiEdit tool calls targeting paths outside the workspace root.");
    lines.push("- If you need to write outside the workspace, tell the user to change the access mode to write_external in Settings first.");
  } else {
    lines.push("- Mode: write_external. Read and edit files inside and outside the primary workspace.");
  }
  lines.push("- If a requested file operation is outside this policy, ask the user to update Workspace settings first.");
  return lines.join("\n");
}

// ── Workspace Config ────────────────────────────────────────────────────────
export interface WorkspaceConfig {
  accessMode?: AccessMode;
  [key: string]: unknown;
}

const DEFAULT_CONFIG: WorkspaceConfig = {
  accessMode: "write_external",
};

export class WorkspaceConfigStore {
  private cache = new Map<string, WorkspaceConfig>();

  private configPath(workspacePath: string): string {
    return path.join(workspacePath, ".codebrain", "config.json");
  }

  get(workspacePath: string): WorkspaceConfig {
    if (this.cache.has(workspacePath)) return this.cache.get(workspacePath)!;
    try {
      const raw = fs.readFileSync(this.configPath(workspacePath), "utf-8");
      const parsed = JSON.parse(raw);
      // Normalize accessMode on read
      if (parsed.accessMode) parsed.accessMode = normalizeAccessMode(parsed.accessMode);
      this.cache.set(workspacePath, parsed);
      return parsed;
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  /** Get the effective accessMode for a workspace. */
  getAccessMode(workspacePath: string): AccessMode {
    const cfg = this.get(workspacePath);
    return normalizeAccessMode(cfg.accessMode);
  }

  set(workspacePath: string, cfg: WorkspaceConfig): void {
    const dir = path.join(workspacePath, ".codebrain");
    fs.mkdirSync(dir, { recursive: true });
    const merged = { ...this.get(workspacePath), ...cfg };
    // Normalize accessMode on write
    if (merged.accessMode) merged.accessMode = normalizeAccessMode(merged.accessMode);
    fs.writeFileSync(this.configPath(workspacePath), JSON.stringify(merged, null, 2), "utf-8");
    this.cache.set(workspacePath, merged);
  }
}
