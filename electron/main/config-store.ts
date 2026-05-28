import * as fs from "node:fs";
import * as path from "node:path";
import { app } from "electron";

export interface AppConfig {
  theme?: "dark" | "light";
  gitlabToken?: string;
  gitlabUrl?: string;
  /** Custom env vars applied to ALL spawned agents. */
  globalEnv?: Record<string, string>;
  [key: string]: unknown;
}

export class ConfigStore {
  private config: AppConfig = {};
  private readonly filePath: string;

  constructor() {
    this.filePath = path.join(app.getPath("userData"), "app-config.json");
    this.load();
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      this.config = JSON.parse(raw);
    } catch {
      this.config = {};
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.config, null, 2), "utf-8");
    } catch {}
  }

  get(): AppConfig {
    return { ...this.config };
  }

  set(patch: Partial<AppConfig>): void {
    this.config = { ...this.config, ...patch };
    this.save();
  }
}
