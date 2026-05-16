import { ipcMain, app, shell } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { AppContext } from "../context";

export function registerSkillHandlers(_ctx: AppContext): void {
  ipcMain.handle("skill:status", async () => {
    const skillDir = path.join(os.homedir(), ".claude", "skills", "codebrain-skill");
    return { installed: fs.existsSync(skillDir) };
  });

  ipcMain.handle("skill:list", async () => {
    const skillsDir = path.join(os.homedir(), ".claude", "skills");
    if (!fs.existsSync(skillsDir)) return [];
    try {
      return fs.readdirSync(skillsDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
    } catch { return []; }
  });

  ipcMain.handle("skill:openFolder", async () => {
    const skillsDir = path.join(os.homedir(), ".claude", "skills");
    if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });
    shell.openPath(skillsDir);
  });

  ipcMain.handle("skill:installCodebrain", async () => {
    const skillsDir = path.join(os.homedir(), ".claude", "skills");
    const skillDir = path.join(skillsDir, "codebrain-skill");
    try {
      fs.mkdirSync(skillsDir, { recursive: true });
      const isPackaged = app.isPackaged;
      const bundledSkillDir = isPackaged
        ? path.join(process.resourcesPath, "codebrain-skill")
        : path.join(__dirname, "..", "..", "resources", "codebrain-skill");
      if (!fs.existsSync(bundledSkillDir)) {
        return { ok: false, error: `Skill files not found at ${bundledSkillDir}` };
      }
      if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true, force: true });
      fs.mkdirSync(skillDir, { recursive: true });
      for (const file of fs.readdirSync(bundledSkillDir)) {
        fs.copyFileSync(path.join(bundledSkillDir, file), path.join(skillDir, file));
      }
      return { ok: true, action: "instalado", path: skillDir };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle("skill:uninstallCodebrain", async () => {
    const skillDir = path.join(os.homedir(), ".claude", "skills", "codebrain-skill");
    try {
      if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true, force: true });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });
}
