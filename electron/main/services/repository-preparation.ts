import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

export interface RepositoryPreparationStatus {
  ok: boolean;
  initialized: boolean;
  workspace: string;
  stack: string[];
  commands: string[];
  skills: { id: string; title: string; guidance: string }[];
  files: string[];
  git: boolean;
  missing?: string[];
  error?: string;
}

const PREPARATION_FILES = [
  ".codebrain/context.md",
  ".codebrain/repository-map.md",
  ".codebrain/workflow.md",
  ".codebrain/scripts/context.cjs",
  ".codebrain/scripts/verify.cjs",
  ".codebrain/baseline.json",
];

type DetectedSkill = { id: string; title: string; guidance: string };

const BASE_SKILLS: DetectedSkill[] = [
  {
    id: "project-conventions",
    title: "Convenções do projeto",
    guidance:
      "Antes de implementar, leia `.codebrain/context.md`, `.codebrain/repository-map.md` e `.codebrain/workflow.md`. Preserve as convenções, APIs e o conteúdo humano existentes. Atualize o contexto com evidências do código quando a arquitetura mudar.",
  },
  {
    id: "test-and-verify",
    title: "Testar e verificar",
    guidance:
      "Consulte `node .codebrain/scripts/verify.cjs --list`. Execute somente as verificações relevantes ao trabalho e registre o comando, resultado e limitações. Preparar o repositório não significa que os testes foram executados. Valide o fluxo afetado antes de declarar sucesso.",
  },
];

// Nunca segue links da árvore gerada para fora do repositório escolhido.
function localTarget(root: string, relative: string): string {
  const parts = relative.split(/[\\/]/);
  let target = root;
  for (const part of parts) {
    if (!part || part === ".." || part === ".") throw new Error("Caminho de preparação inválido.");
    target = path.join(target, part);
    try {
      if (fs.lstatSync(target).isSymbolicLink())
        throw new Error(`Preparação bloqueada por link simbólico: ${relative}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return target;
}

function hasContent(file: string): boolean {
  try {
    return fs.statSync(file).isFile() && fs.readFileSync(file, "utf8").trim().length > 0;
  } catch {
    return false;
  }
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
function git(workspace: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: workspace,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}
function detect(workspace: string) {
  const stack: string[] = [];
  const commands: string[] = [];
  const skills: DetectedSkill[] = [...BASE_SKILLS];
  const pkg = readJson(path.join(workspace, "package.json"));
  if (!pkg && fs.existsSync(path.join(workspace, "package.json")))
    throw new Error("package.json inválido; corrija o JSON antes de preparar o repositório.");
  if (pkg) {
    stack.push("Node.js");
    const deps = {
      ...((pkg.dependencies as Record<string, unknown>) ?? {}),
      ...((pkg.devDependencies as Record<string, unknown>) ?? {}),
    };
    if (deps.react) {
      stack.push("React");
      skills.push({
        id: "react-frontend",
        title: "Frontend React",
        guidance:
          "Localize a rota, o componente e o estado afetados antes de editar. Preserve acessibilidade, estados de carregamento e erro. Prefira testes do fluxo visível e valide responsividade quando houver interface.",
      });
    }
    if (deps.typescript) stack.push("TypeScript");
    if (deps.vite) stack.push("Vite");
    if (deps.next) {
      stack.push("Next.js");
      skills.push({
        id: "nextjs-app",
        title: "Aplicação Next.js",
        guidance:
          "Respeite a divisão entre Server e Client Components. Verifique rotas, cache e variáveis de ambiente antes de mudar o comportamento. Não exponha segredos no bundle do cliente.",
      });
    }
    if (deps.vue) {
      stack.push("Vue");
      skills.push({
        id: "vue-frontend",
        title: "Frontend Vue",
        guidance:
          "Mantenha a composição, reatividade e contratos de props/emits existentes. Valide a rota ou tela afetada depois da mudança.",
      });
    }
    if (deps["@nestjs/core"]) {
      stack.push("NestJS");
      skills.push({
        id: "nestjs-backend",
        title: "Backend NestJS",
        guidance:
          "Mantenha módulos, injeção de dependência, DTOs e guards coerentes. Valide o contrato HTTP e os testes do módulo afetado.",
      });
    }
    if (deps.express || deps.fastify) {
      stack.push("Node API");
      skills.push({
        id: "node-api",
        title: "API Node.js",
        guidance:
          "Mapeie rota, validação, autenticação e persistência antes de alterar a API. Preserve status HTTP, formato de erro e compatibilidade dos consumidores.",
      });
    }
    if (deps.prisma) {
      stack.push("Prisma");
      skills.push({
        id: "prisma-data",
        title: "Dados com Prisma",
        guidance:
          "Revise o schema e migrations antes de editar modelos. Nunca aplique migração destrutiva sem uma estratégia explícita de dados e rollback.",
      });
    }
    const scripts = pkg.scripts as Record<string, string> | undefined;
    const declared =
      typeof pkg.packageManager === "string" ? pkg.packageManager.split("@")[0] : null;
    const manager = ["npm", "pnpm", "yarn", "bun"].includes(declared ?? "")
      ? declared
      : fs.existsSync(path.join(workspace, "pnpm-lock.yaml"))
        ? "pnpm"
        : fs.existsSync(path.join(workspace, "yarn.lock"))
          ? "yarn"
          : "npm";
    for (const name of ["lint", "test", "build", "typecheck"])
      if (typeof scripts?.[name] === "string" && scripts[name].trim())
        commands.push(`${manager} run ${name}`);
  }
  const composer = readJson(path.join(workspace, "composer.json"));
  if (!composer && fs.existsSync(path.join(workspace, "composer.json")))
    throw new Error("composer.json inválido; corrija o JSON antes de preparar o repositório.");
  if (composer) {
    stack.push("PHP");
    const deps = {
      ...((composer.require as Record<string, unknown>) ?? {}),
      ...((composer["require-dev"] as Record<string, unknown>) ?? {}),
    };
    if (deps["laravel/framework"] || deps["laravel/laravel"]) {
      stack.push("Laravel");
      skills.push({
        id: "laravel-application",
        title: "Aplicação Laravel",
        guidance:
          "Use os padrões que o repositório já adota para rotas, requests, policies, actions e migrations. Valide autorização, regras de negócio e o caminho de rollback de mudanças no banco.",
      });
    }
    const scripts = composer.scripts as Record<string, unknown> | undefined;
    for (const name of ["test", "lint", "analyse"])
      if (scripts?.[name]) commands.push(`composer run ${name}`);
  }
  if (fs.existsSync(path.join(workspace, "pyproject.toml"))) {
    stack.push("Python");
    const pyproject = fs.readFileSync(path.join(workspace, "pyproject.toml"), "utf8");
    if (/django/i.test(pyproject)) {
      stack.push("Django");
      skills.push({
        id: "django-application",
        title: "Aplicação Django",
        guidance:
          "Preserve models, migrations, views e permissões existentes. Execute os testes da aplicação afetada e revise migrations antes de concluir.",
      });
    }
    if (/fastapi/i.test(pyproject)) {
      stack.push("FastAPI");
      skills.push({
        id: "fastapi-api",
        title: "API FastAPI",
        guidance:
          "Mantenha schemas, dependências, validação e códigos de resposta consistentes. Teste o endpoint e as falhas esperadas.",
      });
    }
  }
  if (fs.existsSync(path.join(workspace, "Cargo.toml"))) stack.push("Rust");
  if (fs.existsSync(path.join(workspace, "go.mod"))) stack.push("Go");
  if (fs.existsSync(path.join(workspace, ".git"))) stack.push("Git");
  return {
    stack: [...new Set(stack)],
    commands: [...new Set(commands)],
    skills: skills.filter(
      (skill, index, list) => list.findIndex((candidate) => candidate.id === skill.id) === index
    ),
  };
}

export function getRepositoryPreparationStatus(workspace: string): RepositoryPreparationStatus {
  try {
    if (typeof workspace !== "string" || !workspace.trim())
      throw new Error("Informe o workspace a preparar.");
    const root = fs.realpathSync(path.resolve(workspace));
    if (!fs.statSync(root).isDirectory())
      return {
        ok: false,
        initialized: false,
        workspace: root,
        stack: [],
        commands: [],
        skills: [],
        files: [],
        git: false,
        error: "Workspace inválido.",
      };
    const details = detect(root);
    const expected = [...PREPARATION_FILES];
    const missing = expected.filter((file) => !hasContent(localTarget(root, file)));
    const baseline = readJson(localTarget(root, ".codebrain/baseline.json"));
    if (!baseline || !Array.isArray(baseline.stack) || !Array.isArray(baseline.commands))
      missing.push(".codebrain/baseline.json (metadados inválidos)");
    for (const skill of details.skills) {
      const relative = `.codebrain/skills/${skill.id}/skill.json`;
      expected.push(relative);
      const manifest = readJson(localTarget(root, relative));
      if (
        !manifest ||
        manifest.id !== skill.id ||
        typeof manifest.name !== "string" ||
        manifest.type !== "prompt" ||
        typeof manifest.entrypoint !== "string" ||
        !/^[\w.-]+\.md$/.test(manifest.entrypoint)
      ) {
        missing.push(relative);
        continue;
      }
      const entrypoint = `.codebrain/skills/${skill.id}/${manifest.entrypoint}`;
      expected.push(entrypoint);
      if (!hasContent(localTarget(root, entrypoint))) missing.push(entrypoint);
    }
    const files = expected.filter((file) => hasContent(localTarget(root, file)));
    return {
      ok: true,
      initialized: missing.length === 0,
      workspace: root,
      ...details,
      files,
      missing,
      git: git(root, ["rev-parse", "--is-inside-work-tree"]) === "true",
    };
  } catch (error) {
    return {
      ok: false,
      initialized: false,
      workspace,
      stack: [],
      commands: [],
      skills: [],
      files: [],
      git: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const CONTEXT_SCRIPT = `"use strict";
const fs = require("node:fs");
const path = require("node:path");
const directory = path.resolve(__dirname, "..");
for (const name of ["context.md", "repository-map.md", "workflow.md"]) {
  const file = path.join(directory, name);
  try { process.stdout.write(fs.readFileSync(file, "utf8") + "\\n"); }
  catch (error) { console.error("Não foi possível ler " + name + ": " + error.message); process.exitCode = 1; }
}
`;

const VERIFY_SCRIPT = `"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "../..");
try {
  const baseline = JSON.parse(fs.readFileSync(path.join(root, ".codebrain", "baseline.json"), "utf8"));
  const commands = baseline.commands;
  if (!Array.isArray(commands) || commands.some((command) => typeof command !== "string" || !/^(npm|pnpm|yarn|bun|composer) run [a-zA-Z0-9:_-]+$/.test(command))) throw new Error("Comandos da baseline inválidos; revise a preparação.");
  const mode = process.argv[2] || "--list";
  if (mode === "--list") {
    console.log(commands.length ? commands.join("\\n") : "Nenhum comando de verificação detectado. Defina os comandos do projeto antes de executar.");
  } else if (mode === "--run") {
    const selected = process.argv[3] ? commands.filter((command) => command.split(" ")[2] === process.argv[3]) : commands;
    if (!selected.length) throw new Error("Nenhuma verificação correspondente detectada.");
    for (const command of selected) {
      const [binary, ...args] = command.split(" ");
      console.log("$ " + command);
      const windows = process.platform === "win32";
      const result = spawnSync(windows ? process.env.COMSPEC || "cmd.exe" : binary, windows ? ["/d", "/s", "/c", command] : args, { cwd: root, stdio: "inherit", windowsHide: true });
      if (result.error) throw result.error;
      if (result.status !== 0) { process.exitCode = result.status || 1; break; }
    }
  } else throw new Error("Uso: node .codebrain/scripts/verify.cjs --list | --run [nome]");
} catch (error) { console.error(error.message); process.exitCode = 1; }
`;

export function prepareRepository(
  workspace: string,
  createCommit = false
): RepositoryPreparationStatus & { created?: string[]; commit?: string; commitError?: string } {
  const status = getRepositoryPreparationStatus(workspace);
  if (!status.ok) return status;
  const root = status.workspace;
  const now = new Date().toISOString();
  const stack = status.stack.length
    ? status.stack.join(", ")
    : "a detectar durante a próxima sessão";
  const commands = status.commands.length
    ? status.commands.map((command) => `- \`${command}\``).join("\n")
    : "- Definir comandos de lint, teste e build antes de automatizar mudanças.";
  const created: string[] = [];
  try {
    const rootEntries = fs
      .readdirSync(root, { withFileTypes: true })
      .filter(
        (entry) =>
          !["node_modules", ".git", "dist", "out", "build", ".env"].includes(entry.name) &&
          !entry.name.startsWith(".env.")
      )
      .slice(0, 80)
      .map((entry) => `- ${entry.isDirectory() ? "📁" : "📄"} \`${entry.name}\``)
      .join("\n");
    const documents: Record<string, string> = {
      "context.md": `# Contexto do repositório\n\nGerado pelo Codebrain em ${now}. Atualize este documento quando decisões importantes mudarem.\n\n## Stack detectada\n\n${stack}\n\n## Comandos de verificação\n\n${commands}\n\n## Regras de trabalho\n\n- Leia o contexto e os arquivos afetados antes de editar.\n- Faça mudanças pequenas, verificáveis e reversíveis.\n- Execute a verificação relevante antes de concluir.\n- Registre riscos, premissas e decisões que não sejam óbvias no código.\n`,
      "repository-map.md": `# Mapa do repositório\n\n## Raiz\n\n${rootEntries || "- Repositório vazio ou sem itens visíveis."}\n\n## Como manter\n\nAtualize este mapa quando adicionar módulos, serviços, apps ou pacotes relevantes. Ele é o ponto de partida para agentes entenderem o projeto sem adivinhar a arquitetura.\n`,
      "workflow.md": `# Fluxo de entrega\n\n1. Clarificar objetivo e critério de sucesso.\n2. Criar ou atualizar spec, plano e tarefas quando a mudança justificar.\n3. Implementar o menor corte vertical possível.\n4. Executar lint, testes e build aplicáveis.\n5. Resumir evidências e riscos antes do commit.\n\n## Commit\n\nCommits devem ser pequenos e descrever a intenção. Nunca incluir segredos, artefatos de build ou alterações não relacionadas.\n`,
      "scripts/context.cjs": CONTEXT_SCRIPT,
      "scripts/verify.cjs": VERIFY_SCRIPT,
    };
    for (const skill of status.skills) {
      documents[`skills/${skill.id}/SKILL.md`] =
        `---\nname: ${skill.id}\ndescription: ${JSON.stringify(skill.title)}\n---\n\n# ${skill.title}\n\nSkill local nativa do Codebrain. Stack detectada: ${stack}. Confirme as convenções no código antes de implementar.\n\n${skill.guidance}\n\n## Verificação\n\n${commands}\n\nA preparação apenas detectou estes comandos; ainda não os executou.\n`;
      documents[`skills/${skill.id}/skill.json`] =
        JSON.stringify(
          {
            id: skill.id,
            name: skill.title,
            type: "prompt",
            version: "1.0.0",
            description: skill.title,
            entrypoint: "SKILL.md",
            tags: ["codebrain", "project", "preparation"],
          },
          null,
          2
        ) + "\n";
    }
    for (const [relative, content] of Object.entries(documents)) {
      const target = localTarget(root, `.codebrain/${relative}`);
      // Context written by a person or an earlier tool is source-of-truth.
      // Only baseline is refreshed to record the successful preparation.
      if (hasContent(target)) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, {
        encoding: "utf8",
        flag: fs.existsSync(target) ? "w" : "wx",
      });
      created.push(`.codebrain/${relative}`);
    }
    const incomplete = getRepositoryPreparationStatus(root);
    const missingFiles = incomplete.missing?.filter(
      (file) => !file.startsWith(".codebrain/baseline.json")
    );
    if (!incomplete.ok || missingFiles?.length)
      return {
        ...incomplete,
        ok: false,
        created,
        error:
          incomplete.error ??
          `Preparação incompleta. Revise os arquivos existentes: ${missingFiles?.join(", ")}`,
      };
    const baselinePath = localTarget(root, ".codebrain/baseline.json");
    const previous = readJson(baselinePath);
    const baseline =
      JSON.stringify(
        {
          ...previous,
          version: 2,
          preparedAt: status.initialized ? (previous?.preparedAt ?? now) : now,
          workspace: root,
          stack: status.stack,
          commands: status.commands,
          skills: status.skills.map((skill) => skill.id),
          verification: "not-run",
        },
        null,
        2
      ) + "\n";
    if (!hasContent(baselinePath) || fs.readFileSync(baselinePath, "utf8") !== baseline) {
      fs.writeFileSync(baselinePath, baseline, "utf8");
      created.push(".codebrain/baseline.json");
    }
    const result = getRepositoryPreparationStatus(root);
    if (!result.ok || !result.initialized)
      return {
        ...result,
        ok: false,
        created,
        error:
          result.error ??
          `Preparação incompleta. Revise os arquivos existentes: ${result.missing?.join(", ")}`,
      };
    let commit: string | undefined;
    let commitError: string | undefined;
    if (createCommit && status.git) {
      if (created.length) {
        const staged = git(root, ["add", "--", ...created]);
        const committed =
          staged !== null
            ? git(root, [
                "commit",
                "--only",
                "-m",
                "chore(codebrain): initialize repository context",
                "--",
                ...created,
              ])
            : null;
        if (committed) commit = committed.split("\n")[0];
        else commitError = "Não foi possível criar o commit; os arquivos continuam preparados.";
      }
    }
    return { ...result, created, commit, commitError };
  } catch (error) {
    return {
      ...status,
      ok: false,
      created,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
