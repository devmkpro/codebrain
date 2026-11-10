/** Codebrain é o host de contexto e de bundles; o registro continua dono das capacidades/flags das CLIs. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  catalogInstructions,
  copyCatalogInstall,
  ensurePortableDirectory,
  portableFile,
  portableFiles,
  preferredCatalogInstall,
  redactCatalogText,
  registrySkillDirectory,
  scanCatalog,
  type CatalogItem,
} from "../catalog";
import { getHarness } from "./cli-registry";

export interface CodebrainContextSource {
  origin: "workspace" | "global";
  path: string;
  kind: "context" | "repository-map" | "workflow";
}

/** Só documentos de contexto conhecidos; não varre .codebrain recursivamente. */
export function discoverCodebrainContext(workspace: string): CodebrainContextSource[] {
  const found: CodebrainContextSource[] = [];
  const roots = [{ root: path.join(os.homedir(), ".codebrain"), origin: "global" as const }, { root: path.join(workspace, ".codebrain"), origin: "workspace" as const }];
  const seen = new Set<string>();
  for (const { root, origin } of roots) {
    for (const kind of ["context", "repository-map", "workflow"] as const) {
      const candidates = kind === "context" ? ["context.md"] : [kind, ...["md", "json", "yaml", "yml", "txt"].map(ext => `${kind}.${ext}`)];
      for (const relative of candidates) {
        const candidate = portableFile(root, relative);
        if (!candidate) continue;
        const files = fs.statSync(candidate).isDirectory() ? portableFiles(candidate).map(file => path.join(candidate, file)) : [candidate];
        for (const file of files) {
          if (!/\.(?:md|json|ya?ml|txt)$/i.test(file) || seen.has(file)) continue;
          seen.add(file);
          found.push({ origin, path: file, kind });
        }
      }
    }
  }
  return found;
}

export interface CodebrainAdapterInput {
  cwd: string;
  workspacePath?: string;
  paneId: string;
  agent: string;
  agentName?: string;
  /** Ausente = catálogo ativo; [] = nenhuma skill autorizada. */
  allowedSkills?: readonly string[];
  env?: Record<string, string | undefined>;
}

export interface CodebrainAdapterResult {
  codebrainContext: string;
  codebrainCatalogPath: string;
  allowedSkills: string[];
  copied: string[];
  warnings: string[];
}

export const CODEBRAIN_SHARED_GUIDE = "# Codebrain host context\n\nRead .codebrain/context.md, .codebrain/repository-map.md and .codebrain/workflow.md when present. The current task supplies its own Codebrain adapter catalog path, selected agent and authorized skills. Use that task-specific catalog; never adopt another pane's persona or skill permissions. Credentials, .env, vaults and runtime caches are not context sources.\n";

/** Guia estável compartilhável, sem identidade, persona ou whitelist de nenhum pane. */
export function writeSharedCodebrainGuide(file: string): boolean {
  const absolute = path.resolve(file);
  const root = path.parse(absolute).root;
  ensurePortableDirectory(root, path.relative(root, path.dirname(absolute)));
  try {
    fs.writeFileSync(absolute, CODEBRAIN_SHARED_GUIDE, { encoding: "utf-8", flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

function writeNewOrSame(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, text, { encoding: "utf-8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST" && fs.readFileSync(file, "utf-8") === text) return;
    throw new Error(`O adapter não sobrescreve conteúdo existente: ${file}`);
  }
}

/** Filtra antes de copiar/gerar índices. Nenhum script é executado e nenhuma permissão é alterada. */
export function prepareCodebrainAdapter(input: CodebrainAdapterInput): CodebrainAdapterResult {
  const workspace = input.workspacePath || input.cwd;
  const harness = getHarness(input.agent === "gemini-cli" ? "gemini" : input.agent);
  const catalog = scanCatalog(workspace).filter(item => !item.disabled);
  const selectedAgent = input.agentName ? catalog.find(item => item.kind === "agent" && item.name === input.agentName) : undefined;
  if (input.agentName && !selectedAgent) throw new Error(`Agente ${JSON.stringify(input.agentName)} ausente ou desativado.`);
  const agentSkills = selectedAgent?.allowedSkills;
  const allowed = input.allowedSkills === undefined ? undefined : new Set(input.allowedSkills);
  const skills = catalog.filter(item => item.kind === "skill" && (!allowed || allowed.has(item.name)) && (agentSkills === undefined || agentSkills.includes(item.name)));
  const warnings: string[] = [];
  const copied: string[] = [];
  const safeId = input.paneId.replace(/[^\w.-]/g, "-");
  if (!safeId || safeId === "." || safeId === "..") throw new Error("paneId inválido para o adapter");
  const adapterDir = path.join(input.cwd, ".codebrain", "adapters", `${safeId}-${randomUUID()}`);
  // Uma pasta .codebrain ligada a outro lugar não é um destino de exportação.
  ensurePortableDirectory(input.cwd, path.relative(input.cwd, adapterDir));
  const items: { kind: string; name: string; description: string; origin: string; sourcePath: string; sourceEntrypoint?: string; entrypoint: string; resources: string[]; nativePath?: string }[] = [];
  const nativeDir = harness?.verified && harness.capabilities.skills ? registrySkillDirectory(harness.id, input.cwd, input.env, true) : null;
  const stage = (item: CatalogItem) => {
    const install = preferredCatalogInstall(item, workspace);
    if (catalogInstructions(install) === null) { warnings.push(`${item.kind} ${item.name}: entrypoint ausente ou inválido`); return; }
    const destination = copyCatalogInstall(item, install, path.join(adapterDir, item.kind === "skill" ? "skills" : "agents"));
    if (!destination) throw new Error(`Bundle de adapter já existe: ${item.name}`);
    copied.push(destination);
    let nativePath: string | undefined;
    if (nativeDir && item.kind === "skill") {
      try { nativePath = copyCatalogInstall(item, install, nativeDir) ?? undefined; if (nativePath) copied.push(nativePath); }
      catch { warnings.push(`${item.name}: instalação nativa indisponível; use o entrypoint portável`); }
    }
    items.push({ kind: item.kind, name: item.name, description: item.description, origin: install.cli, sourcePath: install.path, sourceEntrypoint: install.entrypoint, entrypoint: path.join(destination, "SKILL.md"), resources: portableFiles(destination), ...(nativePath ? { nativePath } : {}) });
  };
  for (const skill of skills) stage(skill);
  if (selectedAgent) stage(selectedAgent);
  const documents = discoverCodebrainContext(workspace).flatMap(document => {
    if (fs.statSync(document.path).size > 256_000) { warnings.push(`${document.kind}: documento grande mantido fora do contexto`); return []; }
    const relative = path.relative(path.join(document.origin === "global" ? os.homedir() : workspace, ".codebrain"), document.path);
    const target = path.join(adapterDir, "documents", document.origin, relative);
    writeNewOrSame(target, redactCatalogText(fs.readFileSync(document.path, "utf-8")));
    return [{ ...document, sourcePath: document.path, path: target }];
  });
  const codebrainCatalogPath = path.join(adapterDir, "catalog.json");
  writeNewOrSame(codebrainCatalogPath, JSON.stringify({ host: "codebrain", harness: harness?.id ?? input.agent, agentName: input.agentName ?? null, allowedSkills: skills.map(item => item.name), documents, items }, null, 2));
  let budget = 7_000;
  const snippets: string[] = [];
  for (const document of documents) {
    // Arquivos grandes continuam no índice lazy; nunca despejamos seu conteúdo no prompt.
    const size = fs.statSync(document.path).size;
    if (size > 64_000 || budget <= 0) continue;
    const text = redactCatalogText(fs.readFileSync(document.path, "utf-8"));
    const excerpt = text.slice(0, Math.min(2_000, budget));
    budget -= excerpt.length;
    snippets.push(`### ${document.kind} (${document.origin}) ${JSON.stringify(document.path)}\n${excerpt}${excerpt.length < text.length ? "\n[continua no arquivo]" : ""}`);
  }
  const agentItem = items.find(item => item.kind === "agent");
  const persona = selectedAgent ? catalogInstructions(preferredCatalogInstall(selectedAgent, workspace)) : null;
  const codebrainContext = [
    "## Codebrain host adapter",
    `Codebrain is the canonical host. Harness: ${harness?.label ?? input.agent}. Lazy catalog: ${JSON.stringify(codebrainCatalogPath)}.`,
    "Read a listed entrypoint before using its skill; scripts/assets/references travel with the bundle and paths resolve relative to that bundle. Do not execute scripts just to discover a skill.",
    `Only these skills are authorized for this pane: ${JSON.stringify(skills.map(item => item.name))}. Do not load other native or global skills for this task.`,
    ...(skills.some(item => item.name === "cb-ssh-operations") ? ["For SSH to the current project, first inspect workspace instructions, deployment docs/CI and saved project-to-host mappings. Load cb-ssh-operations before connecting; use the authorized vault and confirm the remote application instead of guessing hosts or usernames."] : []),
    ...(skills.some(item => item.name === "cb-safe-deploy") ? ["For an authorized production deploy, load cb-safe-deploy: inspect active jobs, preserve data and rollback, drain workers and verify the actual application flow. Busy services guide the continuity strategy, not an automatic refusal."] : []),
    ...(selectedAgent ? [`Selected agent: ${JSON.stringify(selectedAgent.name)}. Load its full persona/resources from ${JSON.stringify(agentItem?.entrypoint)}.\n${persona?.slice(0, 3_000) ?? ""}`] : []),
    ...items.slice(0, 30).map(item => `- ${item.kind} ${JSON.stringify(item.name)}: ${JSON.stringify(item.description.slice(0, 180))}; read ${JSON.stringify(item.entrypoint)}`),
    ...(items.length > 30 ? ["More authorized entries are in the lazy catalog."] : []),
    ...snippets,
    "Credentials, vaults, .env files, caches and temporary state are not context sources. Existing user instructions and permissions remain authoritative.",
  ].join("\n\n");
  writeNewOrSame(path.join(adapterDir, "CONTEXT.md"), codebrainContext);
  return { codebrainContext, codebrainCatalogPath, allowedSkills: skills.map(item => item.name), copied, warnings };
}

/** Substitui apenas o índice legado não filtrado; não modifica os arquivos de instruções do usuário. */
export function attachCodebrainContext(prompt: string, context: string): string {
  return prompt.replace(/\n\n## Skills \(lazy\)\nLoad a matching skill with `skill_get\(\{ id \}\)` before using it\.[\s\S]*?(?=\n\n## |$)/g, "") + `\n\n${context}`;
}
