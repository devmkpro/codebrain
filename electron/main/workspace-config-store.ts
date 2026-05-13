import * as fs from "node:fs";
import * as path from "node:path";

export interface WorkspaceConfig {
  [key: string]: unknown;
}

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
      this.cache.set(workspacePath, parsed);
      return parsed;
    } catch {
      return {};
    }
  }

  set(workspacePath: string, cfg: WorkspaceConfig): void {
    const dir = path.join(workspacePath, ".codebrain");
    fs.mkdirSync(dir, { recursive: true });
    const merged = { ...this.get(workspacePath), ...cfg };
    fs.writeFileSync(this.configPath(workspacePath), JSON.stringify(merged, null, 2), "utf-8");
    this.cache.set(workspacePath, merged);
  }
}
