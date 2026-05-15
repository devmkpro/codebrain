/**
 * Electron Main Process — Entry Point
 *
 * Initializes the app window, registers all IPC handlers, and wires up
 * the auto-updater, PTY manager, and provider stores.
 */
import { app, BrowserWindow, ipcMain, dialog, shell, Notification, session } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import log from "electron-log/main.js";

import { is, platform } from "./platform";
import { PtyManager } from "./pty-manager";
import { ProviderStore } from "./provider-store";
import { WorkspaceConfigStore } from "./workspace-config-store";
import { ConfigStore } from "./config-store";
import { CliDetector } from "./cli-detector";
import { setupAutoUpdater, teardownAutoUpdater, isUpdateInstallRequested } from "./auto-updater";
import { AudioConfigStore, normalizeAudioConfig, AUDIO_DEFAULTS, type AudioConfig } from "./audio-config-store";

log.initialize();

// ── Constants ────────────────────────────────────────────────────────────────

const GLOBAL_DIR = path.join(os.homedir(), ".codebrain");
const DATA_DIR = app.getPath("userData");
const PROVIDERS_FILE = path.join(DATA_DIR, "providers.json");
const WORKSPACES_FILE = path.join(DATA_DIR, "recent-workspaces.json");
const AUDIO_CONFIG_FILE = path.join(DATA_DIR, "audio-config.json");

// ProviderForm shows these env var keys based on provider type:
//   mimo-compat / anthropic-compat → ANTHROPIC_AUTH_TOKEN
//   gemini-compat → GEMINI_API_KEY
//   openai-compat → OPENAI_API_KEY
// tokenEnvVar MUST match what the form shows, otherwise the key won't be in the env dict.
const BUILTIN_TEMPLATES = [
  {
    id: "mimo",
    label: "MIMO",
    icon: "MIMO",
    integrations: [
      {
        type: "mimo-compat",
        host: "openclaude",
        baseUrl: "https://token-plan-sgp.xiaomimimo.com/anthropic",
        tokenEnvVar: "MIMO_API_KEY",
        label: "MIMO",
        models: ["mimo-v2.5-pro", "mimo-v2.5", "mimo-v2-pro", "mimo-v2-omni", "mimo-v2-flash"]
      }
    ]
  },
  {
    id: "gemini",
    label: "Google Gemini",
    icon: "G",
    signupUrl: "https://aistudio.google.com/app/apikey",
    integrations: [
      {
        type: "gemini-compat",
        host: "openclaude",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        tokenEnvVar: "GEMINI_API_KEY",
        label: "OpenClaude via Gemini API",
        models: ["gemini-3.1-pro", "gemini-3.1-flash-lite-preview", "gemini-3-flash-preview", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"]
      }
    ]
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    icon: "OR",
    signupUrl: "https://openrouter.ai/keys",
    integrations: [
      {
        type: "openai-compat",
        host: "openclaude",
        baseUrl: "https://openrouter.ai/api/v1",
        tokenEnvVar: "OPENAI_API_KEY",
        label: "OpenClaude via OpenRouter",
        models: ["anthropic/claude-3.5-sonnet", "google/gemini-2.5-pro", "openai/gpt-4o"]
      }
    ]
  },
  {
    id: "anthropic",
    label: "Anthropic",
    icon: "A",
    signupUrl: "https://console.anthropic.com/settings/keys",
    integrations: [
      {
        type: "anthropic-compat",
        host: "openclaude",
        baseUrl: "https://api.anthropic.com",
        tokenEnvVar: "ANTHROPIC_AUTH_TOKEN",
        label: "OpenClaude Code",
        models: ["claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5-20251101", "claude-opus-4-1-20250805", "claude-opus-4-20250514", "claude-sonnet-4-6", "claude-sonnet-4-5-20250929", "claude-sonnet-4-20250514", "claude-3-7-sonnet-20250219", "claude-3-5-sonnet-20241022", "claude-haiku-4-5-20251001", "claude-3-5-haiku-20241022"]
      }
    ]
  },
  {
    id: "openai",
    label: "OpenAI",
    icon: "O",
    signupUrl: "https://platform.openai.com/api-keys",
    integrations: [
      {
        type: "openai-compat",
        host: "openclaude",
        baseUrl: "https://api.openai.com/v1",
        tokenEnvVar: "OPENAI_API_KEY",
        label: "OpenClaude via OpenAI",
        models: ["gpt-5.5", "gpt-5.5-mini", "gpt-5.5-nano", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini", "o3", "o4-mini", "o3-mini", "o1-pro", "o1"]
      }
    ]
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    icon: "DS",
    signupUrl: "https://platform.deepseek.com/api_keys",
    integrations: [
      {
        type: "openai-compat",
        host: "openclaude",
        baseUrl: "https://api.deepseek.com/v1",
        tokenEnvVar: "OPENAI_API_KEY",
        label: "OpenClaude via DeepSeek",
        models: ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-reasoner", "deepseek-chat"]
      }
    ]
  },
  {
    id: "mistral",
    label: "Mistral",
    icon: "M",
    signupUrl: "https://console.mistral.ai/api-keys",
    integrations: [
      {
        type: "openai-compat",
        host: "openclaude",
        baseUrl: "https://api.mistral.ai/v1",
        tokenEnvVar: "OPENAI_API_KEY",
        label: "OpenClaude via Mistral",
        models: ["mistral-large-latest", "mistral-small-latest", "devstral-latest", "codestral"]
      }
    ]
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    icon: "X",
    signupUrl: "https://console.x.ai/team/default/api-keys",
    integrations: [
      {
        type: "openai-compat",
        host: "openclaude",
        baseUrl: "https://api.x.ai/v1",
        tokenEnvVar: "OPENAI_API_KEY",
        label: "OpenClaude via Grok",
        models: ["grok-4.3", "grok-4", "grok-3"]
      }
    ]
  },
  {
    id: "ollama",
    label: "Ollama (Local)",
    icon: "🦙",
    integrations: [
      {
        type: "openai-compat",
        host: "openclaude",
        baseUrl: "http://localhost:11434/v1",
        tokenEnvVar: "OPENAI_API_KEY",
        label: "OpenClaude via Ollama",
        models: []
      }
    ]
  }
];

// ── Singletons ───────────────────────────────────────────────────────────────

const ptyManager = new PtyManager();
const providerStore = new ProviderStore(PROVIDERS_FILE);
const workspaceConfigStore = new WorkspaceConfigStore();
const configStore = new ConfigStore();
const cliDetector = new CliDetector();
const audioConfigStore = new AudioConfigStore(AUDIO_CONFIG_FILE);

// MCP server state
let mcpServerInfo: { port: number; sseUrl: string; streamableHttpUrl: string; close: () => void } | null = null;
let mcpServerReady: Promise<{ port: number; sseUrl: string; streamableHttpUrl: string; close: () => void }> | null = null;

// Current workspace path — used as default cwd for MCP-spawned panes
let currentWorkspacePath: string = os.homedir();

// ── Prompt Loading ──────────────────────────────────────────────────────────
// Load squad prompts from the prompts/ directory (relative to project root)
const PROMPTS_DIR = path.join(__dirname, "../../prompts");

function loadPrompt(filename: string): string {
  try {
    return fs.readFileSync(path.join(PROMPTS_DIR, filename), "utf-8").trim();
  } catch {
    return "";
  }
}

// Cache prompts at startup
const WORKER_PROMPT = loadPrompt("squad-worker.md");
const ORCHESTRATOR_PROMPT = loadPrompt("squad-orchestrator.md");
const UI_TESTER_PROMPT = loadPrompt("squad-ui-tester.md");
const GEMINI_WORKER_PROMPT = loadPrompt("squad-worker-gemini.md");

// Pane tracking Maps — shared between IPC handler and MCP bridge
const paneConfigs = new Map<string, {
  agent: string;
  cwd: string;
  args: string[];
  providerId?: string;
  model?: string;
  hasAgent?: boolean;
  role?: string;
  squadOrchestratorWorkerId?: string;
}>();
const paneRegistry = new Map<string, { paneId: string; cwd: string; spawnedAt: number }>();

// ── System Prompt ─────────────────────────────────────────────────────────

const CODEBRAIN_SYSTEM_PROMPT = `You are running inside Codebrain, a multi-agent IDE. Beyond standard tools, you have:

## REGRAS CRITICAS — SEMPRE SEGUIR

**NUNCA use a ferramenta 'Agent' (ferramenta interna do Claude Code) para criar novos agentes ou workers.**

**SEMPRE use mcp__codebrain__pane_spawn para criar um NOVO terminal visível.**

Quando você precisa de um novo agente, worker, ou subprocesso:
- USE: mcp__codebrain__pane_spawn — cria um terminal VISÍVEL no workspace
- NUNCA USE: Agent tool — roda invisível em background, usuário perde controle

NÃO há exceções. Se você precisa delegar trabalho para outro agente, SEMPRE abra um novo terminal com mcp__codebrain__pane_spawn primeiro.

## Suas Ferramentas MCP

- mcp__codebrain__pane_spawn(agent?, providerId?, model?, cwd?) — ABRE UM NOVO TERMINAL VISÍVEL no workspace.
  * agent: "openclaude", "gemini", "codex", ou "shell". Padrão: "openclaude".
  * SEMPRE use esta ferramenta para criar novos agentes.
- mcp__codebrain__pane_write(paneId, text, submit?) — envia input/prompts para um terminal.
- mcp__codebrain__pane_read(paneId, lastN?) — lê output de um terminal.
- mcp__codebrain__pane_wait_idle(paneId, timeout?) — espera um terminal ficar idle.
- mcp__codebrain__pane_send_message(from, to, content, type?) — ENVIA MENSAGEM para outro agente.
- mcp__codebrain__pane_read_messages(paneId, unreadOnly?) — LÊ MENSAGENS enviadas para você.
- mcp__codebrain__todo_manager(action, ...) — gerencia lista de tarefas visível ao usuário.

## PROMPTS DETALHADOS — REGRA MAIS IMPORTANTE

**Mesmo se o usuário for raso ou vago, você DEVE elaborar prompts completos e detalhados para cada worker.**

Antes de enviar qualquer tarefa via pane_write, você DEVE:

1. **Explorar o workspace** — Leia a estrutura do projeto, package.json, arquivos principais.
2. **Extrair convenções** — Identifique padrões do código existente (naming, estrutura, libs).
3. **Montar prompt completo** incluindo:
   - Contexto do projeto (stack, estrutura de pastas, o que faz)
   - Convenções do código (naming, organização, libs preferidas)
   - Caminhos exatos dos arquivos relevantes
   - Tarefa específica com exemplos concretos
   - Critérios de conclusão
   - Instrução para o worker atualizar seu entendimento

**NUNCA envie prompts vagos como "faça X". SEMPRE inclua contexto completo.**

O worker NÃO tem contexto do projeto. Sem prompt detalhado, ele vai inventar coisas, usar libs erradas, ou quebrar código existente.

## ⚡ COMUNICAÇÃO ENTRE AGENTES (MENSAGENS INTER-AGENTES)

**QUANDO VOCÊ VÊ UMA NOTIFICAÇÃO AMARELA NO TERMINAL (com linhas ═══ e ⚡):**
**PARE IMEDIATAMENTE** o que está fazendo. Leia a mensagem com pane_read_messages(SEU_PANE_ID). Responda ao remetente com pane_send_message. Depois continue seu trabalho.

**NUNCA IGNORE mensagens de outros agentes.**

**Use mcp__codebrain__pane_send_message e mcp__codebrain__pane_read_messages para:**
- Backend notifica Frontend sobre mudanças na API ("mudei o endpoint /users, agora retorna {id, name, email}")
- Frontend pergunta ao Backend sobre formato de dados
- Worker A avisa Worker B que mudou um arquivo compartilhado
- Workers coordenam dependências entre si

**Tipos de mensagem:**
- "update" — notificar sobre mudanças (API, schema, arquivos)
- "question" — perguntar algo a outro worker
- "result" — reportar conclusão de tarefa
- "task" — atribuir trabalho

**IMPORTANTE:** Sempre leia suas mensagens no INÍCIO do trabalho (pane_read_messages) para pegar atualizações de outros workers. Se receber uma mensagem DURANTE o trabalho, PARE e responda.

## Quando criar novos terminais (pane_spawn)

SEMPRE crie um novo terminal quando:
1. Precisa delegar trabalho para outro agente → pane_spawn + pane_write
2. Trabalho paralelo (frontend + backend, múltiplas tarefas) → múltiplos pane_spawn
3. Precisa de um modelo diferente → pane_spawn com model/providerId específicos
4. Tarefas longas que bloqueariam seu terminal → pane_spawn para rodar em paralelo
5. Shell tasks (build watchers, servidores) → pane_spawn com agent="shell"

## Como usar (operação padrão)

1. Para criar um agente: mcp__codebrain__pane_spawn(...) → retorna paneId
2. Para enviar tarefa: mcp__codebrain__pane_write(paneId, "prompt detalhado aqui", true)
3. Para esperar: mcp__codebrain__pane_wait_idle(paneId)
4. Para ler resultado: mcp__codebrain__pane_read(paneId)
5. Para enviar mensagem: mcp__codebrain__pane_send_message(from, to, content, type)
6. Para ler mensagens: mcp__codebrain__pane_read_messages(your_pane_id)

Loop de orquestração: pane_spawn → pane_write (PROMPT DETALHADO) → pane_wait_idle → pane_read
Comunicação direta: pane_send_message ↔ pane_read_messages

NUNCA implemente código você mesmo quando pode delegar via pane_spawn.
NUNCA use a ferramenta Agent interna — SEMPRE pane_spawn.

## Browser Control (28 tools)

Você tem controle TOTAL sobre o browser embutido do Codebrain. Use estas ferramentas para testar UI, navegar em apps, interagir com elementos, e verificar resultados visuais.

NUNCA use start, open, xdg-open, ou comandos do sistema para abrir URLs. SEMPRE use browser_open(url) — isso abre no browser embutido onde todos os agentes podem ver e interagir.

### OBRIGATÓRIO: Leia o guia antes de usar QUALQUER ferramenta de browser

ANTES de usar qualquer ferramenta de browser, você DEVE chamar browser_guide() primeiro.
Ele contém regras críticas como:
- NUNCA adivinhe rotas (/login, /dashboard) — leia o HTML da página e navegue via links do DOM
- NUNCA abra múltiplos browser panes — use um só e navegue com browser_navigate()
- SEMPRE leia a árvore de acessibilidade ou HTML antes de interagir
- Use seletores REAIS do DOM, não CSS selectors adivinhados

Ignorar o guia resultará em testes incorretos, 404s desperdiçados, e erros evitáveis.

### Navegação
- browser_navigate(url, pane_id?) — navega para URL
- browser_open(url) — abre NOVO browser pane
- browser_back() / browser_forward() / browser_reload(hard?)

### Leitura do DOM
- browser_get_html(selector?) — HTML bruto
- browser_get_text(selector?) — texto visível
- browser_get_accessibility_tree(max_depth?) — árvore semântica (ideal para AI)
- browser_find_by_text(text, role?, exact?) — encontra elemento por texto
- browser_get_element_info(selector) — info completa do elemento
- browser_get_url() — URL + título atual

### Interação com DOM
- browser_click(selector) — clica no elemento
- browser_fill(selector, value, clear_first?) — preenche input
- browser_select(selector, value_or_text) — seleciona opção
- browser_check(selector, checked?) — marca/desmarca checkbox
- browser_clear(selector) — limpa campo
- browser_focus(selector) — foca elemento
- browser_hover(selector) — hover (ativa :hover, tooltips)

### Interação por Coordenada
- browser_click_at(x, y, button?) — clica na coordenada
- browser_hover_at(x, y) — hover na coordenada
- browser_drag(x1, y1, x2, y2, steps?) — drag and drop
- browser_scroll(selector?, direction, amount) — rola página

### Teclado
- browser_type(text, delay_ms?) — digita texto
- browser_key(key) — pressiona tecla (Enter, Escape, Tab...)
- browser_shortcut(keys) — atalho (Ctrl+A, Ctrl+Shift+I...)

### Espera / Assertions
- browser_wait_for(selector, timeout_ms?) — espera elemento aparecer
- browser_wait_for_text(text, selector?, timeout_ms?) — espera texto
- browser_wait_for_url(pattern, timeout_ms?) — espera URL
- browser_wait_for_load(timeout_ms?) — espera carregar

### Screenshots
- browser_screenshot(full_page?) — captura tela → .codebrain/screenshots/
- browser_screenshot_element(selector) — captura elemento
- browser_annotate(path, annotations[]) — desenha sobre screenshot

### Logs
- browser_console_log(level?, since_ms?, limit?) — lê console
- browser_network_log(url_filter?, method?, status?, since_ms?) — lê rede
- browser_network_wait(pattern, method?, timeout_ms?) — espera requisição
- browser_eval(javascript) — executa JS direto

### Fluxo típico de teste UI
1. browser_guide() — OBRIGATÓRIO primeiro
2. browser_navigate("http://localhost:3000") — vai para a raiz, NUNCA adivinhe rotas
3. browser_wait_for_load() — espera carregar
4. browser_get_accessibility_tree() — entenda a página
5. Encontre o link/botão real no DOM (ex: browser_find_by_text("Users", "link"))
6. browser_click("a[href='/users']") — use o href REAL do DOM
7. browser_wait_for("[data-testid=user-list]", 5000)
8. browser_get_text() — verifica conteúdo
9. browser_network_log("POST /api/users") — verifica API call
10. browser_console_log("error") — verifica zero erros
11. browser_screenshot() — prova visual`.trim();

function getEnhancedProviders() {
  const list = providerStore.listPublic();
  const GEMINI_MODELS = [
    "gemini-3.1-pro", "gemini-3.1-flash-lite-preview",
    "gemini-3-flash-preview", "gemini-2.5-pro",
    "gemini-2.5-flash", "gemini-2.0-flash"
  ];
  const MIMO_MODELS = [
    "mimo-v2.5-pro", "mimo-v2.5", "mimo-v2-pro", "mimo-v2-omni", "mimo-v2-flash"
  ];
  
  return list
    .filter(p => p.id !== "claude-oauth" && !p.label?.includes("Gemini CLI"))
    .map(p => {
    const label = p.label?.toLowerCase() || "";
    const isMimo = label.includes("mimo") || p.id?.includes("mimo") || p.type === "mimo-compat";
    const isGemini = !isMimo && (p.type === "gemini-compat" || (p.env && p.env["GEMINI_API_KEY"]) || label.includes("gemini"));
    
    if (isMimo) {
      // For MIMO, we strictly want ONLY MIMO models
      return { ...p, host: "openclaude", models: [...MIMO_MODELS] };
    }
    
    if (isGemini) {
      // For Gemini, we strictly want ONLY Gemini models
      return { ...p, host: "openclaude", models: [...GEMINI_MODELS] };
    }
    
    return { ...p, host: p.host || "openclaude" };
  });
}
// ── Audio helpers ─────────────────────────────────────────────────────────────

function publicAudioConfig() {
  const cfg = audioConfigStore.read();
  const { apiKey: _k, ...rest } = cfg;
  return {
    ...rest,
    apiKeySet: cfg.apiKey.trim().length > 0,
    localReady: false, // local whisper not implemented
    clockVoiceAccess: { allowed: true, reason: "allowed" },
  };
}

function buildAudioPrompt(outputMode: string, basePrompt: string, context: string): string {
  const parts = [
    outputMode === "english"
      ? "The audio is usually Brazilian Portuguese dictation for a software task. Translate it to clear English without adding commentary."
      : "",
    basePrompt.trim(),
    context
      ? `${outputMode === "english" ? "Previous translated context" : "Previous context"}: ${context}`
      : "",
  ].filter(Boolean);
  return parts.join("\n").slice(0, 900);
}

async function transcribeWithGroq(
  args: { bytes: ArrayBuffer | Buffer; mimeType?: string; context?: string },
  cfg: AudioConfig,
): Promise<{ ok: boolean; text?: string; error?: string }> {
  if (!cfg.apiKey.trim()) return { ok: false, error: "groq api key missing" };

  const bytes = Buffer.isBuffer(args.bytes) ? args.bytes : Buffer.from(args.bytes as ArrayBuffer);
  if (bytes.length === 0) return { ok: false, error: "empty audio" };

  const mimeType = args.mimeType || "audio/webm";
  const ext = mimeType.includes("ogg")
    ? "ogg"
    : mimeType.includes("mp4")
      ? "mp4"
      : mimeType.includes("wav")
        ? "wav"
        : "webm";
  const route = cfg.outputMode === "english" ? "translations" : "transcriptions";
  const endpoint = `${cfg.baseUrl.replace(/\/+$/, "")}/audio/${route}`;
  const context = typeof args.context === "string" ? args.context.trim() : "";
  const prompt = buildAudioPrompt(cfg.outputMode, cfg.prompt, context);

  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType }), `codebrain-voice.${ext}`);
  form.append("model", cfg.model);
  form.append("response_format", "json");
  form.append("temperature", "0");
  if (cfg.outputMode !== "english" && cfg.language.trim())
    form.append("language", cfg.language.trim());
  if (prompt) form.append("prompt", prompt);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.apiKey}` },
      body: form,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `groq ${res.status}: ${body.slice(0, 220)}` };
    }
    const data = (await res.json().catch(() => null)) as { text?: string } | null;
    const text = typeof data?.text === "string" ? data.text.trim() : "";
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

let mainWindow: BrowserWindow | null = null;

function safeSend(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

// ── Recent Workspaces ────────────────────────────────────────────────────────

function readRecentWorkspaces(): string[] {
  try { return JSON.parse(fs.readFileSync(WORKSPACES_FILE, "utf-8")); } catch { return []; }
}

function saveRecentWorkspaces(workspaces: string[]): void {
  try { fs.writeFileSync(WORKSPACES_FILE, JSON.stringify(workspaces, null, 2), "utf-8"); } catch {}
}

function touchWorkspace(wsPath: string): void {
  const list = readRecentWorkspaces().filter((p) => p !== wsPath);
  saveRecentWorkspaces([wsPath, ...list].slice(0, 20));
}

// ── Window ───────────────────────────────────────────────────────────────────

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#000000",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#0c0c14",
      symbolColor: "#94a3b8",
      height: 38
    },
    trafficLightPosition: { x: 14, y: 14 },
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  win.once("ready-to-show", () => win.show());

  win.webContents.on("before-input-event", (_event, input) => {
    if (input.type === "keyDown" && input.key === "F12") {
      if (win.webContents.isDevToolsOpened()) {
        win.webContents.closeDevTools();
      } else {
        win.webContents.openDevTools();
      }
    }
  });

  // Dev: load Vite dev server; prod: load built HTML
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  win.on("close", (e) => {
    if (isUpdateInstallRequested()) return;
    // Allow normal close
  });

  return win;
}

// ── Spawn Pane Internal ──────────────────────────────────────────────────────
// Shared logic for both IPC handler and MCP bridge. Handles provider resolution,
// env setup, CLI flag injection, and system prompt injection.

async function spawnPaneInternal(config: {
  agent?: string;
  providerId?: string;
  model?: string;
  cwd?: string;
  paneId?: string;
  args?: string[];
  permissionMode?: string;
  claudeSessionId?: string;
  squadOrchestratorWorkerId?: string;
  role?: string;
  sessionContext?: string;
  env?: Record<string, string>;
}): Promise<{ ok: boolean; paneId?: string; providerId?: string; error?: string }> {
  try {
    const cwd = config.cwd ?? currentWorkspacePath;

    // Provider inheritance from last spawned pane
    let agent = config.agent;
    let providerId = config.providerId;
    let model = config.model;

    if (!agent || !providerId || !model) {
      let latest = 0;
      let callerCfg: typeof paneConfigs extends Map<string, infer V> ? V : never | null = null;
      for (const [pid, pcfg] of paneConfigs) {
        const reg = paneRegistry.get(pid);
        if (reg && reg.spawnedAt > latest) {
          latest = reg.spawnedAt;
          callerCfg = pcfg;
        }
      }
      if (callerCfg) {
        if (!agent) agent = (callerCfg as any).agent;
        if (!providerId && (!agent || agent === (callerCfg as any).agent)) providerId = (callerCfg as any).providerId;
        if (!model && (!agent || agent === (callerCfg as any).agent)) model = (callerCfg as any).model;
      }
    }

    if (!agent) agent = "openclaude";

    // ── Hardcoded model-to-provider-type mapping (mirrors getEnhancedProviders) ──
    const ENHANCED_MODEL_MAP: Record<string, string[]> = {
      "gemini-compat": [
        "gemini-3.1-pro", "gemini-3.1-pro-preview", "gemini-3.1-pro-preview-customtools",
        "gemini-3.1-flash-lite-preview", "gemini-3-flash-preview", "gemini-3-flash",
        "gemini-3.1-flash-lite", "gemini-3.1-flash-live-preview",
        "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"
      ],
      "mimo-compat": [
        "mimo-v2.5-pro", "mimo-v2.5", "mimo-v2-pro", "mimo-v2-omni", "mimo-v2-flash"
      ],
      "anthropic-compat": [
        "claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5-20251101",
        "claude-opus-4-1-20250805", "claude-opus-4-20250514",
        "claude-sonnet-4-6", "claude-sonnet-4-5-20250929", "claude-sonnet-4-20250514",
        "claude-3-7-sonnet-20250219", "claude-3-5-sonnet-20241022",
        "claude-haiku-4-5-20251001", "claude-3-5-haiku-20241022"
      ],
    };

    /** Determine provider type from model name using enhanced/hardcoded lists. */
    function getProviderTypeForModel(m: string): string | null {
      for (const [type, models] of Object.entries(ENHANCED_MODEL_MAP)) {
        if (models.includes(m)) return type;
      }
      // Prefix-based fallback for unknown models
      if (m.startsWith("gemini-")) return "gemini-compat";
      if (m.startsWith("mimo-")) return "mimo-compat";
      if (m.startsWith("claude-")) return "anthropic-compat";
      return null;
    }

    // Provider auto-detection based on agent type
    let provider = providerId ? providerStore.listFull().find((p) => p.id === providerId) ?? null : null;

    if (!provider && agent) {
      const allProviders = providerStore.listFull();
      if (agent === "gemini") {
        provider = allProviders.find((p) => p.host === "gemini" || p.id?.toLowerCase().includes("gemini")) ?? null;
      } else if (agent === "openclaude" || agent === "claude") {
        // Step 1: If a model is specified, find provider by enhanced model lists first
        if (model) {
          // 1a. Try raw store match (provider.models includes the model)
          provider = allProviders.find((p) => p.models?.includes(model)) ?? null;

          // 1b. If no raw match, use enhanced model map to determine provider type
          if (!provider) {
            const targetType = getProviderTypeForModel(model);
            if (targetType) {
              provider = allProviders.find((p) => p.type === targetType) ?? null;
              if (provider) {
                log.info(`[spawnPaneInternal] Model "${model}" matched to provider type "${targetType}" via enhanced map → provider "${provider.id}"`);
              }
            }
          }
        }

        // Step 2: Fallback cascade (only when no model was specified, or model type couldn't be determined)
        if (!provider && !model) {
          provider = allProviders.find((p) => p.type === "mimo-compat") ?? null;
          if (!provider) provider = allProviders.find((p) => p.type === "anthropic-compat") ?? null;
          if (!provider) provider = allProviders.find((p) => p.type === "gemini-compat") ?? null;
          if (!provider) provider = allProviders.find((p) => p.host === "openclaude") ?? null;
        }
      }
      if (provider) {
        providerId = provider.id;
      }
    }

    // Validate model exists in provider's model list
    if (provider && model) {
      const providerModels = provider.models ?? [];
      if (providerModels.length > 0 && !providerModels.includes(model)) {
        // Before silently replacing, check if another provider actually has this model
        const targetType = getProviderTypeForModel(model);
        if (targetType && targetType !== provider.type) {
          const betterProvider = providerStore.listFull().find((p) => p.type === targetType);
          if (betterProvider) {
            log.info(`[spawnPaneInternal] Model "${model}" belongs to "${targetType}", switching from provider "${provider.id}" to "${betterProvider.id}"`);
            provider = betterProvider;
            providerId = betterProvider.id;
          } else {
            log.warn(`[spawnPaneInternal] Model "${model}" not found in provider "${provider.id}". Available: ${providerModels.join(", ")}. Falling back to first model.`);
            model = providerModels[0];
          }
        } else {
          log.warn(`[spawnPaneInternal] Model "${model}" not found in provider "${provider.id}". Available: ${providerModels.join(", ")}. Falling back to first model.`);
          model = providerModels[0];
        }
      }
    } else if (provider && !model && provider.models?.length > 0) {
      model = provider.models[0];
    }

    const env: Record<string, string> = { ...(provider?.env ?? {}), ...(config.env ?? {}) };

    // Build args
    const args = [...(config.args ?? [])];
    const isClaudeCompatible = agent === "openclaude" || agent === "claude" || agent === "gemini";

    // Permission mode
    if (isClaudeCompatible && !args.includes("--permission-mode")) {
      const mode = config.permissionMode ?? "bypassPermissions";
      args.push("--permission-mode", mode);
    }

    // Resume session
    if (isClaudeCompatible && config.claudeSessionId && !args.includes("--resume")) {
      args.push("--resume", config.claudeSessionId);
    }

    // MCP config — wait for server if not ready yet
    if (isClaudeCompatible && !mcpServerInfo && mcpServerReady) {
      try { await mcpServerReady; } catch {}
    }
    if (isClaudeCompatible && mcpServerInfo && !args.includes("--mcp-config")) {
      const mcpConfigPath = path.join(cwd, ".mcp.json");
      try {
        // Always rewrite to ensure correct format
        fs.writeFileSync(mcpConfigPath, JSON.stringify({
          mcpServers: {
            codebrain: {
              type: "sse",
              url: mcpServerInfo.sseUrl,
            },
          },
        }, null, 2), "utf-8");
      } catch {}
      args.push("--mcp-config", mcpConfigPath);
    }

    // Pre-generate paneId so we can include it in the system prompt
    const { nanoid } = await import("nanoid");
    const paneId = config.paneId ?? nanoid();

    // System prompt injection
    if (isClaudeCompatible && !args.includes("--system-prompt")) {
      let sysPrompt = CODEBRAIN_SYSTEM_PROMPT;

      // Inject workspace directory so the agent knows where it is
      sysPrompt += `\n\n## Seu Workspace\n\nVocê está trabalhando no diretório:\n\`${cwd}\`\n\nTodos os caminhos de arquivo são relativos a este diretório. Ao criar, ler ou editar arquivos, use este diretório como base.`;

      // Inject paneId so the agent knows its own ID for inter-agent messaging
      sysPrompt += `\n\n## Seu ID de Pane\n\nSeu paneId é: \`${paneId}\`\n\nUse este ID como campo "from" ao enviar mensagens via pane_send_message, e como campo "paneId" ao ler mensagens via pane_read_messages.`;

      // Inject role-specific prompt based on role and model
      let rolePrompt = "";
      if (config.role === "orchestrator") {
        rolePrompt = ORCHESTRATOR_PROMPT;
      } else if (config.role === "ui-tester") {
        rolePrompt = UI_TESTER_PROMPT || WORKER_PROMPT;
      } else if (model && model.startsWith("gemini")) {
        rolePrompt = GEMINI_WORKER_PROMPT || WORKER_PROMPT;
      } else {
        rolePrompt = WORKER_PROMPT;
      }
      if (rolePrompt) {
        sysPrompt += `\n\n---\n\n${rolePrompt}`;
      }

      // Inject session resume context if restoring a session
      if (config.sessionContext) {
        sysPrompt += `\n\n---\n\n${config.sessionContext}`;
      }

      // Build providers info for orchestrator
      const allProviders = providerStore.listFull();
      const providersInfo = allProviders
        .filter((p) => p.id !== "claude-oauth")
        .map((p) => {
          const models = p.models?.join(", ") || "nenhum modelo listado";
          return `* ${p.label} (id: "${p.id}", type: "${p.type}"): ${models}`;
        })
        .join("\n");

      sysPrompt += `\n\n## Providers e Modelos Disponíveis\n\n${providersInfo}`;

      // Version 0.10.0 uses --system-prompt and does not support file-based prompts
      args.push("--system-prompt", sysPrompt);
    }

    // Provider-specific env vars
    const providerType = provider?.type;
    const isMimo = providerType === "mimo-compat";
    const isOpenAICompat = providerType === "openai-compat";
    const isGeminiCompat = providerType === "gemini-compat";
    const isAnthropicCompat = providerType === "anthropic-compat";

    if (isClaudeCompatible) {
      if (provider?.label) env["CLAUDE_CODE_PROVIDER_NAME"] = provider.label;
      if (model) env["CLAUDE_CODE_MODEL_NAME"] = model;
      // Prevent openclaude v0.10 from overriding our --provider with Codex
      // defaults in buildStartupEnvFromProfile when no saved profile exists.
      if (provider) env["CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED"] = "1";

      // Ensure openclaude uses correct provider flag if needed
      if (provider?.type) {
        if (!args.includes("--provider")) {
          // Map provider types to openclaude provider arg values
          let providerArg = "";
          switch (provider.type as string) {
            case "openai-compat": providerArg = "openai"; break;
            case "gemini-compat": providerArg = "gemini"; break;
            case "bedrock-compat": providerArg = "bedrock"; break;
            case "vertex-compat": providerArg = "vertex"; break;
            case "ollama-compat": providerArg = "ollama"; break;
            case "anthropic-compat":
            case "anthropic":
              providerArg = "anthropic"; break;
            case "mimo-compat":
              // Don't set --provider for MIMO; OpenClaude detects it via MIMO_API_KEY + OPENAI_BASE_URL
              break;
            case "custom":
            case "oauth":
            case "api-key":
            case "env":
              break;
            default: break;
          }
          if (providerArg) args.push("--provider", providerArg);
        }
      }

      if (isMimo) {
        // User key is stored as ANTHROPIC_AUTH_TOKEN (form field for mimo-compat).
        // OpenClaude MIMO needs: MIMO_API_KEY + OPENAI_BASE_URL.
        if (model) {
          env["MODEL"] = model;
          env["ANTHROPIC_MODEL"] = model;
          env["OPENAI_MODEL"] = model;
          if (!args.includes("--model")) args.push("--model", model);
        }
        if (provider?.baseUrl) {
          env["ANTHROPIC_BASE_URL"] = provider.baseUrl;
          env["OPENAI_BASE_URL"] = provider.baseUrl;
        }
        // Sync keys: ANTHROPIC_AUTH_TOKEN ↔ MIMO_API_KEY ↔ OPENAI_API_KEY
        const mimoKey = env["ANTHROPIC_AUTH_TOKEN"] || env["MIMO_API_KEY"] || "";
        if (mimoKey) {
          env["ANTHROPIC_AUTH_TOKEN"] = mimoKey;
          env["MIMO_API_KEY"] = mimoKey;
          env["OPENAI_API_KEY"] = mimoKey;
        }
      } else if (isGeminiCompat) {
        env["CLAUDE_CODE_USE_GEMINI"] = "1";
        if (model) env["GEMINI_MODEL"] = model;
        if (env["GEMINI_BASE_URL"]) env["CLAUDE_CODE_DISABLE_PROXY"] = "1";
      } else if (isOpenAICompat) {
        // User key is stored as OPENAI_API_KEY (form field for openai-compat).
        // Map to provider-specific env vars that OpenClaude expects.
        if (model) {
          env["MODEL"] = model;
          env["OPENAI_MODEL"] = model;
        }
        if (provider?.baseUrl) env["OPENAI_BASE_URL"] = provider.baseUrl;
        const base = provider?.baseUrl?.toLowerCase() ?? "";
        const openaiKey = env["OPENAI_API_KEY"] || "";
        if (openaiKey) {
          if (base.includes("x.ai")) env["XAI_API_KEY"] = openaiKey;
          if (base.includes("deepseek")) env["DEEPSEEK_API_KEY"] = openaiKey;
        }
      } else if (isAnthropicCompat) {
        if (model) {
          env["MODEL"] = model;
          env["ANTHROPIC_MODEL"] = model;
        }
      }
    }

    // Inject MCP server URL for openclaude agents
    if (mcpServerInfo && (agent === "openclaude" || agent === "claude")) {
      env["CODEBRAIN_MCP_URL"] = mcpServerInfo.streamableHttpUrl;
      env["CODEBRAIN_MCP_SSE_URL"] = mcpServerInfo.sseUrl;
      env["CODEBRAIN_MCP_PORT"] = String(mcpServerInfo.port);
    }

    // Settings for anthropic-compat
    if (isClaudeCompatible && isAnthropicCompat && !args.includes("--settings")) {
      const settings: Record<string, unknown> = { alwaysThinkingEnabled: false, effortLevel: "low" };
      if (model) settings.model = model;
      args.push("--settings", JSON.stringify(settings));
    }

    log.info("[spawnPaneInternal]", { agent, providerId, model, providerType, cwd });
    if (isMimo) {
      log.info("[spawnPaneInternal] MIMO env keys:", Object.keys(env));
      log.info("[spawnPaneInternal] MIMO ANTHROPIC_AUTH_TOKEN:", env["ANTHROPIC_AUTH_TOKEN"] ? "SET" : "MISSING");
      log.info("[spawnPaneInternal] MIMO MIMO_API_KEY:", env["MIMO_API_KEY"] ? "SET" : "MISSING");
      log.info("[spawnPaneInternal] MIMO ANTHROPIC_BASE_URL:", env["ANTHROPIC_BASE_URL"] ?? "MISSING");
      log.info("[spawnPaneInternal] MIMO ANTHROPIC_MODEL:", env["ANTHROPIC_MODEL"] ?? "MISSING");
    }

    const spawnedPaneId = await ptyManager.spawn({
      paneId,
      agent: agent as any,
      cwd,
      args,
      env,
      permissionMode: config.permissionMode,
      claudeSessionId: config.claudeSessionId,
      role: config.role,
    });


    // Track pane config
    paneConfigs.set(paneId, {
      agent,
      cwd,
      args,
      providerId: providerId ?? undefined,
      model: model ?? undefined,
      role: config.role,
      squadOrchestratorWorkerId: config.squadOrchestratorWorkerId,
    });
    paneRegistry.set(paneId, { paneId, cwd, spawnedAt: Date.now() });

    // Notify renderer
    safeSend("pane:added", {
      paneId,
      agent,
      cwd,
      providerId: providerId ?? undefined,
      model: model ?? undefined,
    });

    return { ok: true, paneId, providerId: providerId ?? undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Browser Control Infrastructure ───────────────────────────────────────────
// Request/response map for commands sent to the renderer's BrowserPane webviews.
// Main sends 'codebrain:browser:cmd' via webContents.send(), renderer responds
// with ipcRenderer.send('codebrain:browser:result').

const browserPending = new Map<string, { resolve: (value: unknown) => void; timer: NodeJS.Timeout }>();
const browserPaneIds = new Set<string>(); // track browser pane IDs (not PTY panes)

// In-memory stores for network/console logs (populated by interceptor + renderer)
const browserNetworkLog: Array<{ id: string; timestamp: number; method: string; url: string; status: number; [key: string]: unknown }> = [];
const browserConsoleLog: Array<{ id: string; timestamp: number; level: string; message: string; source?: string }> = [];
const BROWSER_LOG_MAX = 2000;

function sendBrowserCmd(paneId: string, cmd: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  return new Promise((resolve, reject) => {
    if (!mainWindow) { reject(new Error("no main window")); return; }
    const requestId = `br_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timer = setTimeout(() => {
      browserPending.delete(requestId);
      reject(new Error("browser command timeout"));
    }, 30000);
    browserPending.set(requestId, { resolve: resolve as (v: unknown) => void, timer });
    safeSend("codebrain:browser:cmd", { ...cmd, requestId, paneId });
  });
}

function getNetworkLog(paneId?: string, urlFilter?: string, method?: string, status?: string, sinceMs?: number, limit?: number) {
  let entries = browserNetworkLog;
  if (urlFilter) entries = entries.filter(e => e.url.includes(urlFilter));
  if (method) entries = entries.filter(e => e.method === method.toUpperCase());
  if (status) {
    if (status.endsWith("xx")) {
      const prefix = parseInt(status);
      entries = entries.filter(e => Math.floor((e.status as number) / 100) === prefix);
    } else {
      entries = entries.filter(e => e.status === parseInt(status));
    }
  }
  if (sinceMs) entries = entries.filter(e => e.timestamp > Date.now() - sinceMs);
  if (limit) entries = entries.slice(-limit);
  // Return compact entries — keep enough body for AI agents to analyze API payloads
  return entries.map(e => {
    const base = {
      id: e.id,
      timestamp: e.timestamp,
      durationMs: e.durationMs,
      method: e.method,
      url: e.url,
      type: e.type,
      status: e.status,
      statusText: e.statusText,
      ok: e.ok,
      error: e.error,
      requestBody: typeof e.requestBody === 'string' ? e.requestBody.substring(0, 2000) : e.requestBody,
      responseBody: typeof e.responseBody === 'string' ? e.responseBody.substring(0, 5000) : e.responseBody,
    };
    // WebSocket entries: include data, wsId, code, reason
    if (e.type === 'ws_send' || e.type === 'ws_message' || e.type === 'ws_open' || e.type === 'ws_close' || e.type === 'ws_error') {
      base.wsId = e.wsId;
      base.data = typeof e.data === 'string' ? e.data.substring(0, 5000) : e.data;
      if (e.code !== undefined) base.code = e.code;
      if (e.reason) base.reason = e.reason;
    }
    return base;
  });
}

function getConsoleLog(paneId?: string, level?: string, sinceMs?: number, limit?: number) {
  let entries = browserConsoleLog;
  if (level) entries = entries.filter(e => e.level === level);
  if (sinceMs) entries = entries.filter(e => e.timestamp > Date.now() - sinceMs);
  if (limit) entries = entries.slice(-limit);
  return entries;
}

function clearBrowserLogs(paneId?: string) {
  browserNetworkLog.length = 0;
  browserConsoleLog.length = 0;
}

function resolveBrowserPaneId(paneId?: string): string | null {
  if (paneId && browserPaneIds.has(paneId)) return paneId;
  if (paneId) return paneId;
  const ids = Array.from(browserPaneIds);
  return ids.length > 0 ? ids[ids.length - 1] : null;
}

async function saveScreenshot(paneId?: string, fullPage?: boolean): Promise<{ ok: boolean; path?: string; error?: string }> {
  const pid = resolveBrowserPaneId(paneId);
  if (!pid) return { ok: false, error: "no browser pane" };
  try {
    const screenshotDir = path.join(currentWorkspacePath, ".codebrain", "screenshots");
    fs.mkdirSync(screenshotDir, { recursive: true });
    const screenshotPath = path.join(screenshotDir, `${Date.now()}.png`);
    const result = await sendBrowserCmd(pid, { type: "screenshot", fullPage });
    const res = result?.result as { dataUrl?: string } | undefined;
    if (result?.ok && res?.dataUrl) {
      const base64 = res.dataUrl.split(",")[1];
      if (base64) fs.writeFileSync(screenshotPath, Buffer.from(base64, "base64"));
      return { ok: true, path: screenshotPath };
    }
    return { ok: false, error: result?.error || "screenshot failed" };
  } catch (err) { return { ok: false, error: String(err) }; }
}

async function saveScreenshotElement(selector: string, paneId?: string): Promise<{ ok: boolean; path?: string; bounds?: unknown; error?: string }> {
  const pid = resolveBrowserPaneId(paneId);
  if (!pid) return { ok: false, error: "no browser pane" };
  try {
    const screenshotDir = path.join(currentWorkspacePath, ".codebrain", "screenshots");
    fs.mkdirSync(screenshotDir, { recursive: true });
    const screenshotPath = path.join(screenshotDir, `${Date.now()}_${selector.replace(/[^a-zA-Z0-9]/g, '_')}.png`);
    const result = await sendBrowserCmd(pid, { type: "screenshot-el", selector });
    const res = result?.result as { dataUrl?: string; bounds?: unknown } | undefined;
    if (result?.ok && res?.dataUrl) {
      const base64 = res.dataUrl.split(",")[1];
      if (base64) fs.writeFileSync(screenshotPath, Buffer.from(base64, "base64"));
      return { ok: true, path: screenshotPath, bounds: res.bounds };
    }
    return { ok: false, error: result?.error || "screenshot failed" };
  } catch (err) { return { ok: false, error: String(err) }; }
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────

function registerIpcHandlers(): void {
  // ── App ──────────────────────────────────────────────────────────────────
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:copy-to-clipboard", (_evt, text) => {
    const { clipboard } = require("electron");
    clipboard.writeText(text);
    return true;
  });
  ipcMain.handle("app:reload-shell", () => {
    mainWindow?.webContents.reload();
  });

  // ── PTY ──────────────────────────────────────────────────────────────────
  ipcMain.handle("pty:spawn", async (_event, config) => {
    return spawnPaneInternal(config);
  });

  ipcMain.handle("pty:write", async (_event, paneId: string, data: string) => {
    try { ptyManager.write(paneId, data); return { ok: true }; }
    catch (err) { return { ok: false, error: String(err) }; }
  });

  ipcMain.handle("pty:read", async (_event, paneId: string, lastN?: number) => {
    try { return { ok: true, lines: ptyManager.read(paneId, lastN) }; }
    catch (err) { return { ok: false, lines: [], error: String(err) }; }
  });

  ipcMain.handle("pty:readRaw", async (_event, paneId: string, lastN?: number) => {
    try { return { ok: true, lines: ptyManager.readRaw(paneId, lastN) }; }
    catch (err) { return { ok: false, lines: [], error: String(err) }; }
  });

  ipcMain.handle("pty:readRawText", async (_event, paneId: string) => {
    try { return { ok: true, text: ptyManager.readRawText(paneId) }; }
    catch (err) { return { ok: false, text: "", error: String(err) }; }
  });

  ipcMain.handle("pty:kill", async (_event, paneId: string) => {
    try { ptyManager.kill(paneId); return { ok: true }; }
    catch (err) { return { ok: false, error: String(err) }; }
  });

  ipcMain.handle("pty:list", async () => {
    return { ok: true, panes: ptyManager.list() };
  });

  ipcMain.handle("pty:resize", async (_event, paneId: string, cols: number, rows: number) => {
    try { ptyManager.resize(paneId, cols, rows); return { ok: true }; }
    catch (err) { return { ok: false, error: String(err) }; }
  });

  // ── Workspace ────────────────────────────────────────────────────────────
  ipcMain.handle("workspace:open", async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "Open Workspace",
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const wsPath = result.filePaths[0];
    currentWorkspacePath = wsPath;
    touchWorkspace(wsPath);
    return wsPath;
  });

  ipcMain.handle("workspace:set", async (_event, dir: string) => {
    currentWorkspacePath = dir;
    touchWorkspace(dir);
  });

  ipcMain.handle("workspace:save", async (_event, config: Record<string, unknown>) => {
    // Save workspace-level config
  });

  ipcMain.handle("workspaces:recent", async () => readRecentWorkspaces());
  ipcMain.handle("workspaces:touch", async (_event, wsPath: string) => touchWorkspace(wsPath));
  ipcMain.handle("workspaces:remove", async (_event, wsPath: string) => {
    const list = readRecentWorkspaces().filter((p) => p !== wsPath);
    saveRecentWorkspaces(list);
  });

  ipcMain.handle("workspace:scan", async (_event, wsPath: string) => {
    try {
      const entries = fs.readdirSync(wsPath, { withFileTypes: true });
      return entries.map((e) => ({
        name: e.name,
        path: path.join(wsPath, e.name),
        isDirectory: e.isDirectory(),
        extension: e.isFile() ? path.extname(e.name) : undefined,
      }));
    } catch { return []; }
  });

  // ── Files ─────────────────────────────────────────────────────────────────
  ipcMain.handle("files:list", async (_event, wsPath: string, subPath = "") => {
    try {
      const dir = subPath ? path.join(wsPath, subPath) : wsPath;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      return entries.map((e) => ({
        name: e.name,
        path: path.join(dir, e.name),
        isDirectory: e.isDirectory(),
        extension: e.isFile() ? path.extname(e.name) : undefined,
      }));
    } catch { return []; }
  });

  ipcMain.handle("files:read", async (_event, wsPath: string, relPath: string) => {
    return fs.readFileSync(path.join(wsPath, relPath), "utf-8");
  });

  ipcMain.handle("files:write", async (_event, wsPath: string, relPath: string, content: string) => {
    const full = path.join(wsPath, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf-8");
  });

  ipcMain.handle("files:saveDropped", async (_event, name: string, bytes: ArrayBuffer) => {
    const dest = path.join(os.tmpdir(), name);
    fs.writeFileSync(dest, Buffer.from(bytes));
    return dest;
  });

  // ── Providers ─────────────────────────────────────────────────────────────
  ipcMain.handle("providers:list", () => getEnhancedProviders());
  ipcMain.handle("providers:save", (_event, provider) => providerStore.upsert(provider));
  ipcMain.handle("providers:delete", (_event, id: string) => providerStore.remove(id));
  ipcMain.handle("providers:templates", () => BUILTIN_TEMPLATES);
  ipcMain.handle("providers:testToken", async (_event, args: { providerId: string; token: string }) => {
    // Implement token validation logic here
    return { ok: true };
  });

  providerStore.onChange(() => {
    safeSend("providers:updated", getEnhancedProviders());
  });

  // ── Workspace / App Config ─────────────────────────────────────────────────
  ipcMain.handle("workspaceConfig:get", (_event, wsPath: string) => workspaceConfigStore.get(wsPath));
  ipcMain.handle("workspaceConfig:set", (_event, wsPath: string, cfg: Record<string, unknown>) => {
    workspaceConfigStore.set(wsPath, cfg);
  });
  ipcMain.handle("appConfig:get", () => configStore.get());
  ipcMain.handle("appConfig:set", (_event, patch: Record<string, unknown>) => configStore.set(patch));

  // ── CLI ───────────────────────────────────────────────────────────────────
  ipcMain.handle("cli:detect", () => cliDetector.getAll());
  ipcMain.handle("cli:redetect", () => {
    const info = cliDetector.redetect();
    return [
      { name: "openclaude", found: info.openclaude.found, path: info.openclaude.path, version: info.openclaude.version },
    ];
  });
  ipcMain.handle("cli:install", async () => {
    const { execSync, spawn } = require("node:child_process") as typeof import("node:child_process");
    const IS_WIN = process.platform === "win32";

    // Verify npm is available before attempting install
    let npmPath: string | null = null;
    try {
      const out = execSync(IS_WIN ? "where npm" : "which npm", {
        encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      npmPath = out.split(/\r?\n/)[0]?.trim() || null;
    } catch {
      npmPath = null;
    }

    if (!npmPath) {
      return {
        ok: false,
        error: "npm não foi encontrado no PATH. Instale o Node.js em nodejs.org e tente novamente.",
      };
    }

    const TIMEOUT_MS = 120_000;

    return new Promise<{ ok: boolean; error?: string; info?: object }>((resolve) => {
      // On Windows use shell:true with "npm" by name — avoids path-with-spaces issues
      // with .cmd files. On Linux spawn the resolved binary directly.
      const child = spawn(
        IS_WIN ? "npm" : npmPath!,
        ["install", "-g", "@gitlawb/openclaude"],
        { stdio: ["ignore", "pipe", "pipe"], shell: IS_WIN },
      );

      let stderr = "";
      let done = false;
      child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        try { child.kill(); } catch {}
        resolve({ ok: false, error: "Timeout: a instalação demorou mais de 2 minutos. Verifique sua conexão e tente novamente." });
      }, TIMEOUT_MS);

      child.on("close", (code: number | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const info = cliDetector.redetect();
        if (code === 0) {
          resolve({
            ok: true,
            info: { name: "openclaude", found: info.openclaude.found, path: info.openclaude.path, version: info.openclaude.version },
          });
        } else {
          resolve({ ok: false, error: stderr.trim() || `npm install saiu com código ${code}` });
        }
      });

      child.on("error", (err: Error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ ok: false, error: err.message });
      });
    });
  });
  ipcMain.handle("shells:list", () => cliDetector.detectShells());

  // ── Notifications ─────────────────────────────────────────────────────────
  ipcMain.on("notify", (_event, title: string, body: string) => {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  });

  // ── Browser Control ───────────────────────────────────────────────────────
  // Response handler — renderer sends results back for pending commands
  ipcMain.on("codebrain:browser:result", (_event, payload: { requestId: string; ok: boolean; result?: unknown; error?: string }) => {
    const pending = browserPending.get(payload.requestId);
    if (pending) {
      clearTimeout(pending.timer);
      browserPending.delete(payload.requestId);
      pending.resolve({ ok: payload.ok, result: payload.result, error: payload.error });
    }
  });

  // Console entries from renderer (forwarded from webview postMessage)
  ipcMain.on("codebrain:browser:console-entry", (_event, entry: { id: string; timestamp: number; level: string; message: string; source?: string }) => {
    browserConsoleLog.push(entry);
    if (browserConsoleLog.length > BROWSER_LOG_MAX) browserConsoleLog.splice(0, browserConsoleLog.length - BROWSER_LOG_MAX);
  });

  // Network entries from JS-level interceptor (fetch/XHR/WebSocket captured in webview)
  ipcMain.on("codebrain:browser:network-entry-js", (_event, entry: { id: string; timestamp: number; method: string; url: string; status: number; [key: string]: unknown }) => {
    browserNetworkLog.push(entry);
    if (browserNetworkLog.length > BROWSER_LOG_MAX) browserNetworkLog.splice(0, browserNetworkLog.length - BROWSER_LOG_MAX);
  });

  // Renderer registers browser pane IDs here when they're created
  ipcMain.on("codebrain:browser:pane-created", (_event, paneId: string) => {
    browserPaneIds.add(paneId);
  });
  ipcMain.on("codebrain:browser:pane-destroyed", (_event, paneId: string) => {
    browserPaneIds.delete(paneId);
  });

  // Navigate
  ipcMain.handle("browser:navigate", async (_event, url: string, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane found" };
    try { return await sendBrowserCmd(pid, { type: "navigate", url }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });

  // Open (create new browser pane via renderer + navigate)
  ipcMain.handle("browser:open", async (_event, url: string) => {
    try {
      // Tell the renderer to create a browser pane — it will respond with the paneId
      // via codebrain:browser:pane-created IPC
      const paneId = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timeout creating browser pane")), 10000);
        const handler = (_evt: unknown, createdPaneId: string) => {
          clearTimeout(timer);
          ipcMain.off("codebrain:browser:pane-created", handler);
          resolve(createdPaneId);
        };
        ipcMain.on("codebrain:browser:pane-created", handler);
        safeSend("codebrain:browser:create-pane", { url });
      });
      browserPaneIds.add(paneId);
      // Wait for webview to initialize
      await new Promise(r => setTimeout(r, 1000));
      const navResult = await sendBrowserCmd(paneId, { type: "navigate", url });
      return { ...navResult, paneId };
    } catch (err) { return { ok: false, error: String(err) }; }
  });

  // Back/Forward/Reload
  ipcMain.handle("browser:back", async (_event, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "back" }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });
  ipcMain.handle("browser:forward", async (_event, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "forward" }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });
  ipcMain.handle("browser:reload", async (_event, hard?: boolean, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "reload", hard }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });

  // DOM reading
  ipcMain.handle("browser:get-html", async (_event, selector?: string, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "get-html", selector }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });
  ipcMain.handle("browser:get-text", async (_event, selector?: string, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "get-text", selector }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });
  ipcMain.handle("browser:get-a11y-tree", async (_event, maxDepth?: number, maxNodes?: number, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "get-a11y-tree", maxDepth, maxNodes }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });
  ipcMain.handle("browser:find-by-text", async (_event, text: string, role?: string, exact?: boolean, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "find-by-text", text, role, exact }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });
  ipcMain.handle("browser:get-element", async (_event, selector: string, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "get-element", selector }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });
  ipcMain.handle("browser:get-url", async (_event, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "get-url" }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });

  // DOM interaction
  ipcMain.handle("browser:click", async (_event, selector: string, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "click", selector }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });
  ipcMain.handle("browser:fill", async (_event, selector: string, value: string, clearFirst?: boolean, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "fill", selector, value, clearFirst }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });
  ipcMain.handle("browser:select", async (_event, selector: string, valueOrText: string, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "select", selector, valueOrText }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });
  ipcMain.handle("browser:check", async (_event, selector: string, checked?: boolean, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "check", selector, checked }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });
  ipcMain.handle("browser:clear", async (_event, selector: string, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "clear", selector }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });
  ipcMain.handle("browser:focus", async (_event, selector: string, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "focus", selector }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });
  ipcMain.handle("browser:hover", async (_event, selector: string, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "hover", selector }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });

  // Coordinate-based interaction
  ipcMain.handle("browser:click-at", async (_event, x: number, y: number, button?: string, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "click-at", x, y, button }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });
  ipcMain.handle("browser:hover-at", async (_event, x: number, y: number, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "hover-at", x, y }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });
  ipcMain.handle("browser:drag", async (_event, x1: number, y1: number, x2: number, y2: number, steps?: number, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "drag", x1, y1, x2, y2, steps }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });
  ipcMain.handle("browser:scroll", async (_event, selector: string | undefined, direction: string, amount: number, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "scroll", selector, direction, amount }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });

  // Keyboard
  ipcMain.handle("browser:type", async (_event, text: string, delayMs?: number, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "type", text, delayMs }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });
  ipcMain.handle("browser:key", async (_event, key: string, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "key", key }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });
  ipcMain.handle("browser:shortcut", async (_event, keys: string, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "shortcut", keys }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });

  // Wait/Assert
  ipcMain.handle("browser:wait-for", async (_event, selector: string, timeoutMs?: number, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "wait-for", selector, timeoutMs }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });
  ipcMain.handle("browser:wait-for-text", async (_event, text: string, selector?: string, timeoutMs?: number, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "wait-for-text", text, selector, timeoutMs }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });
  ipcMain.handle("browser:wait-for-url", async (_event, pattern: string, timeoutMs?: number, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "wait-for-url", pattern, timeoutMs }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });
  ipcMain.handle("browser:wait-for-load", async (_event, timeoutMs?: number, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "wait-for-load", timeoutMs }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });

  ipcMain.handle("browser:screenshot", async (_event, fullPage?: boolean, paneId?: string) => saveScreenshot(paneId, fullPage));
  ipcMain.handle("browser:screenshot-el", async (_event, selector: string, paneId?: string) => saveScreenshotElement(selector, paneId));

  // Eval (direct JS execution)
  ipcMain.handle("browser:eval", async (_event, javascript: string, paneId?: string) => {
    const pid = resolveBrowserPaneId(paneId);
    if (!pid) return { ok: false, error: "no browser pane" };
    try { return await sendBrowserCmd(pid, { type: "eval", javascript }); }
    catch (err) { return { ok: false, error: String(err) }; }
  });

  // Console log (read from in-memory store)
  ipcMain.handle("browser:console-log", async (_event, level?: string, sinceMs?: number, limit?: number, paneId?: string) => {
    const entries = getConsoleLog(paneId, level, sinceMs, limit);
    return { ok: true, entries, total: browserConsoleLog.length };
  });
  ipcMain.handle("browser:clear-console", async () => {
    browserConsoleLog.length = 0;
    return { ok: true };
  });

  // Network log (read from in-memory store)
  ipcMain.handle("browser:network-log", async (_event, urlFilter?: string, method?: string, status?: string, sinceMs?: number, limit?: number, paneId?: string) => {
    const entries = getNetworkLog(paneId, urlFilter, method, status, sinceMs, limit);
    return { ok: true, entries, total: browserNetworkLog.length };
  });
  ipcMain.handle("browser:network-wait", async (_event, pattern: string, method?: string, timeoutMs?: number) => {
    const timeout = timeoutMs || 10000;
    const start = Date.now();
    return new Promise((resolve) => {
      const check = () => {
        const found = browserNetworkLog.find(e => {
          const urlMatch = e.url?.includes(pattern) || e.data?.includes(pattern);
          const methodMatch = !method || e.method === method.toUpperCase();
          return urlMatch && methodMatch;
        });
        if (found) { resolve({ ok: true, entry: found, timedOut: false }); return; }
        if (Date.now() - start > timeout) { resolve({ ok: true, entry: null, timedOut: true }); return; }
        setTimeout(check, 300);
      };
      check();
    });
  });
  ipcMain.handle("browser:clear-network", async () => {
    browserNetworkLog.length = 0;
    return { ok: true };
  });

  // Annotate screenshot
  ipcMain.handle("browser:annotate", async (_event, screenshotPath: string, annotations: Array<{ type: string; x: number; y: number; w?: number; h?: number; label?: string; color?: string }>) => {
    // This requires sharp or canvas — for now return the path as-is
    // TODO: implement annotation overlay
    return { ok: true, path: screenshotPath, note: "annotation not yet implemented" };
  });

  // ── Diagnostics ───────────────────────────────────────────────────────────
  ipcMain.handle("diagnostics:snapshot", () => ({
    app: {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
    },
    workspace: { active: null },
    providers: getEnhancedProviders(),
    backendPanes: ptyManager.list(),
    panes: ptyManager.list(),
    processes: [],
    clis: cliDetector.getAll(),
    memory: process.memoryUsage(),
    mcp: {
      active: !!mcpServerInfo,
      port: mcpServerInfo?.port ?? null,
      sseUrl: mcpServerInfo?.sseUrl ?? null,
      streamableHttpUrl: mcpServerInfo?.streamableHttpUrl ?? null,
      tools: mcpServerInfo ? [
        "mcp__codebrain__pane_spawn",
        "mcp__codebrain__pane_write",
        "mcp__codebrain__pane_read",
        "mcp__codebrain__pane_wait_idle",
        "mcp__codebrain__pane_list",
        "mcp__codebrain__pane_set_role",
        "mcp__codebrain__pane_send_message",
        "mcp__codebrain__pane_read_messages",
        "mcp__codebrain__todo_manager",
        "mcp__codebrain__browser_navigate",
        "mcp__codebrain__browser_open",
        "mcp__codebrain__browser_back",
        "mcp__codebrain__browser_forward",
        "mcp__codebrain__browser_reload",
        "mcp__codebrain__browser_get_html",
        "mcp__codebrain__browser_get_text",
        "mcp__codebrain__browser_get_accessibility_tree",
        "mcp__codebrain__browser_find_by_text",
        "mcp__codebrain__browser_get_element_info",
        "mcp__codebrain__browser_get_url",
        "mcp__codebrain__browser_click",
        "mcp__codebrain__browser_fill",
        "mcp__codebrain__browser_select",
        "mcp__codebrain__browser_check",
        "mcp__codebrain__browser_clear",
        "mcp__codebrain__browser_focus",
        "mcp__codebrain__browser_hover",
        "mcp__codebrain__browser_click_at",
        "mcp__codebrain__browser_hover_at",
        "mcp__codebrain__browser_drag",
        "mcp__codebrain__browser_scroll",
        "mcp__codebrain__browser_type",
        "mcp__codebrain__browser_key",
        "mcp__codebrain__browser_shortcut",
        "mcp__codebrain__browser_wait_for",
        "mcp__codebrain__browser_wait_for_text",
        "mcp__codebrain__browser_wait_for_url",
        "mcp__codebrain__browser_wait_for_load",
        "mcp__codebrain__browser_screenshot",
        "mcp__codebrain__browser_screenshot_element",
        "mcp__codebrain__browser_annotate",
        "mcp__codebrain__browser_console_log",
        "mcp__codebrain__browser_clear_console",
        "mcp__codebrain__browser_network_log",
        "mcp__codebrain__browser_network_wait",
        "mcp__codebrain__browser_clear_network",
        "mcp__codebrain__browser_eval",
      ] : [],
      toolCount: mcpServerInfo ? 47 : 0,
    },
  }));

  // Updater handles registered in auto-updater.ts

  // ── Session Snapshot (save/restore full session) ─────────────────────────
  ipcMain.handle("session:saveSnapshot", async (_event, workspacePath: string) => {
    try {
      const panes = ptyManager.list();
      const snapshotPanes = panes.map((p) => {
        const cfg = paneConfigs.get(p.paneId);
        const lastLines = ptyManager.read(p.paneId, 50);
        return {
          id: p.paneId,
          agent: p.agent,
          providerId: cfg?.providerId,
          model: cfg?.model,
          role: cfg?.role,
          cwd: p.cwd,
          lastLines,
        };
      });

      // Build compacted orchestrator context
      const panesSummary = snapshotPanes.map((p) => {
        const role = p.role ?? "worker";
        const provider = p.providerId ? ` (provider: ${p.providerId}` + (p.model ? `, model: ${p.model}` : "") + ")" : "";
        const lastOutput = p.lastLines.length > 0
          ? `\n  Últimas linhas:\n    ${p.lastLines.slice(-10).join("\n    ")}`
          : "";
        return `- [${role}] ${p.agent}${provider} | cwd: ${p.cwd}${lastOutput}`;
      }).join("\n\n");

      const orchestratorPrompt = `## Contexto de Sessão Anterior

Você está retomando uma sessão que foi salva. Aqui está o estado dos panes que estavam ativos:

${panesSummary}

## Instruções

1. Analise o contexto acima para entender o que cada worker estava fazendo.
2. Re-spawn os workers necessários usando mcp__codebrain__pane_spawn.
3. Para cada worker, use mcp__codebrain__pane_write com um prompt detalhado que inclua:
   - O contexto do que ele estava fazendo antes (extraído das últimas linhas)
   - Instruções para continuar de onde parou
4. Não re-spawn workers que já completaram suas tarefas (marcados como "done").
5. Priorize workers que estavam em progresso.`;

      const snapshot = {
        id: `snap_${Date.now()}`,
        workspacePath,
        savedAt: Date.now(),
        panes: snapshotPanes,
        orchestratorPrompt,
      };

      // Save to .codebrain/session-snapshot.json
      const snapshotDir = path.join(workspacePath, ".codebrain");
      fs.mkdirSync(snapshotDir, { recursive: true });
      const snapshotPath = path.join(snapshotDir, "session-snapshot.json");
      fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");

      return { ok: true, path: snapshotPath };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("session:loadSnapshot", async (_event, workspacePath: string) => {
    try {
      const snapshotPath = path.join(workspacePath, ".codebrain", "session-snapshot.json");
      if (!fs.existsSync(snapshotPath)) return { ok: false, error: "no snapshot found" };
      const raw = fs.readFileSync(snapshotPath, "utf-8");
      const snapshot = JSON.parse(raw);
      return { ok: true, snapshot };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Stubs for features not yet ported ─────────────────────────────────────
  ipcMain.handle("session:load", async () => []);
  ipcMain.handle("session:loadAll", async () => []);
  ipcMain.handle("session:clear", async () => {});
  ipcMain.handle("session:deleteOne", async () => {});
  ipcMain.handle("claude:sessions", async () => []);
  ipcMain.handle("claude:summary", async () => "");
  ipcMain.handle("tokens:byTask", async () => ({}));
  ipcMain.handle("tokens:byWorkspace", async () => ({}));
  ipcMain.handle("log:list", async () => []);
  ipcMain.handle("tasks:list", async () => ({ tasks: [] }));
  ipcMain.handle("squads:list", async () => []);
  ipcMain.handle("squads:save", async () => {});
  ipcMain.handle("squads:delete", async () => {});
  ipcMain.handle("audio:getConfig", () => publicAudioConfig());
  ipcMain.handle("audio:saveConfig", async (_event, patchInput: Partial<AudioConfig>) => {
    if (!patchInput || typeof patchInput !== "object") return { ok: false, error: "invalid config" };
    const current = audioConfigStore.read();
    const patch = patchInput as Partial<AudioConfig>;
    const next: AudioConfig = {
      ...current,
      ...(patch.provider !== undefined && { provider: patch.provider }),
      ...(patch.baseUrl !== undefined && { baseUrl: patch.baseUrl.trim() }),
      ...(patch.apiKey !== undefined && !/^\*+$/.test(patch.apiKey)
        ? { apiKey: patch.apiKey.trim() }
        : {}),
      ...(patch.model !== undefined && { model: patch.model.trim() }),
      ...(patch.language !== undefined && { language: patch.language.trim() }),
      ...(patch.prompt !== undefined && { prompt: patch.prompt.trim() }),
      ...(patch.chunkMs !== undefined && { chunkMs: patch.chunkMs }),
      ...(patch.captureMode !== undefined && { captureMode: patch.captureMode }),
      ...(patch.interactionMode !== undefined && { interactionMode: patch.interactionMode }),
      ...(patch.targetWpm !== undefined && { targetWpm: patch.targetWpm }),
    };
    audioConfigStore.write(next);
    return { ok: true, config: publicAudioConfig() };
  });
  ipcMain.handle("audio:transcribe", async (_event, args: { bytes: ArrayBuffer; mimeType?: string; context?: string }) => {
    const cfg = audioConfigStore.read();
    if (cfg.provider === "groq") return transcribeWithGroq(args, cfg);
    return { ok: false, error: "local whisper not configured — use Groq provider" };
  });
  ipcMain.handle("skill:status", async () => {
    const skillDir = path.join(os.homedir(), ".claude", "skills", "codebrain-skill");
    const installed = fs.existsSync(skillDir);
    return { installed };
  });
  ipcMain.handle("skill:list", async () => {
    const skillsDir = path.join(os.homedir(), ".claude", "skills");
    if (!fs.existsSync(skillsDir)) return [];
    try {
      return fs.readdirSync(skillsDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
    } catch {
      return [];
    }
  });
  ipcMain.handle("skill:openFolder", async () => {
    const skillsDir = path.join(os.homedir(), ".claude", "skills");
    if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });
    shell.openPath(skillsDir);
  });
  ipcMain.handle("skill:installCodebrain", async () => {
    const skillsDir = path.join(os.homedir(), ".claude", "skills");
    const skillDir = path.join(skillsDir, "codebrain-skill");
    try {
      fs.mkdirSync(skillsDir, { recursive: true });

      // Find bundled skill files — resources/codebrain-skill/
      const isPackaged = app.isPackaged;
      const bundledSkillDir = isPackaged
        ? path.join(process.resourcesPath, "codebrain-skill")
        : path.join(__dirname, "..", "..", "resources", "codebrain-skill");

      if (!fs.existsSync(bundledSkillDir)) {
        return { ok: false, error: `Skill files not found at ${bundledSkillDir}` };
      }

      // Remove old install if it exists
      if (fs.existsSync(skillDir)) {
        fs.rmSync(skillDir, { recursive: true, force: true });
      }

      // Copy bundled skill files to ~/.claude/skills/codebrain-skill/
      fs.mkdirSync(skillDir, { recursive: true });
      const files = fs.readdirSync(bundledSkillDir);
      for (const file of files) {
        const src = path.join(bundledSkillDir, file);
        const dest = path.join(skillDir, file);
        fs.copyFileSync(src, dest);
      }

      return { ok: true, action: "instalado", path: skillDir };
    } catch (err: any) {
      const msg = err?.message || String(err);
      return { ok: false, error: msg };
    }
  });
  ipcMain.handle("skill:uninstallCodebrain", async () => {
    const skillDir = path.join(os.homedir(), ".claude", "skills", "codebrain-skill");
    try {
      if (fs.existsSync(skillDir)) {
        fs.rmSync(skillDir, { recursive: true, force: true });
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });
  ipcMain.handle("auth:status", async () => ({ authenticated: true, email: "" }));
  ipcMain.handle("auth:logout", async () => {});
  ipcMain.handle("auth:profile", async () => ({}));
  ipcMain.handle("auth:open-login", async () => shell.openExternal("https://codebrain.sh"));
  ipcMain.handle("auth:open-signup", async () => shell.openExternal("https://codebrain.sh/signup"));
  ipcMain.handle("auth:open-terms", async () => shell.openExternal("https://codebrain.sh/terms"));
  ipcMain.handle("auth:open-privacy", async () => shell.openExternal("https://codebrain.sh/privacy"));
  ipcMain.handle("auth:open-billing", async () => shell.openExternal("https://codebrain.sh/billing"));
}

// ── App Lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // Ensure data directory exists
  fs.mkdirSync(DATA_DIR, { recursive: true });

  mainWindow = createWindow();
  registerIpcHandlers();
  setupAutoUpdater(mainWindow);

  // Global PTY event forwarding — single set of listeners for all panes
  ptyManager.on("output", (paneId: string, data: string) => {
    safeSend("pty:output", paneId, data, false);
  });
  ptyManager.on("output-echo", (paneId: string, data: string) => {
    safeSend("pty:output", paneId, data, true);
  });
  ptyManager.on("exit", (paneId: string, exitCode: number) => {
    safeSend("pty:exit", paneId, exitCode);
    paneConfigs.delete(paneId);
    paneRegistry.delete(paneId);
  });

  // Start MCP server
  const { startMCPServer } = require("../../packages/mcp/server.js");
  const mcpServerStartPromise = startMCPServer(ptyManager, {
    spawnPaneFn: (req: { agent?: string; providerId?: string; model?: string; cwd?: string }) => spawnPaneInternal(req),
    onPaneCreated: (info: { paneId: string; agent: string; cwd?: string; providerId?: string; model?: string }) => {
      safeSend("pane:added", info);
    },
    sendBrowserCmd,
    saveScreenshot,
    saveScreenshotElement,
    getNetworkLog,
    getConsoleLog,
    clearBrowserLogs,
    resolveBrowserPaneId: (paneId?: string) => {
      if (paneId && browserPaneIds.has(paneId)) return paneId;
      if (paneId) return paneId;
      const ids = Array.from(browserPaneIds);
      return ids.length > 0 ? ids[ids.length - 1] : null;
    },
    createBrowserPane: (url: string) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timeout creating browser pane")), 10000);
        const handler = (_evt: unknown, createdPaneId: string) => {
          clearTimeout(timer);
          ipcMain.off("codebrain:browser:pane-created", handler);
          browserPaneIds.add(createdPaneId);
          // Wait for webview init, then navigate
          setTimeout(async () => {
            try {
              const navResult = await sendBrowserCmd(createdPaneId, { type: "navigate", url });
              resolve({ ...navResult, paneId: createdPaneId });
            } catch (err) { resolve({ ok: false, error: String(err), paneId: createdPaneId }); }
          }, 1000);
        };
        ipcMain.on("codebrain:browser:pane-created", handler);
        safeSend("codebrain:browser:create-pane", { url });
      });
    },
    getCurrentWorkspacePath: () => currentWorkspacePath,
  });
  // Helper: write .mcp.json so agents can discover the MCP server
  function writeMcpConfig(info: { port: number; sseUrl: string; streamableHttpUrl: string }) {
    const config = JSON.stringify({
      mcpServers: {
        codebrain: {
          type: "sse",
          url: info.sseUrl,
        },
      },
    }, null, 2);
    // Write to home dir (default cwd for spawned panes)
    try { fs.writeFileSync(path.join(os.homedir(), ".mcp.json"), config, "utf-8"); } catch {}
    // Write to current workspace if different
    try {
      if (currentWorkspacePath && currentWorkspacePath !== os.homedir()) {
        fs.writeFileSync(path.join(currentWorkspacePath, ".mcp.json"), config, "utf-8");
      }
    } catch {}
  }

  mcpServerReady = mcpServerStartPromise;
  mcpServerStartPromise.then((info: typeof mcpServerInfo) => {
    mcpServerInfo = info;
    writeMcpConfig(info);
    console.log(`[MCP] Server started on port ${info.port}`);
    console.log(`[MCP] SSE: ${info.sseUrl}`);
    console.log(`[MCP] Streamable HTTP: ${info.streamableHttpUrl}`);
  }).catch((err: unknown) => {
    console.error("[MCP] Failed to start server:", err);
    // Retry once after 2s (port might be in use from previous run)
    setTimeout(() => {
      console.log("[MCP] Retrying server start...");
      const retryPromise = startMCPServer(ptyManager, {
        spawnPaneFn: (req: { agent?: string; providerId?: string; model?: string; cwd?: string }) => spawnPaneInternal(req),
        onPaneCreated: (info: { paneId: string; agent: string; cwd?: string; providerId?: string; model?: string }) => {
          safeSend("pane:added", info);
        },
        sendBrowserCmd,
        saveScreenshot,
        saveScreenshotElement,
        getNetworkLog,
        getConsoleLog,
        clearBrowserLogs,
        resolveBrowserPaneId: (paneId?: string) => {
          if (paneId && browserPaneIds.has(paneId)) return paneId;
          if (paneId) return paneId;
          const ids = Array.from(browserPaneIds);
          return ids.length > 0 ? ids[ids.length - 1] : null;
        },
        createBrowserPane: (url: string) => {
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("timeout creating browser pane")), 10000);
            const handler = (_evt: unknown, createdPaneId: string) => {
              clearTimeout(timer);
              ipcMain.off("codebrain:browser:pane-created", handler);
              browserPaneIds.add(createdPaneId);
              setTimeout(async () => {
                try {
                  const navResult = await sendBrowserCmd(createdPaneId, { type: "navigate", url });
                  resolve({ ...navResult, paneId: createdPaneId });
                } catch (err) { resolve({ ok: false, error: String(err), paneId: createdPaneId }); }
              }, 1000);
            };
            ipcMain.on("codebrain:browser:pane-created", handler);
            safeSend("codebrain:browser:create-pane", { url });
          });
        },
        getCurrentWorkspacePath: () => currentWorkspacePath,
      });
      // Update mcpServerReady so concurrent spawns wait for the retry
      mcpServerReady = retryPromise;
      retryPromise.then((info2: typeof mcpServerInfo) => {
        mcpServerInfo = info2;
        writeMcpConfig(info2);
        console.log(`[MCP] Server started on port ${info2.port} (retry)`);
      }).catch((err2: unknown) => {
        console.error("[MCP] Retry also failed:", err2);
      });
    }, 2000);
  });

  // ── Network interceptor — full request lifecycle tracking ──────────────
  const pendingRequests = new Map<number, { startTime: number; method: string; url: string }>();

  function isInternalUrl(url: string): boolean {
    return url.startsWith("devtools://") || url.startsWith("chrome-extension://") || url.startsWith("chrome-devtools://") || url.startsWith("about:");
  }

  function attachNetworkTracking(sess: Electron.Session) {
    sess.webRequest.onBeforeRequest((details, callback) => {
      if (!isInternalUrl(details.url)) {
        pendingRequests.set(details.id, { startTime: Date.now(), method: details.method, url: details.url });
      }
      callback({});
    });

    sess.webRequest.onCompleted((details) => {
      if (isInternalUrl(details.url)) return;
      const pending = pendingRequests.get(details.id);
      pendingRequests.delete(details.id);
      const startTime = pending?.startTime ?? Date.now();
      const entry = {
        id: `net_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: startTime,
        durationMs: Date.now() - startTime,
        method: details.method,
        url: details.url,
        type: guessResourceType(details.url, details.resourceType),
        status: details.statusCode,
        statusText: statusTextFromCode(details.statusCode),
        ok: details.statusCode >= 200 && details.statusCode < 400,
        requestHeaders: details.requestHeaders as Record<string, string> || {},
        responseHeaders: details.responseHeaders as Record<string, string> || {},
        error: null,
      };
      browserNetworkLog.push(entry);
      if (browserNetworkLog.length > BROWSER_LOG_MAX) browserNetworkLog.splice(0, browserNetworkLog.length - BROWSER_LOG_MAX);
      safeSend("codebrain:browser:network-entry", entry);
    });

    sess.webRequest.onErrorOccurred((details) => {
      if (isInternalUrl(details.url)) return;
      const pending = pendingRequests.get(details.id);
      pendingRequests.delete(details.id);
      const startTime = pending?.startTime ?? Date.now();
      const entry = {
        id: `net_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: startTime,
        durationMs: Date.now() - startTime,
        method: details.method,
        url: details.url,
        type: guessResourceType(details.url, undefined),
        status: 0,
        statusText: "Error",
        ok: false,
        requestHeaders: {},
        responseHeaders: {},
        error: details.error || "request failed",
      };
      browserNetworkLog.push(entry);
      if (browserNetworkLog.length > BROWSER_LOG_MAX) browserNetworkLog.splice(0, browserNetworkLog.length - BROWSER_LOG_MAX);
      safeSend("codebrain:browser:network-entry", entry);
    });
  }

  // Track requests from main window AND from browser webviews
  attachNetworkTracking(session.defaultSession);
  attachNetworkTracking(session.fromPartition("persist:codebrain-browser"));

  function guessResourceType(url: string, resourceType?: string): string {
    if (resourceType) return resourceType;
    if (url.match(/\.(js|mjs|jsx|ts|tsx)(\?|$)/)) return "script";
    if (url.match(/\.(css|scss|less)(\?|$)/)) return "stylesheet";
    if (url.match(/\.(png|jpg|jpeg|gif|svg|webp|ico|bmp)(\?|$)/)) return "image";
    if (url.match(/\.(woff2?|ttf|eot|otf)(\?|$)/)) return "font";
    if (url.match(/\.(json)(\?|$)/)) return "json";
    if (url.match(/\.(html|htm)(\?|$)/)) return "document";
    if (url.match(/\/api\//) || url.match(/\/graphql/)) return "fetch";
    return "other";
  }

  function statusTextFromCode(code: number): string {
    const map: Record<number, string> = {
      200: "OK", 201: "Created", 204: "No Content", 301: "Moved", 302: "Found", 304: "Not Modified",
      400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
      405: "Method Not Allowed", 409: "Conflict", 422: "Unprocessable", 429: "Too Many Requests",
      500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout",
    };
    return map[code] || "";
  }

  // Detect CLI tools in background
  cliDetector.redetect();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (!platform.isMacOS) {
    teardownAutoUpdater();
    app.quit();
  }
});

app.on("before-quit", async (e) => {
  if (mcpServerInfo) {
    mcpServerInfo.close();
    mcpServerInfo = null;
  }
  // Make sure all background shells and agents are killed so they don't lock files during an update
  ptyManager.killAll();
  
  if (isUpdateInstallRequested()) return;
  teardownAutoUpdater();
});
