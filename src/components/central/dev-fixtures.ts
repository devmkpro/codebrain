/* Dados de mentira para ver a Central no preview do renderer, sem Electron.
   Só é carregado por import dinâmico atrás de `import.meta.env.DEV` em api.ts,
   então não entra no build de produção.

   Cenários, pela URL antes do hash: ?cbfx=empty | error | unavailable | slow */

import { useMissionsStore } from "../../stores/missions-store";
import { useNavStore } from "../../stores/nav-store";
import { usePanesStore } from "../../stores/panes-store";
import { useProvidersStore } from "../../stores/providers-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import type {
  Account,
  CatalogItem,
  Finding,
  HarnessRow,
  HarnessTable,
  SpawnReceipt,
} from "./types";
import type { CliEntry } from "./cli-registry";

const WS = "D:/Projetos/loja-online";
const now = Date.now();
const secondsAgo = (minutes: number) => Math.floor((now - minutes * 60000) / 1000);

const row = (
  id: string,
  name: string,
  description: string,
  tier: HarnessRow["tier"],
  effort: HarnessRow["effort"],
  keywords: string[],
  extra: Partial<HarnessRow> = {}
): HarnessRow => ({
  id,
  name,
  description,
  tier,
  effort,
  keywords,
  examples: [],
  notExamples: [],
  cli: null,
  model: null,
  accountId: null,
  agentName: null,
  skills: ["cb-worker", "cb-evidence"],
  fallbacks: [],
  review: false,
  ...extra,
});

const table: HarnessTable = {
  version: 1,
  tierModels: {
    claude: {
      fast: "claude-haiku-4-5-20251001",
      balanced: "claude-sonnet-4-6",
      deep: "claude-opus-4-8",
    },
  },
  decider: {
    enabled: true,
    providerId: "openrouter",
    model: "google/gemini-flash-2",
    minConfidence: 0.6,
    timeoutMs: 4000,
  },
  rows: [
    row(
      "implementar",
      "Implementar",
      "Criar funcionalidade ou tela nova.",
      "balanced",
      "medium",
      ["implementar", "criar", "adicionar", "feature"],
      { cli: "claude" }
    ),
    row(
      "corrigir",
      "Corrigir bug",
      "Achar a causa e corrigir um defeito.",
      "balanced",
      "high",
      ["bug", "erro", "quebrou", "falha"],
      {
        cli: "claude",
        skills: ["cb-worker", "cb-root-cause", "cb-evidence"],
        examples: ["o botão de salvar parou de funcionar"],
        notExamples: ["explique por que o botão existe"],
        fallbacks: [{ cli: "codex", model: null }],
      }
    ),
    row(
      "pesquisar",
      "Pesquisar",
      "Responder uma pergunta sem editar nada.",
      "fast",
      "low",
      ["pesquisar", "investigar", "onde fica"],
      { cli: "kimi", skills: ["cb-worker"] }
    ),
    row(
      "revisar",
      "Revisar",
      "Tentar quebrar o trabalho de outro agente.",
      "deep",
      "high",
      ["revisar", "auditar", "validar"],
      {
        cli: "codex",
        model: "gpt-5.2",
        review: true,
        skills: ["cb-reviewer", "cb-findings"],
        accountId: "acc-codex-1",
      }
    ),
    row("interface", "Interface", "Construir ou ajustar telas.", "balanced", "high", [
      "tela",
      "layout",
      "css",
    ]),
    row(
      "documentar",
      "Documentar",
      "Escrever documentação e changelog.",
      "fast",
      "low",
      ["readme", "docs"],
      { cli: "cursor" }
    ),
    row("geral", "Geral", "Quando nenhum outro tipo combinar.", "balanced", "medium", []),
  ],
};

const registry: CliEntry[] = [
  {
    id: "claude",
    label: "Claude Code",
    found: true,
    version: "2.1",
    verified: true,
    capabilities: {
      model: true,
      effort: true,
      systemPrompt: true,
      mcp: true,
      resume: true,
      multiAccount: true,
      skills: true,
    },
    loginCommand: "claude login",
  },
  {
    id: "codex",
    label: "Codex",
    found: true,
    version: "0.42",
    verified: true,
    capabilities: {
      model: true,
      effort: true,
      systemPrompt: true,
      mcp: true,
      resume: true,
      multiAccount: true,
      skills: true,
    },
    loginCommand: "codex login",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    found: false,
    verified: true,
    capabilities: {
      model: true,
      effort: false,
      systemPrompt: true,
      mcp: true,
      resume: true,
      multiAccount: false,
      skills: true,
    },
    loginCommand: "gemini",
  },
  {
    id: "kimi",
    label: "Kimi",
    found: false,
    verified: false,
    capabilities: {
      model: false,
      effort: false,
      systemPrompt: true,
      mcp: true,
      resume: false,
      multiAccount: false,
      skills: false,
    },
    loginCommand: "kimi login",
  },
  {
    id: "cursor",
    label: "Cursor Agent",
    found: true,
    version: "1.0",
    verified: false,
    capabilities: {
      model: true,
      effort: false,
      systemPrompt: false,
      mcp: true,
      resume: true,
      multiAccount: false,
      skills: true,
    },
    loginCommand: "cursor-agent login",
  },
  // Exemplos de escolhas experimentais. O Electron usa sempre o registro real.
  ...[
    ["openclaude", "OpenClaude"],
    ["kiro", "Kiro"],
    ["copilot", "GitHub Copilot"],
    ["opencode", "OpenCode"],
    ["grok", "Grok"],
    ["antigravity", "Antigravity"],
    ["hermes", "Hermes"],
    ["muse", "Muse"],
    ["commandcode", "Command Code"],
  ].map(([id, label]) => ({ id, label, found: false, verified: false, capabilities: {} })),
];

const receipts: SpawnReceipt[] = [
  {
    id: "r3",
    pane_id: "pane-3",
    name: "Revisar login Google",
    task_name: "Revisar",
    source: "palavra-chave",
    agent: "codex",
    model: "gpt-5.2",
    effort: "high",
    account: "trabalho",
    skills: ["cb-reviewer", "cb-findings"],
    receipt:
      "▸ tipo Revisar (2 pistas no prompt)\n▸ codex · gpt-5.2 · esforço high\n▸ conta trabalho\n▸ revisão: pane novo, nunca o autor",
    reused: 0,
    created_at: secondsAgo(3),
  },
  {
    id: "r2",
    pane_id: "pane-2",
    name: "Tela de entrada",
    task_name: "Interface",
    source: "decisor",
    agent: "claude",
    model: "claude-sonnet-4-6",
    effort: "high",
    account: "pessoal",
    skills: ["cb-worker", "cb-evidence"],
    receipt:
      "▸ tipo Interface (decisor, 82%: pede botão novo na tela de login)\n▸ claude · claude-sonnet-4-6 · esforço high\n▸ avisos: gemini não encontrada; usando a reserva claude",
    reused: 1,
    created_at: secondsAgo(14),
    handoff_summary: "Botão Entrar com Google na tela de login, com estado de carregamento e erro.",
    handoff_status: "done",
    handoff_contract: "passed",
    handoff_at: secondsAgo(6),
    handoff_evidence: {
      checks: [
        {
          requirement: "botão aparece em /login",
          status: "pass",
          verify: "print em shots/login.png",
        },
      ],
      commands: [{ cmd: "npm test -- login", exitCode: 0 }],
      files: ["src/pages/Login.tsx", "src/pages/Login.test.tsx"],
    },
  },
  {
    id: "r1",
    pane_id: "pane-1",
    name: "Rota OAuth",
    task_name: "Implementar",
    source: "pedido",
    agent: "claude",
    model: "claude-opus-4-8",
    effort: "medium",
    account: "pessoal",
    skills: ["cb-worker"],
    receipt: "▸ tipo Implementar (indicado no pedido)\n▸ claude · claude-opus-4-8 · esforço medium",
    reused: 0,
    created_at: secondsAgo(20),
    handoff_summary: "Rota /auth/google criada, mas falta a chave no ambiente de homologação.",
    handoff_status: "blocked",
    handoff_at: secondsAgo(9),
  },
  {
    id: "r0",
    pane_id: "pane-0",
    name: "Mapear sessões atuais",
    task_name: "Pesquisar",
    source: "padrao",
    agent: "claude",
    model: null,
    effort: "low",
    account: null,
    skills: [],
    receipt: "▸ tipo Geral (padrão)\n▸ claude · modelo da conta · esforço low",
    reused: 0,
    created_at: secondsAgo(24),
    handoff_summary: "Sessões usam cookie assinado, sem expiração no servidor.",
    handoff_status: "done",
    handoff_at: secondsAgo(18),
  },
];

const findings: Finding[] = [
  {
    id: "F-001",
    severity: "high",
    status: "open",
    category: "security",
    title: "Token do Google gravado no log do servidor",
    location: "src/auth/google.ts:48",
    steps: "1. Entrar com Google\n2. Abrir logs/app.log",
    expected: "Nenhum token no log",
    observed: "Token completo na linha do callback",
    reporter: "pane-3",
    evidence: [
      {
        text: "logs/app.log:1204 contém access_token=ya29…",
        actor: "Revisar login Google",
        at: now - 2 * 60000,
      },
    ],
  },
  {
    id: "F-002",
    severity: "high",
    status: "fixed",
    category: "functional",
    title: "Sessão antiga cai ao trocar para o Google",
    location: "src/auth/session.ts:12",
    fixed_by: "pane-1",
    fix_note: "Migração preserva o cookie antigo por 30 dias; validado com sessão real.",
    fix_commit: "a1b2c3d",
    reporter: "pane-3",
    evidence: [
      { text: "Print shots/sessao-caiu.png", actor: "Revisar login Google", at: now - 12 * 60000 },
      { text: "Teste session.migrate.test.ts passando", actor: "Rota OAuth", at: now - 5 * 60000 },
    ],
  },
  {
    id: "F-003",
    severity: "medium",
    status: "needs_decision",
    category: "usability",
    title: "Conta sem e-mail verificado não tem caminho",
    location: "/login",
    reporter: "pane-3",
    evidence: [
      {
        text: "Fluxo testado com conta de teste; ficou sem mensagem.",
        actor: "Revisar login Google",
        at: now - 9 * 60000,
      },
    ],
  },
  {
    id: "F-004",
    severity: "low",
    status: "verified",
    category: "visual",
    title: "Botão desalinhado em tela estreita",
    location: "src/pages/Login.tsx:88",
    reporter: "pane-3",
    fixed_by: "pane-2",
    verified_by: "pane-3",
    evidence: [
      { text: "Print 360px antes e depois", actor: "Tela de entrada", at: now - 7 * 60000 },
    ],
  },
  {
    id: "F-005",
    severity: "medium",
    status: "reopened",
    category: "performance",
    title: "Callback demora 4s no primeiro acesso",
    location: "src/auth/google.ts:80",
    reporter: "Tela de entrada",
    evidence: [
      {
        text: "Trace em shots/callback.json mostra 4,1s",
        actor: "Tela de entrada",
        at: now - 4 * 60000,
      },
    ],
  },
];

const catalog: CatalogItem[] = [
  {
    kind: "skill",
    name: "cb-pilot",
    description: "Como quebrar um objetivo e delegar sem executar.",
    category: "codebrain",
    builtin: true,
    installedIn: [{ cli: "claude", path: "C:/Users/dev/.claude/skills/cb-pilot" }],
  },
  {
    kind: "skill",
    name: "cb-worker",
    description: "Regras de entrega de um ajudante.",
    category: "codebrain",
    builtin: true,
    installedIn: [
      { cli: "claude", path: "C:/Users/dev/.claude/skills/cb-worker" },
      { cli: "codex", path: "C:/Users/dev/.codex/skills/cb-worker" },
    ],
  },
  {
    kind: "skill",
    name: "cb-evidence",
    description: "O que conta como prova.",
    category: "codebrain",
    builtin: true,
    installedIn: [{ cli: "claude", path: "C:/Users/dev/.claude/skills/cb-evidence" }],
  },
  {
    kind: "skill",
    name: "cb-reviewer",
    description: "Tentar quebrar o trabalho de outro agente.",
    category: "codebrain",
    builtin: true,
    installedIn: [{ cli: "claude", path: "C:/Users/dev/.claude/skills/cb-reviewer" }],
  },
  {
    kind: "skill",
    name: "playwright",
    description: "Dirige o navegador para testar telas.",
    category: "testes",
    installedIn: [{ cli: "claude", path: "C:/Users/dev/.claude/skills/playwright" }],
  },
  {
    kind: "skill",
    name: "laravel-ci",
    description: "Pipeline de CI para projetos Laravel.",
    category: "devops",
    disabled: true,
    installedIn: [{ cli: "codex", path: "C:/Users/dev/.codex/skills/laravel-ci" }],
  },
  {
    kind: "agent",
    name: "revisor-seguranca",
    description: "Procura vazamento de dados e autorização fraca.",
    category: "qualidade",
    allowedSkills: ["cb-reviewer"],
    installedIn: [{ cli: "claude", path: "C:/Users/dev/.claude/agents/revisor-seguranca.md" }],
  },
  {
    kind: "agent",
    name: "cb-explorer",
    description: "Mapeia o código sem editar.",
    category: "codebrain",
    builtin: true,
    installedIn: [{ cli: "claude", path: "C:/Users/dev/.claude/agents/cb-explorer.md" }],
  },
];

const accounts: Account[] = [
  {
    id: "acc-claude-0",
    cli: "claude",
    label: "pessoal",
    configDir: "C:/Users/dev/.claude",
    isDefault: true,
    loggedIn: true,
    locked: false,
    windows: [
      { id: "5h", label: "janela de 5h", usedPct: 72, resetsAt: now + 95 * 60000, source: "api" },
      {
        id: "semana",
        label: "semana",
        usedPct: 34,
        resetsAt: now + 3 * 24 * 3600000,
        source: "api",
      },
    ],
  },
  {
    id: "acc-claude-1",
    cli: "claude",
    label: "cliente-acme",
    configDir: "C:/Users/dev/.codebrain/accounts/claude-cliente-acme",
    loggedIn: false,
    locked: false,
    windows: [],
  },
  {
    id: "acc-codex-1",
    cli: "codex",
    label: "trabalho",
    configDir: "C:/Users/dev/.codebrain/accounts/codex-trabalho",
    loggedIn: true,
    locked: true,
    windows: [
      { id: "5h", label: "janela de 5h", usedPct: 96, resetsAt: now + 25 * 60000, source: "cli" },
      { id: "dia", label: "hoje", tokens: 1240000, resetsAt: null, source: "transcrições" },
    ],
  },
];

const pixel = (color: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="${color}"/></svg>`)}`;

const media = [
  {
    name: "hero-login.png",
    path: `${WS}/.codebrain/media/hero-login.png`,
    kind: "image",
    createdAt: now - 3600000,
    url: pixel("#2c5fd0"),
  },
  {
    name: "icone-google.png",
    path: `${WS}/.codebrain/media/icone-google.png`,
    kind: "image",
    createdAt: now - 7200000,
    url: pixel("#1f7a4d"),
  },
  {
    name: "abertura.mp4",
    path: `${WS}/.codebrain/media/abertura.mp4`,
    kind: "video",
    createdAt: now - 86400000,
  },
];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function installFixtures(): void {
  const params = new URLSearchParams(window.location.search);
  const scenario = params.get("cbfx") ?? "full";
  if (scenario === "unavailable") return;

  const seed = scenario !== "empty" && !params.has("nows");
  if (!params.has("nows")) {
    useWorkspaceStore.setState({ path: WS });
    (useNavStore as unknown as { setState: (patch: unknown) => void }).setState({
      tabs: [{ workspacePath: WS, view: { kind: "workspace" } }],
      activeTabIndex: 0,
      onHome: true,
    });
  }
  (useProvidersStore as unknown as { setState: (patch: unknown) => void }).setState({
    providers: [
      {
        id: "claude-oauth",
        name: "Claude",
        host: "claude",
        type: "oauth",
        models: ["claude-opus-4-8", "claude-sonnet-4-6"],
      },
      { id: "codex-oauth", name: "Codex", host: "codex", type: "oauth", models: ["gpt-5.2"] },
    ],
    loaded: true,
  });
  if (!seed) {
    // O store persiste entre recargas do preview; cenário vazio precisa limpar.
    useMissionsStore.setState({ missionsByWorkspace: {}, activeMissionByWorkspace: {} });
  } else {
    const createdAt = now - 30 * 60000;
    useMissionsStore.setState({
      missionsByWorkspace: {
        [WS]: [
          {
            id: "fx-m1",
            title: "Login com Google",
            mode: "agentico",
            status: "running",
            objective:
              "Trocar o login por senha por entrada com Google, sem derrubar quem já está logado.",
            pilotPaneId: "pane-p",
            pilot: { agent: "claude", model: "claude-opus-4-8" },
            createdAt,
            updatedAt: createdAt,
          },
          {
            id: "fx-m2",
            title: "Missão 2",
            mode: "livre",
            status: "active",
            createdAt: createdAt - 86400000,
            updatedAt: createdAt,
          },
        ],
      },
      activeMissionByWorkspace: { [WS]: "fx-m1" },
    });
    const pane = (id: string, status: string, agent: string) => ({
      id,
      status,
      agent,
      cwd: WS,
      workspacePath: WS,
      missionId: "fx-m1",
      kind: "terminal",
      title: agent,
    });
    (usePanesStore as unknown as { setState: (patch: unknown) => void }).setState({
      panes: [
        pane("pane-p", "running", "claude"),
        pane("pane-3", "running", "codex"),
        pane("pane-2", "idle", "claude"),
        pane("pane-1", "idle", "claude"),
      ],
    });
  }

  const empty = scenario === "empty";
  const respond = async <T>(value: T): Promise<T> => {
    if (scenario === "slow") await wait(600000);
    if (scenario === "error") throw new Error("O banco de dados local não respondeu.");
    return value;
  };

  const overrides: Record<string, unknown> = {
    harness: {
      getTable: () => respond({ ok: true, table }),
      saveTable: (next: HarnessTable) => respond({ ok: true, table: next }),
      receipts: () => respond({ ok: true, receipts: empty ? [] : receipts }),
      deciderProviders: () =>
        respond({
          ok: true,
          providers: [
            {
              id: "openrouter",
              label: "OpenRouter",
              models: ["google/gemini-flash-2", "deepseek/v3"],
            },
          ],
        }),
      testDecider: ({ prompt }: { prompt: string }) =>
        respond(
          /login|erro|quebr/i.test(prompt)
            ? {
                ok: true,
                decision: {
                  taskId: "corrigir",
                  confidence: 0.84,
                  reason: "relata defeito em algo que funcionava",
                },
                taskName: "Corrigir bug",
              }
            : { ok: true, decision: null, reason: "confiança 41% abaixo do mínimo" }
        ),
    },
    findings: {
      list: () => respond({ ok: true, findings: empty ? [] : findings }),
      stats: () => respond({ ok: true, counts: empty ? {} : { open: 1, reopened: 1 } }),
      update: () => respond({ ok: true }),
    },
    agentCatalog: {
      scan: () => respond({ ok: true, items: empty ? [] : catalog }),
      setMeta: () => respond({ ok: true }),
      copyTo: () => respond({ ok: true }),
    },
    accounts: {
      list: () => respond({ ok: true, accounts: empty ? [] : accounts }),
      add: ({ cli, label }: { cli: string; label: string }) =>
        respond({ ok: true, account: { id: "novo", cli, label, loggedIn: false } }),
      remove: () => respond({ ok: true }),
      lock: () => respond({ ok: true }),
      login: () => respond({ ok: true, paneId: "pane-login" }),
    },
    media: {
      providers: () =>
        respond({
          ok: true,
          providers: empty ? [] : [{ id: "openai", label: "OpenAI Images", kinds: ["image"] }],
        }),
      list: () => respond({ ok: true, items: empty ? [] : media }),
      generate: () => respond({ ok: true }),
    },
    cli: {
      registry: () => Promise.resolve(registry),
      installCli: () => Promise.resolve({ ok: true }),
    },
  };

  const original = window.codeBrainApp as unknown as Record<string, unknown>;
  // Guarda o que seria mandado ao main, para conferir o contrato do piloto.
  const spawns: unknown[] = [];
  (window as unknown as { __cbfxSpawns: unknown[] }).__cbfxSpawns = spawns;
  overrides.pty = new Proxy(original.pty as object, {
    get: (target, key) =>
      key === "spawn"
        ? async (config: { agent: string; model?: string }) => {
            spawns.push(config);
            return {
              ok: true,
              paneId: `pane-new-${spawns.length}`,
              missionId: "mission_fx",
              agent: config.agent,
              model: config.model,
            };
          }
        : (target as Record<string | symbol, unknown>)[key],
  });
  (window as unknown as { codeBrainApp: unknown }).codeBrainApp = new Proxy(original, {
    get: (target, key) =>
      typeof key === "string" && key in overrides ? overrides[key] : target[key as string],
  });
}
