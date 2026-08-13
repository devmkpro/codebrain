import { ipcMain, shell } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AppContext } from "../context";

function safeWorkspace(workspace: unknown): string {
  if (typeof workspace !== "string" || !path.isAbsolute(workspace)) throw new Error("workspace inválido");
  const resolved = path.resolve(workspace);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) throw new Error("workspace não encontrado");
  return resolved;
}

function slugify(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 56);
}

function listSpecs(workspace: string) {
  const root = path.join(workspace, "specs");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^\d{3}-/.test(entry.name)).sort().reverse().map((entry) => {
    const dir = path.join(root, entry.name);
    const files = ["spec.md", "plan.md", "tasks.md"].map((name) => ({ name, exists: fs.existsSync(path.join(dir, name)) }));
    return { id: entry.name, title: entry.name.replace(/^\d{3}-/, "").replace(/-/g, " "), path: dir, files, complete: files.every((file) => file.exists) };
  });
}

export function registerSpecHandlers(_ctx: AppContext): void {
  ipcMain.handle("spec:list", (_event, args: { workspace: string }) => ({ ok: true, specs: listSpecs(safeWorkspace(args?.workspace)) }));
  ipcMain.handle("spec:create", (_event, args: { workspace: string; title: string; description?: string }) => {
    const workspace = safeWorkspace(args?.workspace);
    const title = args?.title?.trim();
    const slug = title ? slugify(title) : "";
    if (!title || !slug) return { ok: false, error: "título obrigatório" };
    const existing = listSpecs(workspace);
    const next = Math.max(0, ...existing.map((item) => Number(item.id.slice(0, 3)) || 0)) + 1;
    const id = `${String(next).padStart(3, "0")}-${slug}`;
    const dir = path.join(workspace, "specs", id);
    fs.mkdirSync(dir, { recursive: false });
    const description = args.description?.trim() || "Descreva o problema, os usuários afetados e o resultado esperado.";
    fs.writeFileSync(path.join(dir, "spec.md"), `# Feature: ${title}\n\n## Problema\n\n${description}\n\n## Cenários de usuário\n\n- Dado ..., quando ..., então ...\n\n## Requisitos\n\n- [ ] FR-001: ...\n\n## Critérios de sucesso\n\n- SC-001: ...\n`, "utf8");
    fs.writeFileSync(path.join(dir, "plan.md"), `# Plano: ${title}\n\n## Contexto técnico\n\n- Stack: detectar no workspace\n- Restrições: ...\n\n## Arquitetura\n\nDescreva componentes, dados e integrações.\n\n## Verificação\n\n- Testes: ...\n- Rollback: ...\n`, "utf8");
    fs.writeFileSync(path.join(dir, "tasks.md"), `# Tarefas: ${title}\n\n## Fundação\n\n- [ ] T001 Validar requisitos e contratos\n\n## Implementação\n\n- [ ] T002 Implementar o menor corte vertical\n\n## Validação\n\n- [ ] T003 Executar testes e revisar critérios de sucesso\n`, "utf8");
    return { ok: true, spec: listSpecs(workspace).find((item) => item.id === id) };
  });
  ipcMain.handle("spec:open", async (_event, args: { workspace: string; id: string; file?: string }) => {
    const workspace = safeWorkspace(args?.workspace);
    if (!/^\d{3}-[a-z0-9-]+$/.test(args?.id || "")) return { ok: false, error: "spec inválida" };
    const file = args?.file && ["spec.md", "plan.md", "tasks.md"].includes(args.file) ? args.file : "spec.md";
    const target = path.join(workspace, "specs", args.id, file);
    if (!fs.existsSync(target)) return { ok: false, error: "arquivo não encontrado" };
    const error = await shell.openPath(target);
    return error ? { ok: false, error } : { ok: true };
  });
}
