/**
 * Skills de papel que acompanham o app (cb-*), instaladas em cada conta no boot.
 *
 * Idempotente: só grava quando o conteúdo difere, e só toca nos arquivos que o
 * próprio app distribui.
 */
import * as fsp from "node:fs/promises";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { accountSkillDirs } from "./accounts";
import { CLI_REGISTRY, hermesHome } from "./spawn/cli-registry";

/** electron-builder usa extraResources; electron-packager mantém os recursos no app.asar. */
export function roleSkillsDirForApp(appPath: string, resourcesPath?: string): string {
  const inApp = path.join(appPath, "resources", "role-skills");
  if (!resourcesPath) return inApp;
  const external = path.join(resourcesPath, "role-skills");
  return fs.existsSync(external) || !fs.existsSync(inApp) ? external : inApp;
}

export function bundledRoleSkillsDir(): string {
  try {
    const { app } = require("electron");
    if (app?.getAppPath) return roleSkillsDirForApp(app.getAppPath(), app.isPackaged ? process.resourcesPath : undefined);
  } catch {
    // fora do Electron (testes)
  }
  return path.join(process.cwd(), "resources", "role-skills");
}

export function bundledRoleSkillNames(dir: string = bundledRoleSkillsDir()): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => fs.existsSync(path.join(dir, name, "SKILL.md")))
      .sort();
  } catch {
    return [];
  }
}

async function writeIfDifferent(target: string, content: Buffer): Promise<boolean> {
  try {
    if ((await fsp.readFile(target)).equals(content)) return false;
  } catch {
    await fsp.mkdir(path.dirname(target), { recursive: true });
  }
  await fsp.writeFile(target, content);
  return true;
}

async function skillFiles(root: string, relative = ""): Promise<Array<{ relative: string; content: Buffer }>> {
  const result: Array<{ relative: string; content: Buffer }> = [];
  for (const entry of await fsp.readdir(path.join(root, relative), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("Bundled skills cannot contain symbolic links");
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await skillFiles(root, next));
    else if (entry.isFile()) result.push({ relative: next, content: await fsp.readFile(path.join(root, next)) });
  }
  return result;
}

function safeSkillTarget(root: string, relative: string): string {
  let target = root;
  for (const part of relative.split(path.sep)) {
    if (!part || part === "." || part === "..") throw new Error("Invalid bundled skill path");
    target = path.join(target, part);
    try {
      if (fs.lstatSync(target).isSymbolicLink()) throw new Error("Refusing to overwrite a linked skill path");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return target;
}

/** @returns quantos arquivos foram gravados. */
export async function installRoleSkillsInto(sourceDir: string, targetDirs: readonly string[]): Promise<number> {
  let written = 0;
  for (const name of bundledRoleSkillNames(sourceDir)) {
    const files = await skillFiles(path.join(sourceDir, name));
    // Both CLI discovery (SKILL.md) and native MCP discovery (skill.json)
    // must see the same bundled skill; do not flatten away its references.
    if (!files.some((file) => file.relative === "skill.json")) {
      files.push({ relative: "skill.json", content: Buffer.from(JSON.stringify({
        id: name, name, description: `Skill nativa Codebrain: ${name}`,
        type: "prompt", version: "2.0.0", entrypoint: "SKILL.md",
      }, null, 2)) });
    }
    for (const dir of targetDirs) {
      for (const file of files) {
        const target = safeSkillTarget(dir, path.join(name, file.relative));
        if (await writeIfDifferent(target, file.content)) written += 1;
      }
    }
  }
  return written;
}

/** Caminhos de usuário declarados pelo registro; nenhum diretório de projeto é alterado. */
export function userRoleSkillDirs(
  env: Record<string, string | undefined> = process.env,
  home: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): string[] {
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  return CLI_REGISTRY.flatMap((entry) => {
    const template = entry.skillsDir?.user;
    if (!template) return [];
    const expanded = template
      .replace(/^~(?=\/|\\|$)/, home)
      .replace(/\$HERMES_HOME\b/g, hermesHome(env, platform, home))
      .replace(/\$XDG_CONFIG_HOME\b/g, env.XDG_CONFIG_HOME || join(home, ".config"));
    // Só expande variáveis que conhecemos; nunca cria uma pasta chamada "$VAR".
    return expanded.includes("$") ? [] : [platform === "win32" ? path.win32.normalize(expanded) : path.posix.normalize(expanded)];
  });
}

function installTargets(extraDirs: readonly string[]): string[] {
  const dirs = new Set([path.join(os.homedir(), ".codebrain", "skills"), ...accountSkillDirs().map((entry) => entry.dir), ...userRoleSkillDirs(), ...extraDirs]);
  // A pasta da CLI só existe com ela instalada; não criamos rastro de quem não usa.
  return [...dirs].filter((dir) => fs.existsSync(path.dirname(dir)));
}

/** @param extraDirs diretórios de skills de CLIs sem conta gerenciada. */
export async function installRoleSkills(extraDirs: readonly string[] = []): Promise<number> {
  await fsp.mkdir(path.join(os.homedir(), ".codebrain"), { recursive: true });
  return installRoleSkillsInto(bundledRoleSkillsDir(), installTargets(extraDirs));
}
