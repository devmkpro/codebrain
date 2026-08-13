import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderSpecDocuments, writeSpecDocuments } from "./spec-kit";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("Spec Kit", () => {
  it("cria toda a árvore specs quando ela ainda não existe", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codebrain-spec-kit-"));
    temporaryDirectories.push(workspace);
    const directory = path.join(workspace, "specs", "001-checkout-sem-cadastro");
    const documents = renderSpecDocuments({
      title: "Checkout sem cadastro",
      problem: "Compradores abandonam a compra ao criar uma conta.",
      users: "Novos compradores",
      outcome: "A compra pode ser concluída como visitante.",
      acceptanceCriteria: "Visitante conclui a compra\nPedido registra o e-mail informado",
      constraints: "Manter checkout atual para usuários autenticados",
      nonGoals: "Criar programa de fidelidade",
    }, workspace);

    writeSpecDocuments(directory, documents);

    expect(fs.existsSync(path.join(directory, "spec.md"))).toBe(true);
    expect(fs.existsSync(path.join(directory, "plan.md"))).toBe(true);
    expect(fs.existsSync(path.join(directory, "tasks.md"))).toBe(true);
    expect(fs.readFileSync(path.join(directory, "spec.md"), "utf8")).toContain("FR-002");
  });
});
