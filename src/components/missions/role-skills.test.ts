// @vitest-environment node
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
// Este teste Node fica no escopo de missões. A importação em runtime evita
// incluir o processo main no projeto TypeScript do renderer.
const servicePath = "../../../electron/main/services/role-skills";
const { bundledRoleSkillNames, bundledRoleSkillsDir, installRoleSkillsInto, userRoleSkillDirs, roleSkillsDirForApp } = await import(servicePath);

const temporaryDirs: string[] = [];
afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) {
    if (path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith("codebrain-role-test-")) throw new Error("Unexpected test cleanup target");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("skills de papel distribuídas", () => {
  it("resolve tanto extraResources do builder quanto recursos dentro do app do packager", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codebrain-role-test-"));
    temporaryDirs.push(root);
    const appPath = path.join(root, "app.asar");
    const resourcesPath = path.join(root, "resources");
    const inApp = path.join(appPath, "resources", "role-skills");
    fs.mkdirSync(inApp, { recursive: true });
    expect(roleSkillsDirForApp(appPath, resourcesPath)).toBe(inApp);
    const external = path.join(resourcesPath, "role-skills");
    fs.mkdirSync(external, { recursive: true });
    expect(roleSkillsDirForApp(appPath, resourcesPath)).toBe(external);
    expect(roleSkillsDirForApp(appPath)).toBe(inApp);
  });

  it("o recurso de desenvolvimento corresponde ao diretório empacotado pelo builder", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    expect(packageJson.build.extraResources).toContainEqual({ from: "resources/role-skills", to: "role-skills", filter: ["**/*"] });
    expect(bundledRoleSkillsDir()).toBe(path.join(process.cwd(), "resources", "role-skills"));
    expect(bundledRoleSkillNames()).toEqual([
      "cb-copywriting", "cb-design-dna", "cb-evidence", "cb-findings", "cb-image-assets", "cb-pilot", "cb-reviewer", "cb-root-cause", "cb-safe-deploy", "cb-showcase", "cb-site-premium", "cb-ssh-operations", "cb-worker",
    ]);
  });

  it("instala nas contas de modo idempotente e preserva outros arquivos", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codebrain-role-test-"));
    temporaryDirs.push(root);
    const targets = [path.join(root, "account-one", "skills"), path.join(root, "account-two", "skills")];
    fs.mkdirSync(path.join(targets[0], "custom"), { recursive: true });
    fs.writeFileSync(path.join(targets[0], "custom", "SKILL.md"), "User content");
    expect(await installRoleSkillsInto(bundledRoleSkillsDir(), targets)).toBeGreaterThan(12);
    expect(await installRoleSkillsInto(bundledRoleSkillsDir(), targets)).toBe(0);
    for (const target of targets) {
      for (const relative of ["cb-safe-deploy/SKILL.md", "cb-safe-deploy/skill.json", "cb-safe-deploy/references/laravel.md", "cb-ssh-operations/references/workspace-context.md"]) {
        expect(fs.readFileSync(path.join(target, relative), "utf8"))
          .toBe(fs.readFileSync(path.join(bundledRoleSkillsDir(), relative), "utf8"));
      }
      expect(JSON.parse(fs.readFileSync(path.join(target, "cb-ssh-operations", "skill.json"), "utf8")))
        .toMatchObject({ id: "cb-ssh-operations", type: "prompt", entrypoint: "SKILL.md" });
      expect(fs.readFileSync(path.join(target, "cb-ssh-operations", "references", "connection.md"), "utf8"))
        .toBe(fs.readFileSync(path.join(bundledRoleSkillsDir(), "cb-ssh-operations", "references", "connection.md"), "utf8"));
      expect(JSON.parse(fs.readFileSync(path.join(target, "cb-worker", "skill.json"), "utf8"))).toMatchObject({ id: "cb-worker", entrypoint: "SKILL.md" });
      expect(fs.readFileSync(path.join(target, "cb-pilot", "SKILL.md"), "utf8"))
        .toBe(fs.readFileSync(path.join(bundledRoleSkillsDir(), "cb-pilot", "SKILL.md"), "utf8"));
    }
    expect(fs.readFileSync(path.join(targets[0], "custom", "SKILL.md"), "utf8")).toBe("User content");
  });

  it("usa caminhos do registro, incluindo Kiro, Hermes e XDG", () => {
    const dirs = userRoleSkillDirs({ HERMES_HOME: "D:/accounts/hermes", XDG_CONFIG_HOME: "D:/config" }, "D:/user", "win32");
    expect(dirs).toContain("D:\\user\\.kiro\\skills");
    expect(dirs).toContain("D:\\accounts\\hermes\\skills");
    expect(dirs).toContain("D:\\config\\muse\\skills");
    expect(dirs.some(dir => dir.includes("$") || dir.includes("~"))).toBe(false);
    const unix = userRoleSkillDirs({}, "/users/test", "linux");
    expect(unix).toContain("/users/test/.hermes/skills");
    expect(unix).toContain("/users/test/.config/muse/skills");
  });

  it("o empacotador portátil preserva scripts e referências dentro das skills", async () => {
    const source = fs.readFileSync(path.join(process.cwd(), "scripts/build-exe.mjs"), "utf8");
    const ignore = [...source.matchAll(/"--ignore=[^"]*"/g)].map(match => JSON.parse(match[0]).slice("--ignore=".length));
    const moduleUrl = pathToFileURL(path.join(process.cwd(), "node_modules/@electron/packager/dist/copy-filter.js")).href;
    const { userPathFilter } = await import(moduleUrl);
    const filter = userPathFilter({ dir: process.cwd(), ignore, prune: false, junk: false, out: path.join(os.tmpdir(), "unused-codebrain-package-output") });
    expect(await filter(path.join(process.cwd(), "scripts/build-exe.mjs"))).toBe(false);
    expect(await filter(path.join(process.cwd(), "resources/role-skills/cb-design-dna/scripts/lint-artifact.mjs"))).toBe(true);
    expect(await filter(path.join(process.cwd(), "resources/role-skills/cb-design-dna/rules/contract.json"))).toBe(true);
  });

  it("distribui cada arquivo do pacote de design sem achatar recursos ou depender do marketplace", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codebrain-role-test-"));
    temporaryDirs.push(root);
    const targets = [".codebrain", ".codex", ".claude", ".kiro"].map(cli => path.join(root, cli, "skills"));
    await installRoleSkillsInto(bundledRoleSkillsDir(), targets);
    const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const file = path.join(dir, entry.name);
      return entry.isDirectory() ? files(file) : [file];
    });
    for (const name of ["cb-site-premium", "cb-showcase", "cb-design-dna", "cb-copywriting", "cb-image-assets"]) {
      const bundled = path.join(bundledRoleSkillsDir(), name);
      expect(fs.existsSync(path.join(bundled, "skill.json"))).toBe(true);
      for (const file of files(bundled)) {
        const relative = path.relative(bundled, file);
        for (const target of targets) expect(fs.readFileSync(path.join(target, name, relative)).equals(fs.readFileSync(file))).toBe(true);
      }
    }
    expect(await installRoleSkillsInto(bundledRoleSkillsDir(), targets)).toBe(0);
  });
});
