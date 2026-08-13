import { ipcMain, shell } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AppContext } from "../context";
import { renderSpecDocuments, writeSpecDocuments, type SpecAnswers } from "../services/spec-kit";

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
  ipcMain.handle("spec:create", (_event, args: { workspace: string; answers: SpecAnswers }) => {
    const workspace = safeWorkspace(args?.workspace);
    const answers = args?.answers;
    const title = answers?.title?.trim();
    const slug = title ? slugify(title) : "";
    if (!title || !slug || !answers?.problem?.trim() || !answers?.users?.trim() || !answers?.outcome?.trim() || !answers?.acceptanceCriteria?.trim()) return { ok: false, error: "responda todas as perguntas obrigatórias" };
    const existing = listSpecs(workspace);
    const next = Math.max(0, ...existing.map((item) => Number(item.id.slice(0, 3)) || 0)) + 1;
    const id = `${String(next).padStart(3, "0")}-${slug}`;
    const dir = path.join(workspace, "specs", id);
    const documents = renderSpecDocuments({ ...answers, title }, workspace);
    writeSpecDocuments(dir, documents);
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
