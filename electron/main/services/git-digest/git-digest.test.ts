import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GitDigestProject } from "../../../../src/types/git-digest";
import { buildMap, buildSummaryPayload, fallbackThemes, normalizeConfig, parseSummary, validateDigestDate } from "./digest-core";
import { createGitLabClient, normalizeGitLabUrl } from "./gitlab-client";
import { createGitDigestService } from "./git-digest-service";
import { createTokenStore, type TokenSafeStorage } from "./token-store";

const fakeSafeStorage = (available = true): TokenSafeStorage => ({
  isEncryptionAvailable: () => available,
  encryptString: (value) => Buffer.from(`enc:${Buffer.from(value).toString("base64")}`),
  decryptString: (value) => Buffer.from(value.toString().slice(4), "base64").toString(),
});

const project = (): GitDigestProject => ({
  key: "c1:7",
  connectionId: "c1",
  connectionLabel: "GL",
  path: "grupo/app",
  name: "app",
  webUrl: "",
  commits: [
    { sha: "a".repeat(40), shortSha: "aaaaaaaa", title: "feat: login", message: "feat: login", authorName: "Ana", committedAt: "2026-11-17T12:00:00Z", webUrl: "", refs: ["main"], additions: 10, deletions: 2,
      files: [{ path: "src/auth/login.ts", status: "modified", additions: 8, deletions: 2 }, { path: "src/auth/shared.ts", status: "added", additions: 2, deletions: 0 }] },
    { sha: "b".repeat(40), shortSha: "bbbbbbbb", title: "fix: shared", message: "fix: shared", authorName: "Bruno", committedAt: "2026-11-17T13:00:00Z", webUrl: "", refs: ["main"], additions: 1, deletions: 1,
      files: [{ path: "src/auth/shared.ts", status: "modified", additions: 1, deletions: 1 }] },
  ],
});

describe("normalizeGitLabUrl", () => {
  it("aceita gitlab.com, subcaminho self-hosted e remove /api/v4", () => {
    expect(normalizeGitLabUrl("https://gitlab.com/")).toBe("https://gitlab.com");
    expect(normalizeGitLabUrl("https://git.empresa.com.br/gitlab/api/v4")).toBe("https://git.empresa.com.br/gitlab");
  });
  it("recusa HTTP público, credenciais na URL e query", () => {
    expect(() => normalizeGitLabUrl("http://gitlab.com")).toThrow(/HTTPS/);
    expect(() => normalizeGitLabUrl("https://user:pass@gitlab.com")).toThrow(/token/);
    expect(() => normalizeGitLabUrl("https://gitlab.com?x=1")).toThrow(/query/);
  });
  it("aceita HTTP em rede interna", () => {
    expect(normalizeGitLabUrl("http://192.168.0.10:8080")).toBe("http://192.168.0.10:8080");
    expect(normalizeGitLabUrl("http://gitlab.lan")).toBe("http://gitlab.lan");
  });
});

describe("cliente GitLab", () => {
  it("envia PRIVATE-TOKEN sem seguir redirecionamentos", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const client = createGitLabClient("https://gitlab.example.com", "glpat-fixture-0001", async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 1, username: "dev", name: "Dev", email: "Dev@x.io" }), { status: 200 });
    });
    expect(await client.currentUser()).toEqual({ id: 1, username: "dev", name: "Dev", emails: ["dev@x.io"] });
    expect(calls[0].url).toBe("https://gitlab.example.com/api/v4/user");
    expect(calls[0].init?.redirect).toBe("manual");
    expect((calls[0].init?.headers as Record<string, string>)["PRIVATE-TOKEN"]).toBe("glpat-fixture-0001");
  });
  it("trata redirect como erro para não vazar o token", async () => {
    const client = createGitLabClient("https://gitlab.example.com", "glpat-fixture-0001", async () => new Response(null, { status: 302 }));
    await expect(client.currentUser()).rejects.toThrow(/redirecionou/);
  });
});

describe("mapa neural", () => {
  it("agrupa por pasta sem modelo e liga arquivos compartilhados por sinapse", () => {
    const themes = fallbackThemes([project()]);
    expect(themes.map((theme) => theme.title)).toEqual(["src/auth"]);
    const twoThemes = [
      { ...themes[0], id: "x#1", files: ["src/auth/login.ts", "src/auth/shared.ts"] },
      { ...themes[0], id: "x#2", files: ["src/auth/shared.ts"] },
    ];
    const map = buildMap("2026-11-17", [project()], twoThemes);
    expect(map.nodes.filter((node) => node.kind === "file")).toHaveLength(2);
    expect(map.edges.filter((edge) => edge.kind === "synapse")).toEqual([{ from: "t:x#2", to: "f:c1:7::src/auth/shared.ts", kind: "synapse" }]);
  });

  it("descarta commits, arquivos e projetos que o modelo inventou", () => {
    const response = JSON.stringify({
      headline: "Login novo",
      summary: "Fluxo de login.",
      themes: [
        { projeto: "c1:7", titulo: "Login", detalhe: "x", commits: ["aaaaaaaa", "deadbeef"], arquivos: ["src/auth/login.ts", "inventado.ts"] },
        { projeto: "outro:1", titulo: "Fake", commits: [], arquivos: [] },
      ],
    });
    const parsed = parseSummary("```json\n" + response + "\n```", [project()]);
    expect(parsed.headline).toBe("Login novo");
    expect(parsed.themes).toHaveLength(1);
    expect(parsed.themes[0].commits).toEqual(["aaaaaaaa"]);
    expect(parsed.themes[0].files).toEqual(["src/auth/login.ts"]);
  });

  it("encaixa o payload no orçamento cortando diffs primeiro", () => {
    const snippets = new Map([[`c1:7::${"a".repeat(40)}::src/auth/login.ts`, "+".repeat(5000)]]);
    expect(buildSummaryPayload("2026-11-17", [project()], snippets, 100_000)).toContain("diff");
    const tight = buildSummaryPayload("2026-11-17", [project()], snippets, 1_000);
    expect(tight).not.toContain("diff");
    expect(tight.length).toBeLessThanOrEqual(1_000);
  });
});

describe("config e datas", () => {
  it("normaliza valores inválidos para os padrões", () => {
    const config = normalizeConfig({ schedule: { time: "25:99", catchUpDays: 99 }, connections: [{ id: "x", baseUrl: "" }] });
    expect(config.schedule).toEqual({ enabled: true, time: "18:00", catchUpDays: 3 });
    expect(config.connections).toEqual([]);
    expect(config.includeDiffs).toBe(false);
  });
  it("recusa data futura e formato errado", () => {
    const now = new Date(2026, 10, 17, 12);
    expect(validateDigestDate("2026-11-17", now)).toBe("2026-11-17");
    expect(() => validateDigestDate("2026-11-18", now)).toThrow();
    expect(() => validateDigestDate("17/11/2026", now)).toThrow();
  });
});

describe("token store e serviço", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "cb-git-digest-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("não grava token sem criptografia do sistema", () => {
    const store = createTokenStore(path.join(dir, "t.json"), fakeSafeStorage(false));
    expect(() => store.set("c1", "glpat-fixture-0001")).toThrow();
  });

  it("recusa chaveiro basic_text no Linux", () => {
    const store = createTokenStore(path.join(dir, "t.json"), { ...fakeSafeStorage(), getSelectedStorageBackend: () => "basic_text" }, "linux");
    expect(store.status().available).toBe(false);
  });

  it("verifica o token, salva cifrado e nunca devolve o segredo na config", async () => {
    const tokens = createTokenStore(path.join(dir, "t.json"), fakeSafeStorage());
    const service = createGitDigestService({
      dir,
      tokens,
      summarize: async () => "{}",
      fetchFn: async () => new Response(JSON.stringify({ id: 9, username: "maike", name: "Maike" }), { status: 200 }),
    });
    const config = await service.upsertConnection({ label: "Self", baseUrl: "https://git.example.com/", token: "glpat-fixture-0001" });
    expect(config.connections[0]).toMatchObject({ baseUrl: "https://git.example.com", username: "maike", hasToken: true });
    expect(JSON.stringify(config)).not.toContain("glpat-fixture-0001");
    expect(await fs.readFile(path.join(dir, "t.json"), "utf8")).not.toContain("glpat-fixture-0001");
    expect(await fs.readFile(path.join(dir, "config.json"), "utf8")).not.toContain("glpat-fixture-0001");
    expect(tokens.get(config.connections[0].id)).toBe("glpat-fixture-0001");
    expect(service.removeConnection(config.connections[0].id).connections).toEqual([]);
    expect(tokens.has(config.connections[0].id)).toBe(false);
  });

  const gitlabFixture = (at: string) => ({
    "/user": { id: 9, username: "maike", name: "Maike", email: "maike@x.io" },
    "/events": [{ project_id: 7, created_at: at, push_data: { ref: "main", ref_type: "branch", action: "pushed" } }],
    "/projects": [{ id: 7, path_with_namespace: "grupo/app", name: "app", web_url: "https://git.example.com/grupo/app" }],
    "/projects/7": { path_with_namespace: "grupo/app", name: "app", web_url: "https://git.example.com/grupo/app" },
    "/projects/7/repository/commits": [
      { id: "a".repeat(40), short_id: "aaaaaaaa", title: "feat: mapa", message: "feat: mapa", author_name: "Maike", author_email: "maike@x.io", committed_date: at, parent_ids: ["p"], stats: { additions: 3, deletions: 1 } },
      { id: "c".repeat(40), short_id: "cccccccc", title: "commit de outra pessoa", author_name: "Outra", author_email: "outra@x.io", committed_date: at, parent_ids: ["p"] },
      { id: "d".repeat(40), short_id: "dddddddd", title: "Merge branch 'x' into 'main'", author_name: "Outra", author_email: "outra@x.io", committed_date: at, parent_ids: ["p", "q"], stats: { additions: 99, deletions: 9 } },
    ] as unknown,
    [`/projects/7/repository/commits/${"a".repeat(40)}/diff`]: [{ new_path: "src/map.ts", diff: "+a\n+b\n-c" }],
  } as Record<string, unknown>);

  const fixtureService = (routes: Record<string, unknown>, onSummarize: (args: { providerId: string; model: string; input: string }) => void) => {
    const urls: string[] = [];
    const service = createGitDigestService({
      dir,
      tokens: createTokenStore(path.join(dir, "t.json"), fakeSafeStorage()),
      now: () => new Date(2026, 10, 17, 9),
      summarize: async (args) => {
        onSummarize(args);
        return JSON.stringify({ headline: "Mapa neural", summary: "A Maike fez o mapa.", themes: [{ projeto: "inexistente", titulo: "X", commits: [] }] });
      },
      fetchFn: async (url) => {
        urls.push(url);
        const body = routes[new URL(url).pathname.replace("/api/v4", "")];
        return body === undefined ? new Response("[]", { status: 404 }) : new Response(JSON.stringify(body), { status: 200 });
      },
    });
    return { service, urls };
  };

  it("git inteiro: todos os autores e branches, sem merges, com resumo do modelo escolhido", async () => {
    const day = "2026-11-16";
    let used: { providerId: string; model: string; input: string } | null = null;
    const { service, urls } = fixtureService(gitlabFixture(new Date(2026, 10, 16, 15).toISOString()), (args) => (used = args));
    await service.upsertConnection({ label: "Self", baseUrl: "https://git.example.com", token: "glpat-fixture-0001" });
    service.saveSettings({ summarizer: { providerId: "openai", model: "gpt-x" } });
    const digest = await service.generate(day);
    expect(used).toMatchObject({ providerId: "openai", model: "gpt-x" });
    expect(used!.input).toContain("commit de outra pessoa");
    expect(used!.input).toContain("\"autor\":\"Outra\"");
    expect(used!.input).not.toContain("Merge branch");
    expect(urls.some((url) => url.includes("/repository/commits?all=true"))).toBe(true);
    expect(urls.some((url) => url.includes("/events"))).toBe(false);
    expect(digest.stats).toMatchObject({ commits: 2, authors: 2, merges: 1, additions: 3 });
    expect(digest.projects[0].commits[0].files).toEqual([{ path: "src/map.ts", status: "modified", additions: 2, deletions: 1 }]);
    expect(digest.summary).toMatchObject({ headline: "Mapa neural", text: "A Maike fez o mapa." });
    expect(digest.map.nodes.some((node) => node.kind === "file" && node.detail === "src/map.ts")).toBe(true);
    expect(service.list()).toEqual([{ date: day, generatedAt: digest.generatedAt, commits: 2, projects: 1, headline: "Mapa neural" }]);
  });

  it("só os meus: filtra pelo e-mail do dono do token", async () => {
    let used: { input: string } | null = null;
    const { service } = fixtureService(gitlabFixture(new Date(2026, 10, 16, 15).toISOString()), (args) => (used = args));
    await service.upsertConnection({ baseUrl: "https://git.example.com", token: "glpat-fixture-0001", scope: "mine" });
    service.saveSettings({ summarizer: { providerId: "openai", model: "gpt-x" } });
    const digest = await service.generate("2026-11-16");
    expect(digest.stats.commits).toBe(1);
    expect(used!.input).not.toContain("commit de outra pessoa");
  });

  it("sem modelo, monta um texto corrido por projeto e pessoa", async () => {
    const { service } = fixtureService(gitlabFixture(new Date(2026, 10, 16, 15).toISOString()), () => undefined);
    await service.upsertConnection({ baseUrl: "https://git.example.com", token: "glpat-fixture-0001" });
    const digest = await service.generate("2026-11-16");
    expect(digest.summary.text).toBe("Em grupo/app, Maike (1) e Outra (1) fizeram 2 commit(s): mapa; commit de outra pessoa.");
    expect(digest.summary.error).toMatch(/Sem harness/);
  });

  it("não grava diário quando todas as conexões falham", async () => {
    const tokens = createTokenStore(path.join(dir, "t.json"), fakeSafeStorage());
    let fail = false;
    const service = createGitDigestService({
      dir,
      tokens,
      now: () => new Date(2026, 10, 17, 9),
      summarize: async () => "{}",
      fetchFn: async () => (fail ? new Response("", { status: 401 }) : new Response(JSON.stringify({ id: 1, username: "u", name: "U" }), { status: 200 })),
    });
    await service.upsertConnection({ baseUrl: "https://git.example.com", token: "glpat-fixture-0001" });
    fail = true;
    await expect(service.generate("2026-11-16")).rejects.toThrow(/Token recusado/);
    expect(service.list()).toEqual([]);
    expect(service.status().lastError).toMatch(/Token recusado/);
  });
});
