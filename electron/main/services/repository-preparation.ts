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
  error?: string;
}

const PREPARATION_FILES = [
  ".codebrain/context.md", ".codebrain/repository-map.md", ".codebrain/workflow.md",
  ".codebrain/skills/project-conventions/SKILL.md", ".codebrain/skills/test-and-verify/SKILL.md", ".codebrain/baseline.json",
];

type DetectedSkill = { id: string; title: string; guidance: string };

function readJson(file: string): Record<string, unknown> | null {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}
function git(workspace: string, args: string[]): string | null {
  try { return execFileSync("git", args, { cwd: workspace, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; }
}
function detect(workspace: string) {
  const stack: string[] = [];
  const commands: string[] = [];
  const skills: DetectedSkill[] = [];
  const pkg = readJson(path.join(workspace, "package.json"));
  if (pkg) {
    stack.push("Node.js");
    const deps = { ...(pkg.dependencies as Record<string, unknown> ?? {}), ...(pkg.devDependencies as Record<string, unknown> ?? {}) };
    if (deps.react) {
      stack.push("React");
      skills.push({ id: "react-frontend", title: "Frontend React", guidance: "Localize a rota, o componente e o estado afetados antes de editar. Preserve acessibilidade, estados de carregamento e erro. Prefira testes do fluxo visível e valide responsividade quando houver interface." });
    }
    if (deps.typescript) stack.push("TypeScript");
    if (deps.vite) stack.push("Vite");
    if (deps.next) { stack.push("Next.js"); skills.push({ id: "nextjs-app", title: "Aplicação Next.js", guidance: "Respeite a divisão entre Server e Client Components. Verifique rotas, cache e variáveis de ambiente antes de mudar o comportamento. Não exponha segredos no bundle do cliente." }); }
    if (deps.vue) { stack.push("Vue"); skills.push({ id: "vue-frontend", title: "Frontend Vue", guidance: "Mantenha a composição, reatividade e contratos de props/emits existentes. Valide a rota ou tela afetada depois da mudança." }); }
    if (deps["@nestjs/core"]) { stack.push("NestJS"); skills.push({ id: "nestjs-backend", title: "Backend NestJS", guidance: "Mantenha módulos, injeção de dependência, DTOs e guards coerentes. Valide o contrato HTTP e os testes do módulo afetado." }); }
    if (deps.express || deps.fastify) { stack.push("Node API"); skills.push({ id: "node-api", title: "API Node.js", guidance: "Mapeie rota, validação, autenticação e persistência antes de alterar a API. Preserve status HTTP, formato de erro e compatibilidade dos consumidores." }); }
    if (deps.prisma) { stack.push("Prisma"); skills.push({ id: "prisma-data", title: "Dados com Prisma", guidance: "Revise o schema e migrations antes de editar modelos. Nunca aplique migração destrutiva sem uma estratégia explícita de dados e rollback." }); }
    const scripts = pkg.scripts as Record<string, string> | undefined;
    for (const name of ["lint", "test", "build", "typecheck"]) if (scripts?.[name]) commands.push(`npm run ${name}`);
  }
  const composer = readJson(path.join(workspace, "composer.json"));
  if (composer) {
    stack.push("PHP");
    const deps = { ...(composer.require as Record<string, unknown> ?? {}), ...(composer["require-dev"] as Record<string, unknown> ?? {}) };
    if (deps["laravel/framework"] || deps["laravel/laravel"]) {
      stack.push("Laravel");
      skills.push({ id: "laravel-application", title: "Aplicação Laravel", guidance: "Use os padrões que o repositório já adota para rotas, requests, policies, actions e migrations. Valide autorização, regras de negócio e o caminho de rollback de mudanças no banco." });
    }
    commands.push("composer test");
  }
  if (fs.existsSync(path.join(workspace, "pyproject.toml"))) {
    stack.push("Python");
    const pyproject = fs.readFileSync(path.join(workspace, "pyproject.toml"), "utf8");
    if (/django/i.test(pyproject)) { stack.push("Django"); skills.push({ id: "django-application", title: "Aplicação Django", guidance: "Preserve models, migrations, views e permissões existentes. Execute os testes da aplicação afetada e revise migrations antes de concluir." }); }
    if (/fastapi/i.test(pyproject)) { stack.push("FastAPI"); skills.push({ id: "fastapi-api", title: "API FastAPI", guidance: "Mantenha schemas, dependências, validação e códigos de resposta consistentes. Teste o endpoint e as falhas esperadas." }); }
  }
  if (fs.existsSync(path.join(workspace, "Cargo.toml"))) stack.push("Rust");
  if (fs.existsSync(path.join(workspace, "go.mod"))) stack.push("Go");
  if (fs.existsSync(path.join(workspace, ".git"))) stack.push("Git");
  return { stack: [...new Set(stack)], commands: [...new Set(commands)], skills: skills.filter((skill, index, list) => list.findIndex((candidate) => candidate.id === skill.id) === index) };
}

export function getRepositoryPreparationStatus(workspace: string): RepositoryPreparationStatus {
  try {
    const root = path.resolve(workspace);
    if (!fs.statSync(root).isDirectory()) return { ok: false, initialized: false, workspace: root, stack: [], commands: [], skills: [], files: [], git: false, error: "Workspace inválido." };
    const details = detect(root);
    const files = PREPARATION_FILES.filter((file) => fs.existsSync(path.join(root, file)));
    // The preparation agent writes human-readable context files. It may
    // deliberately avoid the machine baseline, so the recommendation must
    // recognise its completed work instead of appearing forever.
    const initialized = fs.existsSync(path.join(root, ".codebrain", "baseline.json"))
      || fs.existsSync(path.join(root, ".codebrain", "context.md"));
    return { ok: true, initialized, workspace: root, ...details, files, git: Boolean(git(root, ["rev-parse", "--is-inside-work-tree"])) };
  } catch (error) {
    return { ok: false, initialized: false, workspace, stack: [], commands: [], skills: [], files: [], git: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function prepareRepository(workspace: string, createCommit = false) {
  const status = getRepositoryPreparationStatus(workspace);
  if (!status.ok) return status;
  const root = status.workspace;
  const codebrain = path.join(root, ".codebrain");
  const now = new Date().toISOString();
  const stack = status.stack.length ? status.stack.join(", ") : "a detectar durante a próxima sessão";
  const commands = status.commands.length ? status.commands.map((command) => `- \`${command}\``).join("\n") : "- Definir comandos de lint, teste e build antes de automatizar mudanças.";
  const rootEntries = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => !["node_modules", ".git", "dist", "out", "build"].includes(entry.name)).slice(0, 80).map((entry) => `- ${entry.isDirectory() ? "📁" : "📄"} \`${entry.name}\``).join("\n");
  const documents: Record<string, string> = {
    "context.md": `# Contexto do repositório\n\nGerado pelo Codebrain em ${now}. Atualize este documento quando decisões importantes mudarem.\n\n## Stack detectada\n\n${stack}\n\n## Comandos de verificação\n\n${commands}\n\n## Regras de trabalho\n\n- Leia o contexto e os arquivos afetados antes de editar.\n- Faça mudanças pequenas, verificáveis e reversíveis.\n- Execute a verificação relevante antes de concluir.\n- Registre riscos, premissas e decisões que não sejam óbvias no código.\n`,
    "repository-map.md": `# Mapa do repositório\n\n## Raiz\n\n${rootEntries || "- Repositório vazio ou sem itens visíveis."}\n\n## Como manter\n\nAtualize este mapa quando adicionar módulos, serviços, apps ou pacotes relevantes. Ele é o ponto de partida para agentes entenderem o projeto sem adivinhar a arquitetura.\n`,
    "workflow.md": `# Fluxo de entrega\n\n1. Clarificar objetivo e critério de sucesso.\n2. Criar ou atualizar spec, plano e tarefas quando a mudança justificar.\n3. Implementar o menor corte vertical possível.\n4. Executar lint, testes e build aplicáveis.\n5. Resumir evidências e riscos antes do commit.\n\n## Commit\n\nCommits devem ser pequenos e descrever a intenção. Nunca incluir segredos, artefatos de build ou alterações não relacionadas.\n`,
    "skills/project-conventions/SKILL.md": "# Convenções do projeto\n\nAntes de implementar, leia `.codebrain/context.md`, `.codebrain/repository-map.md` e as convenções já existentes no repositório. Preserve APIs e comportamento salvo quando houver requisito explícito para alterá-los. Documente decisões que afetem arquitetura, dados ou integração.\n",
    "skills/test-and-verify/SKILL.md": "# Testar e verificar\n\nAntes de concluir uma tarefa, execute os comandos relevantes listados em `.codebrain/context.md`. Se uma verificação não puder ser executada, informe o motivo e descreva o risco. Não declare sucesso apenas por o código compilar: valide o fluxo afetado.\n",
    "baseline.json": JSON.stringify({ version: 1, preparedAt: now, workspace: root, stack: status.stack, commands: status.commands, skills: status.skills.map((skill) => skill.id) }, null, 2) + "\n",
  };
  for (const skill of status.skills) {
    documents[`skills/${skill.id}/SKILL.md`] = `# ${skill.title}\n\nEsta Skill foi criada pela preparação do Codebrain porque a stack foi detectada neste repositório.\n\n${skill.guidance}\n\n## Verificação\n\n${commands}\n`;
  }
  try {
    const created: string[] = [];
    for (const [relative, content] of Object.entries(documents)) {
      const target = path.join(codebrain, relative);
      // Context written by a person or an earlier tool is source-of-truth.
      // Only baseline is refreshed to record the successful preparation.
      if (relative !== "baseline.json" && fs.existsSync(target)) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, "utf8");
      created.push(`.codebrain/${relative}`);
    }
    let commit: string | undefined;
    let commitError: string | undefined;
    if (createCommit && status.git) {
      git(root, ["add", ".codebrain"]);
      const result = git(root, ["commit", "-m", "chore(codebrain): initialize repository context"]);
      if (result) commit = result.split("\n")[0]; else commitError = "Não foi possível criar o commit; os arquivos continuam preparados.";
    }
    return { ...getRepositoryPreparationStatus(root), created, commit, commitError };
  } catch (error) {
    return { ...status, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
