"use strict";

/**
 * recipe-handlers.js — Harness "Receitas" (Recipes) for Codebrain.
 *
 * Ported from Overclock's harnessAssistant.js with adaptations for Codebrain's
 * architecture (MCP tools, skill system, provider store).
 *
 * Two core LLM passes:
 *   - enrichCatalog: reads agent+skill names → assigns role + "when/how to use" blurb
 *   - proposeRecipes: reads enabled ingredients → proposes buildable deliverables
 *     with ordered orchestration steps (skill×agent)
 *
 * Both force JSON-only reply and parse defensively. Failures degrade to empty result.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// ── Constants ───────────────────────────────────────────────────────────────
const ONE_SHOT_TIMEOUT_MS = 60_000;
const ENRICH_CHUNK_SIZE = 40;
const ENRICH_CHUNK_CONCURRENCY = 4;

// Codebrain role taxonomy (replaces Overclock's scout/builder/reviewer)
const VALID_ROLES = new Set([
  "orchestrator",  // planning, delegation, synthesis
  "backend",       // APIs, databases, Electron/MCP, server logic
  "frontend",      // UI components, styling, stores, React
  "tester",        // testing, QA, browser automation, validation
  "browser",       // browser automation, scraping, web interaction
  "general",       // general-purpose workers
]);

// ── LLM One-Shot Caller ────────────────────────────────────────────────────

/**
 * Parse JSON from LLM reply — strips fences, finds first JSON object.
 */
function parseJsonObject(reply) {
  if (!reply || typeof reply !== "string") return null;
  const trimmed = reply.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch { /* fall through */ }
    }
    return null;
  }
}

/**
 * Make a one-shot LLM call via Anthropic-compatible HTTP API.
 * Supports: anthropic-compat, mimo-compat (both use Anthropic Messages API).
 * For gemini-compat and openai-compat, adapts the request format.
 *
 * @param {Object} opts - { baseUrl, apiKey, model, type }
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {string} [model]
 * @returns {Promise<string>}
 */
async function llmOneShot(opts, systemPrompt, userPrompt, model) {
  const baseUrl = opts.baseUrl || "https://api.anthropic.com";
  const apiKey = opts.apiKey || "";
  const providerType = opts.type || "anthropic-compat";
  const effectiveModel = model || opts.model || "claude-sonnet-4-6";

  if (!apiKey) {
    throw new Error("No API key available for LLM call");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    try { controller.abort(); } catch {}
  }, ONE_SHOT_TIMEOUT_MS);

  try {
    let url, headers, body;

    if (providerType === "gemini-compat") {
      // Gemini API format
      url = `${baseUrl}/models/${effectiveModel}:generateContent?key=${apiKey}`;
      headers = { "Content-Type": "application/json" };
      body = JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
      });
    } else if (providerType === "openai-compat") {
      // OpenAI-compatible format (OpenRouter, etc.)
      url = `${baseUrl}/v1/chat/completions`;
      headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      };
      body = JSON.stringify({
        model: effectiveModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 4096,
      });
    } else {
      // Anthropic-compatible format (Anthropic, MIMO)
      url = `${baseUrl}/v1/messages`;
      headers = {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      };
      body = JSON.stringify({
        model: effectiveModel,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        temperature: 0.3,
      });
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`LLM API ${res.status}: ${errText.slice(0, 200)}`);
    }

    const json = await res.json();

    // Extract text from response based on provider type
    if (providerType === "gemini-compat") {
      return json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } else if (providerType === "openai-compat") {
      return json?.choices?.[0]?.message?.content || "";
    } else {
      // Anthropic format
      const blocks = json?.content || [];
      return blocks
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("");
    }
  } finally {
    clearTimeout(timer);
  }
}

// ── Enrich Catalog ──────────────────────────────────────────────────────────

const ENRICH_SYSTEM = `Você classifica cada agent e skill de um IDE multi-agente (Codebrain) em categorias de papel.
Todo item pertence a EXATAMENTE UM dos seguintes:
- "orchestrator" (planejamento, delegação, síntese, coordenação)
- "backend" (APIs, banco de dados, Electron/MCP, lógica de servidor)
- "frontend" (UI components, styling, stores, React)
- "tester" (testes, QA, browser automation, validação)
- "browser" (browser automation, scraping, web interaction)
- "general" (uso geral, não se encaixa em nenhuma categoria específica)

Para CADA item atribua OBRIGATORIAMENTE um role e um blurb de quando/como usar (1 frase, ~120 chars).
Responda SOMENTE com JSON válido, sem cercas de código, no formato:
{"items":[{"name":"...","kind":"agent"|"skill","role":"...","blurb":"..."}]}.
Use exatamente os nomes recebidos. Não invente itens.`;

/**
 * Enrich a single chunk of the catalog via LLM.
 */
async function enrichChunk(agents, skills, providerOpts, model) {
  if (agents.length === 0 && skills.length === 0) return [];

  const userPrompt =
    `AGENTS (${agents.length}):\n${agents.map((a) => `- ${a}`).join("\n") || "(nenhum)"}\n\n` +
    `SKILLS (${skills.length}):\n${skills.map((s) => `- ${s}`).join("\n") || "(nenhum)"}\n\n` +
    "Organize e anote cada um.";

  const reply = await llmOneShot(providerOpts, ENRICH_SYSTEM, userPrompt, model);
  const parsed = parseJsonObject(reply);
  const items = Array.isArray(parsed?.items) ? parsed.items : [];

  const knownAgents = new Set(agents);
  const knownSkills = new Set(skills);
  const out = [];
  const seen = new Set();

  for (const it of items) {
    const name = typeof it.name === "string" ? it.name.trim() : "";
    if (!name) continue;
    if (!knownAgents.has(name) && !knownSkills.has(name)) continue;

    const kind = knownAgents.has(name) ? "agent" : "skill";
    const roleRaw = typeof it.role === "string" ? it.role.toLowerCase() : "";
    const role = VALID_ROLES.has(roleRaw) ? roleRaw : "general";

    out.push({ name, kind, role, blurb: typeof it.blurb === "string" ? it.blurb : "" });
    seen.add(name);
  }

  // Ensure items not returned by LLM still get a basic entry
  for (const name of [...agents, ...skills]) {
    if (!seen.has(name)) {
      out.push({
        name,
        kind: knownAgents.has(name) ? "agent" : "skill",
        role: "general",
        blurb: "",
      });
      seen.add(name);
    }
  }

  return out;
}

/**
 * Enrich the full catalog — splits into chunks and processes in bounded parallel.
 *
 * @param {Object} input - { agents: string[], skills: string[], model?: string }
 * @param {Object} providerOpts - { baseUrl, apiKey, type, model }
 * @returns {Promise<Array>}
 */
async function enrichCatalog(input, providerOpts) {
  const agents = (input.agents || []).filter(Boolean);
  const skills = (input.skills || []).filter(Boolean);
  if (agents.length === 0 && skills.length === 0) return [];

  const combined = [
    ...agents.map((name) => ({ name, kind: "agent" })),
    ...skills.map((name) => ({ name, kind: "skill" })),
  ];

  const chunks = [];
  for (let i = 0; i < combined.length; i += ENRICH_CHUNK_SIZE) {
    chunks.push(combined.slice(i, i + ENRICH_CHUNK_SIZE));
  }

  const out = [];
  for (let i = 0; i < chunks.length; i += ENRICH_CHUNK_CONCURRENCY) {
    const wave = chunks.slice(i, i + ENRICH_CHUNK_CONCURRENCY);
    const settled = await Promise.all(
      wave.map((chunk) =>
        enrichChunk(
          chunk.filter((x) => x.kind === "agent").map((x) => x.name),
          chunk.filter((x) => x.kind === "skill").map((x) => x.name),
          providerOpts,
          input.model
        ).catch(() => [])
      )
    );
    for (const items of settled) out.push(...items);
  }

  return out;
}

// ── Propose Recipes ─────────────────────────────────────────────────────────

const PROPOSE_SYSTEM = `Você é o ORQUESTRADOR de um IDE multi-agente (Codebrain).
A topologia é FLEXÍVEL — existem roles (orchestrator, backend, frontend, tester, browser, general)
e cada role pode ser executado por diferentes agents com diferentes skills.

Recebe a "despensa" de ingredientes HABILITADOS (agents, skills, LLMs).
Proponha de 2 a 4 ENTREGÁVEIS construíveis com ESSES ingredientes.
Cada receita é um PLANO DE ORQUESTRAÇÃO EXECUTÁVEL, narrado na ORDEM REAL da missão.

Para cada receita dê:
- name, deliverable (1 frase), favoriteModel (um dos LLMs habilitados);
- questions: as PERGUNTAS que o orquestrador faz ao usuário no início pra travar o escopo;
- steps: as delegações NA ORDEM — cada uma com:
  {role: "orchestrator"|"backend"|"frontend"|"tester"|"browser"|"general",
   skill: a SKILL REAL habilitada (ex. "add-ipc-feature"),
   agent: UM agent habilitado,
   model: o LLM daquela etapa,
   produces: o ARTEFATO concreto que sai,
   parallel: true se roda em paralelo com irmãos}
- delivery: a ENTREGA FINAL definida.

Use SÓ skills/agents da despensa. Responda SOMENTE com JSON válido, sem cercas, no formato:
{"recipes":[{"name":"...","deliverable":"...","favoriteModel":"...","questions":["..."],
"steps":[{"role":"...","skill":"...","agent":"...","model":"...","produces":"...","parallel":false}],
"delivery":"..."}]}.

IMPORTANTE: cada step aponta o agent real e a skill real. Todo nome DEVE ser cópia EXATA de um item
da despensa — nome fora dela é REJEITADO.`;

/**
 * Propose recipes based on enabled ingredients.
 *
 * @param {Object} input - { agents, skills, llms, model? }
 * @param {Object} providerOpts - { baseUrl, apiKey, type, model }
 * @returns {Promise<Array>}
 */
async function proposeRecipes(input, providerOpts) {
  const agents = (input.agents || []).filter(Boolean);
  const skills = (input.skills || []).filter(Boolean);
  const llms = (input.llms || []).filter(Boolean);

  if (agents.length === 0 && skills.length === 0) return [];

  const userPrompt =
    `DESPENSA (ingredientes habilitados):\n` +
    `AGENTS: ${agents.join(", ") || "(nenhum)"}\n` +
    `SKILLS: ${skills.join(", ") || "(nenhum)"}\n` +
    `LLMs: ${llms.join(", ") || "(nenhum)"}\n\n` +
    "Proponha os planos de orquestração (perguntas → steps com role+skill+agent+produz, paralelismo → entrega final).";

  const reply = await llmOneShot(providerOpts, PROPOSE_SYSTEM, userPrompt, input.model);
  const parsed = parseJsonObject(reply);
  const recipes = Array.isArray(parsed?.recipes) ? parsed.recipes : [];

  const strArr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  const agentSet = new Set(agents);
  const skillSet = new Set(skills);

  const gapOf = (agent, skill) => {
    const parts = [];
    if (agent && !agentSet.has(agent)) parts.push(`agent '${agent}' fora do catálogo`);
    if (skill && !skillSet.has(skill)) parts.push(`skill '${skill}' fora do catálogo`);
    return parts.length > 0 ? parts.join("; ") : undefined;
  };

  const out = [];
  for (const r of recipes) {
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!name) continue;

    const rawSteps = Array.isArray(r.steps) ? r.steps : [];
    const steps = rawSteps.map((s) => {
      const skill = typeof s.skill === "string" ? s.skill : "";
      const agent = typeof s.agent === "string" ? s.agent : "";
      const gap = gapOf(agent, skill);
      const roleRaw = typeof s.role === "string" ? s.role.toLowerCase() : "";
      return {
        role: VALID_ROLES.has(roleRaw) ? roleRaw : "general",
        skill,
        agent,
        model: typeof s.model === "string" ? s.model : "",
        produces: typeof s.produces === "string" ? s.produces : "",
        parallel: s.parallel === true,
        ...(gap ? { gap } : {}),
      };
    });

    out.push({
      name,
      deliverable: typeof r.deliverable === "string" ? r.deliverable : "",
      favoriteModel: typeof r.favoriteModel === "string" ? r.favoriteModel : (llms[0] || ""),
      questions: strArr(r.questions),
      steps,
      delivery: typeof r.delivery === "string" ? r.delivery : "",
    });
  }

  return out;
}

// ── Handler Factory ─────────────────────────────────────────────────────────

/**
 * Create recipe-related bridge handlers.
 *
 * @param {Object} opts - { memoryStore, providerStore, configStore, getCurrentWorkspacePath }
 */
function createRecipeHandlers(opts) {
  const CATALOG_KEY = "recipe-enriched-catalog";
  const RECIPE_KEY_PREFIX = "recipe-saved-";

  /**
   * Resolve the default provider's LLM config for one-shot calls.
   * Tries the first provider with an API key configured.
   */
  function getProviderOpts() {
    const store = opts.providerStore;
    if (!store) return null;

    const providers = store.listFull();
    // Priority: MIMO > Anthropic > Gemini > any with API key
    const registry = opts.providerRegistry || [];
    const resolveFromRegistry = (providerId) => {
      const tpl = registry.find((t) => t.id === providerId);
      return tpl ? { baseUrl: tpl.baseUrl, type: tpl.type } : {};
    };

    const priority = ["mimo", "anthropic", "gemini"];
    for (const id of priority) {
      const p = providers.find((pr) => pr.id === id);
      if (p) {
        const env = p.env || {};
        const apiKey = Object.values(env).find((v) => typeof v === "string" && v.length > 5);
        if (apiKey) {
          const reg = resolveFromRegistry(id);
          return {
            baseUrl: reg.baseUrl || "https://api.anthropic.com",
            apiKey,
            type: reg.type || p.type || "anthropic-compat",
            model: (p.models || [])[0],
          };
        }
      }
    }

    // Fallback: first provider with any API key
    for (const p of providers) {
      const env = p.env || {};
      const apiKey = Object.values(env).find((v) => typeof v === "string" && v.length > 5);
      if (apiKey) {
        const reg = resolveFromRegistry(p.id);
        return {
          baseUrl: reg.baseUrl || "https://api.anthropic.com",
          apiKey,
          type: reg.type || p.type || "anthropic-compat",
          model: (p.models || [])[0],
        };
      }
    }

    return null;
  }

  /**
   * Get the list of currently enabled agents from the pane system.
   */
  function getEnabledAgents() {
    const agents = new Set();
    // Add standard agents from the system
    agents.add("claude");
    agents.add("openclaude");
    agents.add("gemini");
    agents.add("codex");
    // Add active pane labels as agent identifiers
    try {
      const store = opts.memoryStore;
      if (store) {
        const result = store.listAgents({ limit: 50 });
        if (result?.ok && Array.isArray(result.agents)) {
          for (const a of result.agents) {
            if (a.label) agents.add(a.label);
          }
        }
      }
    } catch {}
    return [...agents];
  }

  /**
   * Get the list of currently installed skills.
   */
  function getEnabledSkills() {
    const skills = [];
    const GLOBAL_SKILLS_DIR = path.join(os.homedir(), ".codebrain", "skills");
    const dirs = [GLOBAL_SKILLS_DIR];
    const cwd = opts.getCurrentWorkspacePath?.() || process.cwd();
    const projectDir = path.join(cwd, ".codebrain", "skills");
    if (!dirs.includes(projectDir)) dirs.push(projectDir);

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!d.isDirectory()) continue;
          try {
            const manifest = JSON.parse(fs.readFileSync(path.join(dir, d.name, "skill.json"), "utf-8"));
            if (manifest?.id) skills.push(manifest.id);
          } catch {}
        }
      } catch {}
    }
    return [...new Set(skills)];
  }

  /**
   * Get available LLM models from providers.
   */
  function getAvailableLLMs() {
    const models = [];
    const store = opts.providerStore;
    if (!store) return models;
    const providers = store.listFull();
    for (const p of providers) {
      if (p.models) models.push(...p.models);
    }
    return [...new Set(models)];
  }

  return {
    /**
     * Enrich the catalog: classify all agents and skills with roles + blurbs.
     * Spawns a quick LLM pass via HTTP.
     */
    async recipeEnrichCatalog({ model, force } = {}) {
      const ws = opts.getCurrentWorkspacePath?.() || process.cwd();

      // Check if already enriched (unless force=true)
      if (!force) {
        try {
          const existing = opts.memoryStore?.read?.({ key: CATALOG_KEY, workspace: ws });
          if (existing?.ok && existing.memory?.content) {
            const catalog = JSON.parse(existing.memory.content);
            if (catalog?.items?.length > 0 && Date.now() - new Date(catalog.updatedAt).getTime() < 24 * 60 * 60 * 1000) {
              return { ok: true, data: catalog.items, cached: true };
            }
          }
        } catch {}
      }

      const agents = getEnabledAgents();
      const skills = getEnabledSkills();

      if (agents.length === 0 && skills.length === 0) {
        return { ok: true, data: [], error: "No agents or skills found" };
      }

      const providerOpts = getProviderOpts();
      if (!providerOpts) {
        // Fallback: return basic catalog without LLM enrichment
        const basicItems = [
          ...agents.map((name) => ({ name, kind: "agent", role: "general", blurb: "" })),
          ...skills.map((name) => ({ name, kind: "skill", role: "general", blurb: "" })),
        ];
        return { ok: true, data: basicItems, fallback: true };
      }

      try {
        const items = await enrichCatalog({ agents, skills, model }, providerOpts);

        // Persist enriched catalog
        const payload = { version: 1, updatedAt: new Date().toISOString(), items };
        opts.memoryStore?.write?.({
          type: "semantic",
          key: CATALOG_KEY,
          content: JSON.stringify(payload),
          tags: ["recipe", "catalog", "enriched"],
          workspace: ws,
        });

        return { ok: true, data: items };
      } catch (err) {
        console.error("[recipe-handlers] enrichCatalog failed:", err.message);
        // Fallback to basic catalog
        const basicItems = [
          ...agents.map((name) => ({ name, kind: "agent", role: "general", blurb: "Agent disponível" })),
          ...skills.map((name) => ({ name, kind: "skill", role: "general", blurb: "Skill instalada" })),
        ];
        return { ok: true, data: basicItems, fallback: true, error: err.message };
      }
    },

    /**
     * Propose recipes: what can we build with the current ingredients?
     */
    async recipePropose({ model, agents: customAgents, skills: customSkills, llms: customLlms } = {}) {
      const ws = opts.getCurrentWorkspacePath?.() || process.cwd();

      const agents = customAgents || getEnabledAgents();
      const skills = customSkills || getEnabledSkills();
      const llms = customLlms || getAvailableLLMs();

      if (agents.length === 0 && skills.length === 0) {
        return { ok: true, data: [], error: "No agents or skills available" };
      }

      const providerOpts = getProviderOpts();
      if (!providerOpts) {
        return { ok: false, error: "No LLM provider configured. Please set up a provider with an API key." };
      }

      try {
        const recipes = await proposeRecipes({ agents, skills, llms, model }, providerOpts);
        return { ok: true, data: recipes };
      } catch (err) {
        console.error("[recipe-handlers] proposeRecipes failed:", err.message);
        return { ok: false, error: err.message };
      }
    },

    /**
     * Get the enriched catalog (cached).
     */
    async recipeGetCatalog() {
      const ws = opts.getCurrentWorkspacePath?.() || process.cwd();
      try {
        const existing = opts.memoryStore?.read?.({ key: CATALOG_KEY, workspace: ws });
        if (existing?.ok && existing.memory?.content) {
          const catalog = JSON.parse(existing.memory.content);
          return { ok: true, data: catalog };
        }
      } catch {}
      return { ok: true, data: { version: 1, updatedAt: null, items: [] } };
    },

    /**
     * Save a recipe for later use (user can save proposed recipes).
     */
    async recipeSave({ recipe }) {
      if (!recipe?.name) return { ok: false, error: "Recipe name is required" };
      const ws = opts.getCurrentWorkspacePath?.() || process.cwd();
      const key = `${RECIPE_KEY_PREFIX}${recipe.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

      try {
        opts.memoryStore?.write?.({
          type: "semantic",
          key,
          content: JSON.stringify(recipe),
          tags: ["recipe", "saved"],
          workspace: ws,
        });
        return { ok: true, key, name: recipe.name };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    /**
     * List all saved recipes.
     */
    async recipeList() {
      const ws = opts.getCurrentWorkspacePath?.() || process.cwd();
      try {
        const results = opts.memoryStore?.search?.({
          query: "recipe-saved-",
          tags: ["recipe", "saved"],
          workspace: ws,
          limit: 50,
        });
        if (results?.ok && Array.isArray(results.memories)) {
          const recipes = results.memories
            .map((m) => {
              try { return JSON.parse(m.content); } catch { return null; }
            })
            .filter(Boolean);
          return { ok: true, data: recipes };
        }
      } catch {}
      return { ok: true, data: [] };
    },

    /**
     * Delete a saved recipe.
     */
    async recipeDelete({ name }) {
      if (!name) return { ok: false, error: "Recipe name is required" };
      const ws = opts.getCurrentWorkspacePath?.() || process.cwd();
      const key = `${RECIPE_KEY_PREFIX}${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

      try {
        opts.memoryStore?.delete?.({ key, workspace: ws });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    /**
     * Get the list of enabled ingredients (agents, skills, LLMs).
     */
    async recipeIngredients() {
      return {
        ok: true,
        data: {
          agents: getEnabledAgents(),
          skills: getEnabledSkills(),
          llms: getAvailableLLMs(),
        },
      };
    },
  };
}

module.exports = { createRecipeHandlers };
