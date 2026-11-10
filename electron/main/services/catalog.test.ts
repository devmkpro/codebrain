// @vitest-environment node

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  copySkillTo,
  getAgentInstructions,
  installedSkillNames,
  listAgents,
  parseFrontmatter,
  resolveSkillWhitelist,
  scanCatalog,
  setCatalogMeta,
} from "./catalog";
import { installRoleSkillsInto } from "./role-skills";

describe("parseFrontmatter", () => {
  it("lê chaves simples e separa o corpo", () => {
    const { data, body } = parseFrontmatter(
      "---\nname: foo\ndescription: uma coisa\n---\n\nCorpo\n"
    );
    expect(data).toEqual({ name: "foo", description: "uma coisa" });
    expect(body).toBe("Corpo\n");
  });

  it("remove aspas e aceita CRLF e BOM", () => {
    const { data } = parseFrontmatter(
      "﻿---\r\nname: \"foo\"\r\ndescription: 'bar: baz'\r\n---\r\n"
    );
    expect(data).toEqual({ name: "foo", description: "bar: baz" });
  });

  it("junta bloco dobrado e linhas de continuação", () => {
    const { data } = parseFrontmatter(
      "---\nname: a\ndescription: >-\n  primeira\n  segunda\nother: x\n  y\n---\n"
    );
    expect(data.description).toBe("primeira segunda");
    expect(data.other).toBe("x y");
  });

  it("sem frontmatter devolve o texto como corpo", () => {
    expect(parseFrontmatter("# Título")).toEqual({ data: {}, body: "# Título" });
  });
});

describe("catálogo em disco", () => {
  let home: string;
  let workspace: string;
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };

  const writeSkill = (root: string, folder: string, name: string, description = "desc") => {
    fs.mkdirSync(path.join(root, folder), { recursive: true });
    fs.writeFileSync(
      path.join(root, folder, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${description}\n---\n\ncorpo\n`
    );
  };

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "cb-catalog-"));
    workspace = path.join(home, "projeto");
    fs.mkdirSync(workspace);
    process.env.HOME = home;
    process.env.USERPROFILE = home;
  });

  afterEach(() => {
    process.env.HOME = saved.HOME;
    process.env.USERPROFILE = saved.USERPROFILE;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("junta a mesma skill de vários lugares", () => {
    writeSkill(path.join(home, ".claude", "skills"), "a", "alfa");
    writeSkill(path.join(home, ".codex", "skills"), "a", "alfa");
    const item = scanCatalog(workspace).find((candidate) => candidate.name === "alfa");
    expect(item?.installedIn.map((install) => install.cli).sort()).toEqual(["claude", "codex"]);
  });

  it("lê o formato skill.json do workspace", () => {
    const dir = path.join(workspace, ".codebrain", "skills", "x");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "skill.json"),
      JSON.stringify({ id: "minha", description: "d" })
    );
    expect(
      scanCatalog(workspace).find((candidate) => candidate.name === "minha")?.installedIn[0].cli
    ).toBe("codebrain");
  });

  it("aceita diretórios extras de outras CLIs", () => {
    const extra = path.join(home, ".kimi", "skills");
    writeSkill(extra, "k", "kapa");
    const item = scanCatalog(workspace, [{ cli: "kimi", dir: extra }]).find(
      (candidate) => candidate.name === "kapa"
    );
    expect(item?.installedIn[0]).toMatchObject({ cli: "kimi" });
  });

  it("descobre skills declaradas no registro sem fontes extras", () => {
    writeSkill(path.join(home, ".gemini", "skills"), "g", "gemini-skill");
    writeSkill(path.join(workspace, ".kiro", "skills"), "k", "kiro-skill");
    const items = scanCatalog(workspace);
    expect(items.find((item) => item.name === "gemini-skill")?.installedIn[0].cli).toBe("gemini");
    expect(items.find((item) => item.name === "kiro-skill")?.installedIn[0].cli).toBe("kiro");
  });

  it("metadados persistidos inválidos não quebram a whitelist", () => {
    fs.mkdirSync(path.join(home, ".codebrain"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".codebrain", "catalog-meta.json"),
      JSON.stringify({ agentSkills: { rev: "invalid" } })
    );
    expect(resolveSkillWhitelist(["a"], "rev")).toEqual(["a"]);
    expect(resolveSkillWhitelist(["a"], "__proto__")).toEqual(["a"]);
    expect(() =>
      setCatalogMeta({ kind: "agent", name: "rev", allowedSkills: "x" as any })
    ).toThrow();
  });

  it("marca as skills que acompanham o app", () => {
    expect(
      scanCatalog(workspace).find((candidate) => candidate.name === "cb-worker")?.builtin
    ).toBe(true);
  });

  it("lista agente com instruções sem o frontmatter, e o do workspace vence", () => {
    const write = (root: string, body: string) => {
      fs.mkdirSync(path.join(root, ".claude", "agents"), { recursive: true });
      fs.writeFileSync(
        path.join(root, ".claude", "agents", "rev.md"),
        `---\nname: rev\ndescription: d\n---\n\n${body}`
      );
    };
    write(home, "global");
    write(workspace, "local");
    expect(listAgents(workspace)).toEqual([{ name: "rev", description: "d" }]);
    expect(getAgentInstructions("rev", workspace)).toBe("local");
  });

  it("agente desligado não aparece para o decisor", () => {
    fs.mkdirSync(path.join(home, ".claude", "agents"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "agents", "rev.md"), "---\nname: rev\n---\n\nx");
    setCatalogMeta({ kind: "agent", name: "rev", disabled: true });
    expect(listAgents()).toEqual([]);
    expect(getAgentInstructions("rev")).toBeNull();
  });

  it("a whitelist do agente substitui a da tarefa", () => {
    setCatalogMeta({ kind: "agent", name: "rev", allowedSkills: ["x"] });
    expect(resolveSkillWhitelist(["a", "b"], "rev")).toEqual(["x"]);
    expect(resolveSkillWhitelist(["a", "b"], "outro")).toEqual(["a", "b"]);
  });

  it("skill desligada sai de qualquer whitelist", () => {
    setCatalogMeta({ kind: "skill", name: "a", disabled: true });
    setCatalogMeta({ kind: "agent", name: "rev", allowedSkills: ["a", "x"] });
    expect(resolveSkillWhitelist(["a", "b"])).toEqual(["b"]);
    expect(resolveSkillWhitelist([], "rev")).toEqual(["x"]);
  });

  it("allowedSkills nulo volta a usar a da tarefa", () => {
    setCatalogMeta({ kind: "agent", name: "rev", allowedSkills: ["x"] });
    setCatalogMeta({ kind: "agent", name: "rev", allowedSkills: null });
    expect(resolveSkillWhitelist(["a"], "rev")).toEqual(["a"]);
  });

  it("copia sem sobrescrever a versão que já existe", () => {
    writeSkill(path.join(home, ".claude", "skills"), "a", "alfa");
    fs.mkdirSync(path.join(home, ".codex", "skills"), { recursive: true });
    const first = copySkillTo("alfa", "codex");
    expect(first.copied).toEqual([path.join(home, ".codex", "skills", "a")]);
    expect(fs.existsSync(path.join(home, ".codex", "skills", "a", "SKILL.md"))).toBe(true);
    expect(copySkillTo("alfa", "codex").copied).toEqual([]);
  });

  it("gera SKILL.md ao copiar o formato skill.json", () => {
    const dir = path.join(workspace, ".codebrain", "skills", "x");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "skill.json"),
      JSON.stringify({ id: "minha", description: "d" })
    );
    fs.writeFileSync(path.join(dir, "prompt.md"), "instrução");
    copySkillTo("minha", "claude", workspace);
    const text = fs.readFileSync(path.join(home, ".claude", "skills", "x", "SKILL.md"), "utf-8");
    expect(parseFrontmatter(text)).toMatchObject({
      data: { name: "minha", description: "d" },
      body: "instrução",
    });
  });

  it("installedSkillNames junta a conta e o workspace", () => {
    writeSkill(path.join(home, ".claude", "skills"), "a", "alfa");
    writeSkill(path.join(workspace, ".claude", "skills"), "b", "beta");
    expect(installedSkillNames(path.join(home, ".claude"), workspace).sort()).toEqual([
      "alfa",
      "beta",
    ]);
  });

  it("instalar skills de papel é idempotente e não toca no que não é nosso", async () => {
    const source = path.join(home, "fonte");
    writeSkill(source, "cb-x", "cb-x");
    const target = path.join(home, "alvo");
    writeSkill(target, "do-usuario", "do-usuario");
    // SKILL.md e o manifest nativo skill.json gerado pelo instalador.
    expect(await installRoleSkillsInto(source, [target])).toBe(2);
    expect(await installRoleSkillsInto(source, [target])).toBe(0);
    fs.writeFileSync(path.join(target, "cb-x", "SKILL.md"), "antigo");
    fs.writeFileSync(path.join(target, "cb-x", "nota.txt"), "minha");
    expect(await installRoleSkillsInto(source, [target])).toBe(1);
    expect(fs.existsSync(path.join(target, "cb-x", "nota.txt"))).toBe(true);
    expect(fs.existsSync(path.join(target, "do-usuario", "SKILL.md"))).toBe(true);
  });
});
