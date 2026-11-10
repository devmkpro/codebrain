/**
 * Catálogo local de skills e agentes: o que está instalado em cada CLI, no
 * workspace e no próprio app, mais o que o usuário marcou (desligado, categoria,
 * skills por agente).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { accountSkillDirs, listAccounts } from "./accounts";
import { bundledRoleSkillNames, bundledRoleSkillsDir } from "./role-skills";
import { CLI_REGISTRY, getHarness, hermesHome } from "./spawn/cli-registry";

export type CatalogKind = "skill" | "agent";

export interface CatalogInstall {
  cli: string;
  path: string;
  sourceRoot?: string;
  entrypoint?: string;
  resources?: string[];
}

export interface CatalogItem {
  kind: CatalogKind;
  name: string;
  description: string;
  installedIn: CatalogInstall[];
  disabled: boolean;
  category: string | null;
  builtin: boolean;
  allowedSkills?: string[];
}

interface CatalogMeta {
  disabled: string[];
  categories: Record<string, string>;
  agentSkills: Record<string, string[]>;
}

const metaPath = () => path.join(os.homedir(), ".codebrain", "catalog-meta.json");
const metaKey = (kind: CatalogKind, name: string) => `${kind}:${name}`;

/** Frontmatter YAML simples: chaves de uma linha, blocos `>`/`|` e continuação. */
export function parseFrontmatter(text: string): { data: Record<string, string>; body: string } {
  const source = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const match = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return { data: {}, body: source };
  const data: Record<string, string> = {};
  let currentKey: string | null = null;
  for (const line of match[1].split("\n")) {
    const pair = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (pair) {
      currentKey = pair[1];
      data[currentKey] = /^[>|][+-]?$/.test(pair[2].trim()) ? "" : unquote(pair[2].trim());
    } else if (currentKey && /^\s+\S/.test(line)) {
      data[currentKey] = `${data[currentKey]} ${line.trim()}`.trim();
    }
  }
  return { data, body: source.slice(match[0].length).replace(/^\n+/, "") };
}

function unquote(value: string): string {
  const quoted = value.match(/^(["'])([\s\S]*)\1$/);
  return quoted ? quoted[2].replace(/\\"/g, '"') : value;
}

function loadMeta(): CatalogMeta {
  try {
    const raw = JSON.parse(fs.readFileSync(metaPath(), "utf-8"));
    return {
      disabled: Array.isArray(raw.disabled) ? raw.disabled.map(String) : [],
      categories: Object.fromEntries(
        Object.entries(raw.categories ?? {}).filter(([, value]) => typeof value === "string")
      ) as Record<string, string>,
      agentSkills: Object.fromEntries(
        Object.entries(raw.agentSkills ?? {}).filter(
          ([, value]) => Array.isArray(value) && value.every((skill) => typeof skill === "string")
        )
      ) as Record<string, string[]>,
    };
  } catch {
    return { disabled: [], categories: {}, agentSkills: {} };
  }
}

function saveMeta(meta: CatalogMeta): void {
  const target = metaPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), "utf-8");
  fs.renameSync(tmp, target);
}

export function setCatalogMeta(update: {
  kind: CatalogKind;
  name: string;
  disabled?: boolean;
  category?: string | null;
  allowedSkills?: string[] | null;
}): void {
  if (
    !update ||
    !["skill", "agent"].includes(update.kind) ||
    typeof update.name !== "string" ||
    !update.name.trim()
  )
    throw new Error("kind e name inválidos");
  if (update.disabled !== undefined && typeof update.disabled !== "boolean")
    throw new Error("disabled deve ser booleano");
  if (update.category != null && typeof update.category !== "string")
    throw new Error("category deve ser texto ou null");
  if (
    update.allowedSkills != null &&
    (!Array.isArray(update.allowedSkills) ||
      !update.allowedSkills.every((skill) => typeof skill === "string" && skill.trim()))
  )
    throw new Error("allowedSkills deve ser lista de nomes");
  const meta = loadMeta();
  const key = metaKey(update.kind, update.name);
  if (update.disabled !== undefined) {
    meta.disabled = meta.disabled.filter((entry) => entry !== key);
    if (update.disabled) meta.disabled.push(key);
  }
  if (update.category !== undefined) {
    if (update.category?.trim()) meta.categories[key] = update.category.trim();
    else delete meta.categories[key];
  }
  if (update.kind === "agent" && update.allowedSkills !== undefined) {
    if (update.allowedSkills === null) delete meta.agentSkills[update.name];
    else
      Object.defineProperty(meta.agentSkills, update.name, {
        value: [...new Set(update.allowedSkills.map((skill) => skill.trim()))],
        enumerable: true,
        configurable: true,
        writable: true,
      });
  }
  saveMeta(meta);
}

/**
 * Whitelist final: a do agente substitui a da tarefa, e skill desligada sai de
 * qualquer uma.
 */
export function resolveSkillWhitelist(
  skills: readonly string[],
  agentName?: string | null
): string[] {
  const meta = loadMeta();
  const off = new Set(meta.disabled);
  const base =
    (agentName && Object.hasOwn(meta.agentSkills, agentName)
      ? meta.agentSkills[agentName]
      : undefined) ?? skills;
  return [...new Set(base)].filter((skill) => !off.has(metaKey("skill", skill)));
}

interface FoundEntry {
  name: string;
  description: string;
  path: string;
  sourceRoot?: string;
  entrypoint?: string;
  resources?: string[];
  allowedSkills?: string[];
}

function declaredSkills(value: unknown): string[] | undefined {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return undefined; }
  }
  return Array.isArray(value) && value.every(item => typeof item === "string") ? [...new Set(value as string[])] : undefined;
}

/** Inventário explícito de conteúdo portável; nunca percorre configuração privada ou caches. */
export function isPortablePath(relative: string): boolean {
  if (!relative || path.isAbsolute(relative) || /^[a-z]:/i.test(relative)) return false;
  return relative.replace(/\\/g, "/").split("/").every(part =>
    part !== ".." && !/^(?:\.env(?:\..*)?|\.git|node_modules|vault|credentials?|secrets?|tokens?|accounts?|tmp|temp|cache|logs?|sessions?|\.cache|\.ssh|\.aws|\.npmrc|\.netrc|auth\.json|id_(?:rsa|ed25519|ecdsa|dsa))$/i.test(part) &&
    !/\.(?:pem|key|p12|pfx|db|sqlite(?:3)?|log)$/i.test(part) &&
    !/(?:^|[._-])(?:credentials?|secrets?|tokens?|vault)(?=[._-]|$).*\.(?:json|ya?ml|toml|ini|txt|zip|enc)$/i.test(part),
  );
}

export function portableFile(root: string, relative: string): string | null {
  if (!isPortablePath(relative)) return null;
  const target = path.resolve(root, relative);
  const inside = path.relative(path.resolve(root), target);
  if (inside.startsWith("..") || path.isAbsolute(inside)) return null;
  try {
    // Não segue symlinks, inclusive um diretório intermediário que escape do bundle.
    let current = path.resolve(root);
    if (fs.lstatSync(current).isSymbolicLink()) return null;
    for (const part of inside.split(path.sep)) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) return null;
    }
    const real = path.relative(fs.realpathSync(root), fs.realpathSync(target));
    if (real.startsWith("..") || path.isAbsolute(real)) return null;
    return target;
  } catch { return null; }
}

export function portableFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      const relative = path.relative(root, file);
      if (!portableFile(root, relative)) continue;
      if (item.isDirectory()) walk(file);
      else if (item.isFile()) files.push(relative);
    }
  };
  try { walk(root); } catch { /* diretório ausente/inacessível */ }
  return files.sort();
}

export function ensurePortableDirectory(root: string, relative: string): string {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) throw new Error("Destino fora do diretório permitido");
  let current = path.resolve(root);
  for (const part of relative.split(/[\\/]/).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Destino não é um diretório seguro: ${current}`);
    } else fs.mkdirSync(current);
  }
  return current;
}

export function redactCatalogText(text: string): string {
  return text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[private key omitted]")
    .replace(/\b([\w.-]*(?:api[_-]?key|access[_-]?key|token|secret|password|credential|authorization)[\w.-]*["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi, "$1[redacted]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@");
}

function entryResources(root: string, entrypoint: string | undefined, bundle: boolean, manifest?: string): string[] {
  if (bundle) return portableFiles(root);
  const selected = new Set<string>();
  for (const file of [entrypoint, manifest]) if (file && portableFile(root, file)) selected.add(file);
  for (const dir of ["scripts", "assets", "references", ...(entrypoint && path.dirname(entrypoint) !== "." ? [path.dirname(entrypoint)] : [])]) {
    const target = portableFile(root, dir);
    if (target && isDirectory(target)) for (const file of portableFiles(target)) selected.add(path.join(dir, file));
  }
  if (entrypoint) {
    const body = safeRead(path.join(root, entrypoint)) ?? "";
    for (const match of body.matchAll(/\]\(([^\s)]+)\)/g)) {
      const relative = path.normalize(path.join(path.dirname(entrypoint), match[1]));
      const file = portableFile(root, relative);
      if (file && fs.statSync(file).isFile()) selected.add(relative);
    }
  }
  return [...selected].sort();
}

function safeRead(file: string): string | null {
  try {
    if (fs.statSync(file).size > 256_000 || !fs.statSync(file).isFile()) return null;
    return fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }
}

const isDirectory = (target: string): boolean => {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
};

function readSkillDir(entryPath: string, entry: string): FoundEntry | null {
  const instruction = ["SKILL.md", "skill.md"].find(file => portableFile(entryPath, file));
  const text = instruction ? safeRead(path.join(entryPath, instruction)) : null;
  if (text !== null) {
    const { data } = parseFrontmatter(text);
    return { name: data.name || entry, description: redactCatalogText(data.description ?? ""), path: entryPath, sourceRoot: entryPath, entrypoint: instruction, resources: portableFiles(entryPath) };
  }
  const manifestPath = ["skill.json", "manifest.json"].find(file => portableFile(entryPath, file));
  const manifest = manifestPath ? safeRead(path.join(entryPath, manifestPath)) : null;
  if (manifest === null) return null;
  try {
    const parsed = JSON.parse(manifest);
    const name = parsed?.id || parsed?.name || entry;
    if (typeof name !== "string" || !name.trim()) return null;
    return {
      name,
      description: redactCatalogText(typeof parsed.description === "string" ? parsed.description : ""),
      path: entryPath,
      sourceRoot: entryPath,
      entrypoint: typeof parsed.entrypoint === "string" && portableFile(entryPath, parsed.entrypoint) ? parsed.entrypoint : portableFile(entryPath, "prompt.md") ? "prompt.md" : undefined,
      resources: portableFiles(entryPath),
    };
  } catch {
    return null;
  }
}

function readSkillsDir(dir: string): FoundEntry[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const found: FoundEntry[] = [];
  for (const entry of names) {
    if (!isPortablePath(entry) || !portableFile(dir, entry)) continue;
    const entryPath = path.join(dir, entry);
    if (isDirectory(entryPath)) {
      const skill = readSkillDir(entryPath, entry);
      if (skill) found.push(skill);
    } else if (entry.endsWith(".md") && entry.toLowerCase() !== "readme.md") {
      const text = safeRead(entryPath);
      if (text === null) continue;
      const { data } = parseFrontmatter(text);
      found.push({
        name: data.name || entry.slice(0, -3),
        description: redactCatalogText(data.description ?? ""),
        path: entryPath,
        sourceRoot: dir,
        entrypoint: entry,
        resources: entryResources(dir, entry, false),
      });
    }
  }
  return found;
}

function readAgentsDir(dir: string): (FoundEntry & { body: string })[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const found: (FoundEntry & { body: string })[] = [];
  for (const entry of names) {
    if (!isPortablePath(entry) || !portableFile(dir, entry)) continue;
    const file = path.join(dir, entry);
    if (isDirectory(file) || entry.endsWith(".json")) {
      const root = isDirectory(file) ? file : dir;
      if (isDirectory(file) && portableFile(root, "AGENT.md")) {
        const source = safeRead(path.join(root, "AGENT.md"));
        if (source !== null) {
          const { data, body } = parseFrontmatter(source);
          found.push({ name: data.name || entry, description: redactCatalogText(data.description ?? ""), path: file, sourceRoot: root, entrypoint: "AGENT.md", resources: portableFiles(root), body, allowedSkills: declaredSkills(data.allowedSkills ?? data.skills) });
        }
        continue;
      }
      const manifestName = isDirectory(file) ? ["agent.json", "manifest.json"].find(name => portableFile(root, name)) : entry;
      if (!manifestName) continue;
      try {
        const manifest = JSON.parse(safeRead(path.join(root, manifestName)) ?? "null");
        if (!manifest || typeof manifest.entrypoint !== "string" || !portableFile(root, manifest.entrypoint)) continue;
        const source = safeRead(path.join(root, manifest.entrypoint));
        if (source === null) continue;
        found.push({ name: typeof manifest.id === "string" ? manifest.id : typeof manifest.name === "string" ? manifest.name : entry.replace(/\.json$/, ""), description: redactCatalogText(typeof manifest.description === "string" ? manifest.description : ""), path: file, sourceRoot: root, entrypoint: manifest.entrypoint, resources: entryResources(root, manifest.entrypoint, isDirectory(file), manifestName), body: parseFrontmatter(source).body, allowedSkills: declaredSkills(manifest.allowedSkills ?? manifest.skills) });
      } catch { /* manifesto inválido */ }
      continue;
    }
    if (!entry.endsWith(".md") || /^readme\.md$/i.test(entry)) continue;
    const text = safeRead(file);
    if (text === null) continue;
    const { data, body } = parseFrontmatter(text);
    found.push({
      name: data.name || entry.slice(0, -3),
      description: redactCatalogText(data.description ?? ""),
      path: file,
      body,
      sourceRoot: dir,
      entrypoint: entry,
      resources: entryResources(dir, entry, false),
      allowedSkills: declaredSkills(data.allowedSkills ?? data.skills),
    });
  }
  return found;
}

export interface SkillSource {
  cli: string;
  dir: string;
}

function skillSources(
  workspace: string | null | undefined,
  extraSources: readonly SkillSource[]
): SkillSource[] {
  const sources: SkillSource[] = [
    ...(workspace ? [{ cli: "codebrain", dir: path.join(workspace, ".codebrain", "skills") }] : []),
    { cli: "codebrain", dir: path.join(os.homedir(), ".codebrain", "skills") },
    ...accountSkillDirs(), ...extraSources,
  ];
  // Read only the paths declared by the registry; no inferred account homes.
  for (const entry of CLI_REGISTRY) {
    if (!entry.capabilities.skills || !entry.skillsDir) continue;
    if (entry.skillsDir.user) {
      const dir = entry.skillsDir.user
        .replace(/^~(?=[/\\]|$)/, os.homedir())
        .replace(/^\$HERMES_HOME(?=[/\\]|$)/, hermesHome(process.env))
        .replace(
          /^\$XDG_CONFIG_HOME(?=[/\\]|$)/,
          process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
        );
      if (path.isAbsolute(dir)) sources.push({ cli: entry.id, dir });
    }
    if (workspace && entry.skillsDir.project)
      sources.push({ cli: entry.id, dir: path.join(workspace, entry.skillsDir.project) });
  }
  sources.push({ cli: "codebrain", dir: path.join(os.homedir(), ".codebrain", "skills") });
  if (workspace) {
    sources.push({ cli: "claude", dir: path.join(workspace, ".claude", "skills") });
    sources.push({ cli: "codebrain", dir: path.join(workspace, ".codebrain", "skills") });
  }
  sources.push({ cli: "bundled", dir: bundledRoleSkillsDir() });
  return sources;
}

const agentDirs = (workspace?: string | null): string[] => [
  path.join(os.homedir(), ".claude", "agents"),
  path.join(os.homedir(), ".codebrain", "agents"),
  ...(workspace ? [path.join(workspace, ".claude", "agents")] : []),
  ...(workspace ? [path.join(workspace, ".codebrain", "agents")] : []),
];

/** @param extraSources diretórios de skills de CLIs sem conta gerenciada. */
export function scanCatalog(
  workspace?: string | null,
  extraSources: readonly SkillSource[] = []
): CatalogItem[] {
  const meta = loadMeta();
  const builtin = new Set(bundledRoleSkillNames());
  const items = new Map<string, CatalogItem>();

  const merge = (kind: CatalogKind, cli: string, found: FoundEntry) => {
    const key = metaKey(kind, found.name);
    let item = items.get(key);
    if (!item) {
      item = {
        kind,
        name: found.name,
        description: found.description,
        installedIn: [],
        disabled: meta.disabled.includes(key),
        category: meta.categories[key] ?? null,
        builtin: kind === "skill" && builtin.has(found.name),
      };
      if (kind === "agent" && Object.hasOwn(meta.agentSkills, found.name))
        item.allowedSkills = meta.agentSkills[found.name];
      items.set(key, item);
    }
    if (!item.description) item.description = found.description;
    if (kind === "agent" && !Object.hasOwn(meta.agentSkills, found.name)) item.allowedSkills = found.allowedSkills;
    if (!item.installedIn.some((install) => install.path === found.path))
      item.installedIn.push({ cli, path: found.path, sourceRoot: found.sourceRoot, entrypoint: found.entrypoint, resources: found.resources });
  };

  for (const { cli, dir } of skillSources(workspace, extraSources)) {
    for (const skill of readSkillsDir(dir)) merge("skill", cli, skill);
  }
  for (const dir of agentDirs(workspace)) {
    for (const agent of readAgentsDir(dir)) merge("agent", dir.includes(`${path.sep}.codebrain${path.sep}`) ? "codebrain" : "claude", agent);
  }
  return [...items.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Agente de mesmo nome no workspace vence o global. */
function findAgents(workspace?: string | null): Map<string, FoundEntry & { body: string }> {
  const off = new Set(loadMeta().disabled);
  const agents = new Map<string, FoundEntry & { body: string }>();
  for (const dir of agentDirs(workspace)) {
    for (const agent of readAgentsDir(dir)) {
      if (!off.has(metaKey("agent", agent.name))) agents.set(agent.name, agent);
    }
  }
  return agents;
}

export function listAgents(workspace?: string | null): { name: string; description: string }[] {
  return [...findAgents(workspace).values()].map(({ name, description }) => ({
    name,
    description,
  }));
}

export function getAgentInstructions(name: string, workspace?: string | null): string | null {
  const body = findAgents(workspace).get(name)?.body;
  return body === undefined ? null : redactCatalogText(body);
}

export function installedSkillNames(configDir: string, cwd?: string | null): string[] {
  const names = new Set(readSkillsDir(path.join(configDir, "skills")).map((skill) => skill.name));
  if (cwd)
    for (const skill of readSkillsDir(path.join(cwd, ".claude", "skills"))) names.add(skill.name);
  return [...names];
}

export function preferredCatalogInstall(item: CatalogItem, workspace?: string | null): CatalogInstall {
  const score = (install: CatalogInstall) => {
    const local = workspace && !path.relative(path.resolve(workspace), path.resolve(install.path)).startsWith("..") && !path.isAbsolute(path.relative(path.resolve(workspace), path.resolve(install.path)));
    return (local ? 2 : 0) + (install.cli === "codebrain" ? 1 : 0);
  };
  return [...item.installedIn].sort((a, b) => score(b) - score(a))[0];
}

export function catalogInstructions(install: CatalogInstall): string | null {
  if (!install.sourceRoot || !install.entrypoint) return null;
  const file = portableFile(install.sourceRoot, install.entrypoint);
  const text = file ? safeRead(file) : null;
  return text === null ? null : redactCatalogText(parseFrontmatter(text).body);
}

/** Copia o bundle inteiro permitido. Scripts/binários são copiados sem execução nem leitura no prompt. */
export function copyCatalogInstall(item: CatalogItem, install: CatalogInstall, targetDir: string): string | null {
  const name = item.name;
  const rawFolder = isDirectory(install.path) ? path.basename(install.path) : name;
  const folder = (item.kind === "agent" ? `codebrain-agent-${rawFolder}` : rawFolder).replace(/[^\w.-]+/g, "-");
  if (!isPortablePath(folder) || folder === ".") throw new Error("nome do bundle inválido");
  const destination = path.join(targetDir, folder);
  if (fs.existsSync(destination)) return null; // nunca sobrescreve a versão do usuário
  const body = catalogInstructions(install);
  if (body === null || !install.sourceRoot) throw new Error(`entrypoint ausente ou inválido para ${name}`);
  ensurePortableDirectory(path.parse(path.resolve(targetDir)).root, path.relative(path.parse(path.resolve(targetDir)).root, path.resolve(targetDir)));
  try { fs.mkdirSync(destination); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
    throw error;
  }
  for (const resource of install.resources ?? []) {
    const source = portableFile(install.sourceRoot, resource);
    if (!source || !fs.statSync(source).isFile()) continue;
    const target = path.join(destination, resource);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (/^(?:skill|agent|manifest)\.json$/i.test(path.basename(resource))) {
      // Manifests são metadados, não um transporte de env/auth ou configurações de conta.
      let manifest: Record<string, unknown>;
      try { manifest = JSON.parse(safeRead(source) ?? "null") ?? {}; }
      catch { manifest = { id: item.name, description: item.description, entrypoint: install.entrypoint }; }
      const fields = new Set(["id", "name", "type", "version", "description", "entrypoint", "triggers", "tags", "allowedSkills", "skills", "tools", "resources", "role", "model"]);
      const metadata = Object.fromEntries(Object.entries(manifest)
        .filter(([key, value]) => fields.has(key) && (typeof value === "string" || (Array.isArray(value) && value.every(item => typeof item === "string"))))
        .map(([key, value]) => [key, typeof value === "string" ? redactCatalogText(value) : (value as string[]).map(redactCatalogText)]));
      fs.writeFileSync(target, JSON.stringify(metadata, null, 2), { encoding: "utf-8", flag: "wx" });
    } else if (/\.(?:md|txt|ya?ml)$/i.test(resource)) {
      fs.writeFileSync(target, redactCatalogText(fs.readFileSync(source, "utf-8")), { encoding: "utf-8", flag: "wx" });
    } else fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  }
  if (item.kind === "agent" && !fs.existsSync(path.join(destination, "AGENT.md"))) {
    fs.writeFileSync(path.join(destination, "AGENT.md"), `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(item.description)}\n${item.allowedSkills === undefined ? "" : `skills: ${JSON.stringify(item.allowedSkills)}\n`}---\n\n${body}`, "utf-8");
  }
  if (!fs.existsSync(path.join(destination, "SKILL.md")) || item.kind === "agent") {
    // Uma persona vira uma skill compatível; não inventamos formatos nativos de agentes.
    const skillName = item.kind === "agent" ? `codebrain-agent-${name.replace(/[^\w.-]+/g, "-")}` : name;
    const header = `---\nname: ${JSON.stringify(skillName)}\ndescription: ${JSON.stringify(item.description)}\n---\n\n`;
    const base = install.entrypoint && path.dirname(install.entrypoint) !== "." ? `Relative paths below are based on ${JSON.stringify(path.dirname(install.entrypoint))}.\n\n` : "";
    fs.writeFileSync(path.join(destination, "SKILL.md"), header + base + body, "utf-8");
  }
  return destination;
}

export function registrySkillDirectory(cli: string, workspace?: string | null, env: Record<string, string | undefined> = process.env, preferProject = false): string | null {
  const entry = getHarness(cli === "gemini-cli" ? "gemini" : cli);
  if (!entry?.verified || !entry.capabilities.skills || !entry.skillsDir) return null;
  if (preferProject && workspace && entry.skillsDir.project) return path.join(workspace, entry.skillsDir.project);
  const template = entry.skillsDir.user;
  if (template) {
    if (["claude", "codex"].includes(entry.id) && entry.accountEnvVar && env[entry.accountEnvVar]) return path.join(env[entry.accountEnvVar]!, "skills");
    const expanded = template.replace(/^~(?=[/\\]|$)/, os.homedir())
      .replace(/^\$HERMES_HOME(?=[/\\]|$)/, hermesHome(env))
      .replace(/^\$XDG_CONFIG_HOME(?=[/\\]|$)/, env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"));
    if (!expanded.includes("$") && path.isAbsolute(expanded)) return path.normalize(expanded);
  }
  return workspace && entry.skillsDir.project ? path.join(workspace, entry.skillsDir.project) : null;
}

/** Contrato legado mantido: kind opcional, padrão skill; qualquer harness do registro ou host codebrain. */
export function copySkillTo(
  name: string,
  cli: string,
  workspace?: string | null,
  kind: CatalogKind = "skill",
): { copied: string[]; mode: "native-skill" | "skill-persona" | "codebrain-files" } {
  if (!["skill", "agent"].includes(kind)) throw new Error("kind inválido");
  if (cli !== "codebrain" && !getHarness(cli === "gemini-cli" ? "gemini" : cli)) throw new Error("CLI fora do registro");
  const item = scanCatalog(workspace).find(
    (candidate) => candidate.kind === kind && candidate.name === name
  );
  if (!item) throw new Error(`${kind} "${name}" não encontrado`);
  const source = preferredCatalogInstall(item, workspace);
  const native = cli === "codebrain" ? null : registrySkillDirectory(cli, workspace);
  const accounts = listAccounts().filter(account => account.cli === cli);
  const targets = cli === "codebrain" ? [path.join(workspace || os.homedir(), ".codebrain", kind === "agent" ? "agents" : "skills")] :
    native ? accounts.length ? accounts.map(account => path.join(account.configDir, "skills")) : [native] :
    [path.join(workspace || os.homedir(), ".codebrain", "portable", cli, kind === "agent" ? "agents" : "skills")];
  const copied: string[] = [];
  for (const target of new Set(targets)) {
    const destination = copyCatalogInstall(item, source, target);
    if (destination) copied.push(destination);
  }
  return { copied, mode: native ? kind === "agent" ? "skill-persona" : "native-skill" : "codebrain-files" };
}

export const copyCatalogTo = copySkillTo;
