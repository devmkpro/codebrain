"use strict";

/* ═══════════════════════════════════════════════════════════════════════════
   HARNESS — quem executa cada tipo de tarefa
   ═══════════════════════════════════════════════════════════════════════════

   O orquestrador diz O QUE precisa ser feito; esta tabela decide COM O QUÊ:
   CLI, modelo, esforço, conta e skills. Assim o modelo caro não gasta contexto
   escolhendo ferramenta, e o usuário ajusta o custo num lugar só.

   Ordem de decisão (a primeira que responder vence, campo a campo):

     1. o que foi pedido explicitamente no spawn
     2. a linha da tabela indicada por `task`
     3. a linha cujas palavras-chave casam com o prompt
     4. a linha padrão

   Módulo puro, exceto load/save: toda a decisão é testável sem PTY.
   ═══════════════════════════════════════════════════════════════════════════ */

const fs = require("node:fs");
const path = require("node:path");

const HARNESS_VERSION = 1;
const EFFORTS = ["low", "medium", "high"];
const TIERS = ["fast", "balanced", "deep"];
const DEFAULT_ROW_ID = "geral";

/** Modelo por CLI e faixa. CLI ausente herda o modelo da conta. */
const DEFAULT_TIER_MODELS = {
  claude: {
    fast: "claude-haiku-4-5-20251001",
    balanced: "claude-sonnet-4-6",
    deep: "claude-opus-4-8",
  },
  // Ids de `kiro-cli chat --list-models` (3.1.0).
  kiro: { fast: "claude-haiku-5.5", balanced: "claude-sonnet-5.5", deep: "claude-opus-5.5" },
  // docs.x.ai/build/settings só documenta grok-build para sessões de código.
  grok: { balanced: "grok-build" },
};

const DEFAULT_DECIDER = {
  enabled: false,
  providerId: null,
  model: null,
  minConfidence: 0.6,
  timeoutMs: 4000,
};

const row = (id, name, description, tier, effort, keywords, extra = {}) => ({
  id,
  name,
  description,
  tier,
  effort,
  keywords,
  cli: null,
  model: null,
  accountId: null,
  agentName: null,
  skills: [],
  fallbacks: [],
  review: false,
  ...extra,
});

const DEFAULT_ROWS = [
  row(
    "implementar",
    "Implementar",
    "Criar funcionalidade ou tela nova.",
    "balanced",
    "medium",
    [
      "implementar",
      "implemente",
      "criar",
      "crie",
      "adicionar",
      "adicione",
      "feature",
      "funcionalidade",
      "implement",
      "build",
      "add",
    ],
    { skills: ["cb-worker", "cb-evidence"] }
  ),
  row(
    "corrigir",
    "Corrigir bug",
    "Achar a causa e corrigir um defeito.",
    "balanced",
    "high",
    [
      "bug",
      "corrigir",
      "corrija",
      "conserte",
      "consertar",
      "erro",
      "quebrou",
      "falha",
      "falhando",
      "fix",
      "crash",
      "trava",
      "travando",
    ],
    { skills: ["cb-worker", "cb-root-cause", "cb-evidence"] }
  ),
  row(
    "refatorar",
    "Refatorar",
    "Mudar a estrutura sem mudar o comportamento.",
    "balanced",
    "medium",
    ["refatorar", "refatore", "refactor", "reorganizar", "extrair", "simplificar", "limpar"],
    { skills: ["cb-worker", "cb-evidence"] }
  ),
  row(
    "pesquisar",
    "Pesquisar",
    "Responder uma pergunta sem editar nada.",
    "fast",
    "low",
    [
      "pesquisar",
      "pesquise",
      "investigar",
      "investigue",
      "mapear",
      "mapeie",
      "localizar",
      "onde fica",
      "como funciona",
      "research",
      "explore",
    ],
    { skills: ["cb-worker"] }
  ),
  row(
    "revisar",
    "Revisar",
    "Tentar quebrar o trabalho de outro agente.",
    "deep",
    "high",
    [
      "revisar",
      "revise",
      "review",
      "auditar",
      "audite",
      "auditoria",
      "conferir",
      "confira",
      "validar",
      "valide",
      "verificar",
      "verifique",
    ],
    { skills: ["cb-reviewer", "cb-findings"], review: true }
  ),
  row(
    "testar",
    "Testar",
    "Escrever ou rodar testes.",
    "balanced",
    "medium",
    ["teste", "testes", "testar", "cobertura", "vitest", "jest", "pytest", "e2e"],
    { skills: ["cb-worker", "cb-evidence"] }
  ),
  row(
    "interface",
    "Interface",
    "Construir ou ajustar telas.",
    "balanced",
    "high",
    [
      "tela",
      "interface",
      "layout",
      "componente",
      "css",
      "frontend",
      "front-end",
      "ui",
      "ux",
      "visual",
    ],
    { skills: ["cb-worker", "cb-evidence"] }
  ),
  row(
    "planejar",
    "Planejar",
    "Decidir arquitetura e quebrar o trabalho.",
    "deep",
    "high",
    [
      "planejar",
      "planeje",
      "plano",
      "arquitetura",
      "especificar",
      "desenhar",
      "plan",
      "design doc",
    ],
    { skills: ["cb-pilot"] }
  ),
  row(
    "documentar",
    "Documentar",
    "Escrever documentação e changelog.",
    "fast",
    "low",
    ["documentar", "documente", "documentação", "readme", "changelog", "docs"],
    { skills: ["cb-worker"] }
  ),
  row(
    "operar",
    "Operar",
    "Build, deploy, migração e rotina.",
    "fast",
    "medium",
    [
      "deploy",
      "build",
      "migração",
      "migrar",
      "publicar",
      "release",
      "instalar",
      "pipeline",
      "docker",
      "ci",
    ],
    { skills: ["cb-worker", "cb-evidence"] }
  ),
  row(DEFAULT_ROW_ID, "Geral", "Quando nenhum outro tipo combinar.", "balanced", "medium", [], {
    skills: ["cb-worker", "cb-evidence"],
  }),
];

function createDefaultTable() {
  return {
    version: HARNESS_VERSION,
    tierModels: JSON.parse(JSON.stringify(DEFAULT_TIER_MODELS)),
    decider: { ...DEFAULT_DECIDER },
    rows: JSON.parse(JSON.stringify(DEFAULT_ROWS)),
  };
}

const fold = (text) =>
  String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function keywordHits(promptFolded, keywords) {
  let hits = 0;
  for (const keyword of keywords ?? []) {
    const pattern = new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapeRegex(fold(keyword))}($|[^\\p{L}\\p{N}])`,
      "u"
    );
    if (pattern.test(promptFolded)) hits += 1;
  }
  return hits;
}

/** Classifica o prompt pelas palavras-chave. Empate significa "não sei". */
function classifyPrompt(prompt, rows) {
  const folded = fold(prompt);
  const scored = rows
    .filter((candidate) => candidate.keywords?.length)
    .map((candidate) => ({ row: candidate, hits: keywordHits(folded, candidate.keywords) }))
    .filter((entry) => entry.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  if (!scored.length) return null;
  if (scored[1] && scored[1].hits === scored[0].hits) return null;
  return { row: scored[0].row, hits: scored[0].hits };
}

function findRow(rows, task) {
  const wanted = fold(task).trim();
  if (!wanted) return null;
  return (
    rows.find((candidate) => candidate.id === wanted || fold(candidate.name) === wanted) ?? null
  );
}

const isAvailable = (cli, availableClis) => !availableClis || availableClis.has(cli);

/** Escolhe a CLI da linha, caindo para as reservas e por fim para quem pediu. */
function resolveCli({ selected, explicitAgent, callerAgent, availableClis, notes }) {
  if (explicitAgent) return { agent: explicitAgent, model: null };
  if (selected.cli && isAvailable(selected.cli, availableClis)) {
    return { agent: selected.cli, model: selected.model ?? null };
  }
  if (selected.cli) notes.push(`${selected.cli} não encontrada`);
  for (const fallback of selected.fallbacks ?? []) {
    if (fallback?.cli && isAvailable(fallback.cli, availableClis)) {
      notes.push(`usando a reserva ${fallback.cli}`);
      return { agent: fallback.cli, model: fallback.model ?? null };
    }
  }
  return { agent: callerAgent ?? null, model: null };
}

function describeSource(source, selected, hits, decided) {
  if (source === "pedido") return `tipo ${selected.name} (indicado no pedido)`;
  if (source === "decisor") {
    const why = decided?.reason ? `: ${decided.reason}` : "";
    return `tipo ${selected.name} (decisor, ${Math.round((decided?.confidence ?? 0) * 100)}%${why})`;
  }
  if (source === "palavra-chave")
    return `tipo ${selected.name} (${hits} pista${hits === 1 ? "" : "s"} no prompt)`;
  return `tipo ${selected.name} (padrão)`;
}

/**
 * @returns decisão completa, com `receipt` legível para o orquestrador.
 */
function decideHarness({
  task,
  prompt,
  explicit = {},
  table,
  availableClis,
  callerAgent,
  pickAccount,
  resolveSkills,
  decided,
  deciderNote,
}) {
  const rows = table?.rows?.length ? table.rows : DEFAULT_ROWS;
  const notes = [];
  if (deciderNote) notes.push(deciderNote);

  let selected = findRow(rows, task);
  let source = selected ? "pedido" : null;
  let hits = 0;
  if (task && !selected) notes.push(`tipo "${task}" não existe na tabela`);
  if (!selected && decided) {
    selected = findRow(rows, decided.taskId);
    if (selected) source = "decisor";
  }
  if (!selected) {
    const classified = classifyPrompt(prompt, rows);
    if (classified) {
      selected = classified.row;
      hits = classified.hits;
      source = "palavra-chave";
    }
  }
  if (!selected) {
    selected = rows.find((candidate) => candidate.id === DEFAULT_ROW_ID) ?? rows[0];
    source = "padrao";
  }

  const resolved = resolveCli({
    selected,
    explicitAgent: explicit.agent,
    callerAgent,
    availableClis,
    notes,
  });
  const agent = resolved.agent;
  const tierModels = table?.tierModels ?? DEFAULT_TIER_MODELS;
  const tierModel = agent ? (tierModels[agent]?.[selected.tier] ?? null) : null;
  const model = explicit.model ?? (explicit.agent ? null : (resolved.model ?? tierModel));
  const effort = explicit.effort ?? selected.effort ?? "medium";
  const agentName =
    selected.agentName ?? (source === "decisor" ? (decided?.agentName ?? null) : null);
  const requestedSkills = explicit.skills ?? selected.skills ?? [];
  // Skills pedidas no spawn não são trocadas pelas do agente, só filtradas.
  const skills = resolveSkills
    ? resolveSkills(requestedSkills, explicit.skills ? null : agentName)
    : requestedSkills;

  let accountId =
    explicit.accountId ??
    (!explicit.providerId && (!selected.cli || selected.cli === agent)
      ? selected.accountId
      : null) ??
    null;
  let accountLabel = null;
  if (agent && pickAccount && !explicit.providerId) {
    const account = pickAccount(agent, accountId);
    if (account) {
      accountId = account.id;
      accountLabel = account.label;
      if (account.note) notes.push(account.note);
    }
  }

  const receiptParts = [
    `▸ ${describeSource(source, selected, hits, decided)}`,
    `▸ ${agent ?? "CLI padrão"} · ${model ?? "modelo da conta"} · esforço ${effort}`,
  ];
  if (accountLabel) receiptParts.push(`▸ conta ${accountLabel}`);
  if (skills.length) receiptParts.push(`▸ skills ${skills.join(", ")}`);
  if (selected.review) receiptParts.push("▸ revisão: pane novo, nunca o autor");
  if (notes.length) receiptParts.push(`▸ avisos: ${notes.join("; ")}`);

  return {
    taskId: selected.id,
    taskName: selected.name,
    source,
    agent,
    model,
    effort,
    skills,
    accountId,
    accountLabel,
    agentName,
    review: Boolean(selected.review),
    notes,
    receipt: receiptParts.join("\n"),
  };
}

/** Nome do pane a partir do prompt, quando quem abriu não deu um. */
function deriveName(prompt) {
  const words = String(prompt ?? "")
    .replace(/[`*_#>[\]()]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
  return words.join(" ").slice(0, 48) || "Ajudante";
}

function normalizeRow(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = fold(raw.id)
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!id) return null;
  const list = (value) =>
    Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : [];
  return {
    id,
    name: String(raw.name || id).slice(0, 48),
    description: String(raw.description ?? "").slice(0, 240),
    tier: TIERS.includes(raw.tier) ? raw.tier : "balanced",
    effort: EFFORTS.includes(raw.effort) ? raw.effort : "medium",
    keywords: list(raw.keywords),
    examples: list(raw.examples),
    notExamples: list(raw.notExamples),
    cli: nullableString(raw.cli),
    model: nullableString(raw.model),
    accountId: nullableString(raw.accountId),
    agentName: nullableString(raw.agentName),
    skills: list(raw.skills),
    fallbacks: Array.isArray(raw.fallbacks)
      ? raw.fallbacks
          .filter((f) => nullableString(f?.cli))
          .map((f) => ({ cli: f.cli.trim(), model: nullableString(f.model) }))
      : [],
    review: raw.review === true,
  };
}

const nullableString = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

function normalizeDecider(raw) {
  const config = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: config.enabled === true,
    providerId: nullableString(config.providerId),
    model: nullableString(config.model),
    minConfidence:
      typeof config.minConfidence === "number" &&
      Number.isFinite(config.minConfidence) &&
      config.minConfidence >= 0 &&
      config.minConfidence <= 1
        ? config.minConfidence
        : DEFAULT_DECIDER.minConfidence,
    timeoutMs:
      typeof config.timeoutMs === "number" && Number.isFinite(config.timeoutMs)
        ? Math.min(30_000, Math.max(1, Math.floor(config.timeoutMs)))
        : DEFAULT_DECIDER.timeoutMs,
  };
}

function normalizeTable(raw) {
  const base = createDefaultTable();
  if (!raw || typeof raw !== "object") return base;
  const rows = (Array.isArray(raw.rows) ? raw.rows : []).map(normalizeRow).filter(Boolean);
  const seen = new Set();
  const unique = rows.filter((candidate) => !seen.has(candidate.id) && seen.add(candidate.id));
  if (!unique.length) unique.push(...base.rows);
  if (!unique.some((candidate) => candidate.id === DEFAULT_ROW_ID)) {
    unique.push(base.rows.find((candidate) => candidate.id === DEFAULT_ROW_ID));
  }
  return {
    version: HARNESS_VERSION,
    tierModels:
      raw.tierModels && typeof raw.tierModels === "object" && !Array.isArray(raw.tierModels)
        ? Object.fromEntries(
            Object.entries(raw.tierModels)
              .filter(
                ([, models]) => models && typeof models === "object" && !Array.isArray(models)
              )
              .map(([cli, models]) => [
                cli,
                Object.fromEntries(
                  TIERS.flatMap((tier) =>
                    nullableString(models[tier]) ? [[tier, models[tier].trim()]] : []
                  )
                ),
              ])
          )
        : base.tierModels,
    decider: normalizeDecider(raw.decider),
    rows: unique,
  };
}

function loadHarnessTable(filePath) {
  try {
    return normalizeTable(JSON.parse(fs.readFileSync(filePath, "utf-8")));
  } catch {
    return createDefaultTable();
  }
}

/** Grava via arquivo temporário para um crash não deixar JSON pela metade. */
function saveHarnessTable(filePath, table) {
  const normalized = normalizeTable(table);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
  return normalized;
}

module.exports = {
  EFFORTS,
  TIERS,
  DEFAULT_ROW_ID,
  classifyPrompt,
  createDefaultTable,
  decideHarness,
  deriveName,
  loadHarnessTable,
  normalizeTable,
  saveHarnessTable,
};
