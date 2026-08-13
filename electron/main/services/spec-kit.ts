import * as fs from "node:fs";
import * as path from "node:path";

export interface SpecAnswers {
  title: string;
  problem: string;
  users: string;
  outcome: string;
  acceptanceCriteria: string;
  constraints?: string;
  nonGoals?: string;
}

function lines(value?: string): string[] {
  return (value || "").split(/\r?\n/).map((line) => line.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
}

function bullets(value?: string, fallback = "A definir"): string {
  const items = lines(value);
  return (items.length ? items : [fallback]).map((item) => `- ${item}`).join("\n");
}

export function detectProjectContext(workspace: string): { stack: string[]; commands: string[] } {
  const stack: string[] = [];
  const commands: string[] = [];
  const packageFile = path.join(workspace, "package.json");
  if (fs.existsSync(packageFile)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8"));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      stack.push("Node.js");
      for (const [name, label] of [["react", "React"], ["electron", "Electron"], ["next", "Next.js"], ["vite", "Vite"], ["typescript", "TypeScript"]] as const) {
        if (deps[name]) stack.push(label);
      }
      for (const name of ["test", "lint", "build", "typecheck"]) if (pkg.scripts?.[name]) commands.push(`npm run ${name}`);
    } catch { stack.push("Node.js (package.json inválido)"); }
  }
  if (fs.existsSync(path.join(workspace, "pyproject.toml")) || fs.existsSync(path.join(workspace, "requirements.txt"))) stack.push("Python");
  if (fs.existsSync(path.join(workspace, "Cargo.toml"))) stack.push("Rust");
  if (fs.existsSync(path.join(workspace, "go.mod"))) stack.push("Go");
  return { stack: [...new Set(stack)], commands };
}

export function renderSpecDocuments(answers: SpecAnswers, workspace: string): Record<"spec.md" | "plan.md" | "tasks.md", string> {
  const context = detectProjectContext(workspace);
  const criteria = lines(answers.acceptanceCriteria);
  const requirements = criteria.length ? criteria : [answers.outcome];
  const spec = `# Feature: ${answers.title}\n\n## Problema\n\n${answers.problem}\n\n## Usuários afetados\n\n${answers.users}\n\n## Resultado esperado\n\n${answers.outcome}\n\n## Requisitos funcionais\n\n${requirements.map((item, index) => `- [ ] FR-${String(index + 1).padStart(3, "0")}: ${item}`).join("\n")}\n\n## Cenários de aceitação\n\n${requirements.map((item, index) => `${index + 1}. Dado o contexto descrito, quando a feature for utilizada, então ${item.charAt(0).toLowerCase()}${item.slice(1)}.`).join("\n")}\n\n## Restrições\n\n${bullets(answers.constraints)}\n\n## Fora de escopo\n\n${bullets(answers.nonGoals, "Nada declarado") }\n\n## Critérios de sucesso\n\n${requirements.map((item, index) => `- SC-${String(index + 1).padStart(3, "0")}: ${item}`).join("\n")}\n`;
  const plan = `# Plano: ${answers.title}\n\n## Objetivo técnico\n\n${answers.outcome}\n\n## Contexto detectado\n\n- Stack: ${context.stack.join(", ") || "não detectada automaticamente"}\n- Workspace: ${workspace}\n\n## Estratégia de implementação\n\n1. Mapear os componentes e contratos afetados pelo problema.\n2. Implementar o menor corte vertical que satisfaça os requisitos funcionais.\n3. Preservar compatibilidade e dados existentes.\n4. Validar cada critério de aceitação com teste ou evidência reproduzível.\n\n## Restrições e decisões\n\n${bullets(answers.constraints)}\n\n## Verificação\n\n${context.commands.length ? context.commands.map((command) => `- \`${command}\``).join("\n") : "- Identificar e executar os comandos de teste, lint e build do projeto."}\n- Revisar todos os itens FR e SC do spec.md.\n- Registrar riscos ou desvios antes de concluir.\n\n## Rollback\n\n- Manter as mudanças isoladas e reversíveis por commit.\n- Não remover dados nem APIs existentes sem migração explícita.\n`;
  const taskLines = [
    "Ler spec.md e confirmar os arquivos/contratos afetados",
    "Mapear a implementação existente e registrar riscos",
    ...requirements.map((item) => `Implementar: ${item}`),
    "Adicionar ou atualizar testes para os critérios de aceitação",
    ...(context.commands.length ? context.commands.map((command) => `Executar ${command}`) : ["Executar testes, lint e build disponíveis"]),
    "Revisar o diff e marcar os requisitos atendidos em spec.md",
  ];
  const tasks = `# Tarefas: ${answers.title}\n\n> Execute em ordem. Marque cada item somente após obter evidência.\n\n${taskLines.map((item, index) => `- [ ] T${String(index + 1).padStart(3, "0")}: ${item}`).join("\n")}\n`;
  return { "spec.md": spec, "plan.md": plan, "tasks.md": tasks };
}

export function writeSpecDocuments(directory: string, documents: Record<string, string>): void {
  fs.mkdirSync(directory, { recursive: true });
  for (const [file, content] of Object.entries(documents)) {
    fs.writeFileSync(path.join(directory, file), content, "utf8");
  }
}
