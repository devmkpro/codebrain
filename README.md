# Codebrain

> Multi-agent AI IDE. Orchestrate Claude, Gemini, MIMO and more — side by side, in real time.

---

## What is Codebrain?

Codebrain is an **Electron desktop app** where multiple AI agents work together in a visible terminal grid.

- **Tiling grid** — auto-organizes 1/2/3/4+ panes
- **Focus mode** — expand any pane to 65% with one click
- **Multi-agent squads** — one orchestrator directs many workers
- **Live task sidebar** — agents update a shared todo list
- **Session map** — visual graph of all agent sessions
- **File editor** — browse and edit without leaving the app
- **Browser automation** — 46 browser MCP tools for web testing
- **Shared memory** — agents share context in real-time via SQLite
- **Swarm coordination** — programmatic worker management and health monitoring
- **Pattern learning** — agents automatically build and reuse project patterns
- **Trajectory tracking** — action sequences with auto-pattern extraction
- **Lifecycle hooks** — EventEmitter-based hooks for spawn, exit, idle events
- **Knowledge graph** — memory relationships, PageRank ranking, TF-IDF similarity search
- **Agent scoring** — multi-factor scoring (capability, load, performance, health, availability)
- **Pipeline coordination** — fan-out/fan-in parallel task distribution and result aggregation
- **Background workers** — 7 persistent maintenance daemons (health, patterns, security, git, learning, cache, swarm)
- **Consensus** — majority/unanimous/weighted voting + automatic leader election
- **Priority MessageBus** — in-memory messaging with 4 priority levels, ack/retry, TTL, metrics
- **Session compaction** — LLM-based summarization when context pressure is high; preserves key decisions and frees tokens
- **Goal/Judge system** — set goals for autonomous agents; independent judge model evaluates if truly satisfied before stopping
- **Checkpoint persistence** — save/restore session state across context limits; 11-section structured checkpoints with validation
- **Cross-session history** — FTS5 search across ALL conversation history with BM25 ranking; filter by kind, tool, time
- **LSP integration** — 12 semantic code navigation tools: goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol, goToImplementation, callHierarchy, incoming/outgoing calls
- **Text loop recovery** — detects repeated identical text output and injects progressive recovery prompts (mild → strong)
- **Step classification** — classifies agent steps (final/continue/filtered/think-only/invalid/failed) for loop control
- **Max mode** — Best-of-N: run N parallel candidate responses, judge selects the best for higher quality outputs
- **Compose mode** — specs-driven development workflow: plan → execute → test → debug → verify → merge
- **Plan agent** — read-only mode for code exploration and solution design before implementation
- **Question tool** — structured user interaction with predefined options; auto-resolve in headless mode
- **Session snapshots** — revert workspace to any previous state; supports revert/unrevert with diff computation
- **Multi-edit** — batch multiple edit operations on a single file in one call
- **Provider-specific prompts** — model-optimized prompt additions per family (Claude, Gemini, GPT, MIMO)
- **Task gate pre-stop** — checks for incomplete tasks before allowing agent to stop; nudges completion
- **244 MCP tools** — pane, browser (CDP + webview), memory, patterns, swarm, hooks, trajectories, files, system, knowledge graph, scoring, pipeline, workers, consensus, skills, LSP (12), session management, goal/judge, checkpoints, history search, compose mode, plan agent, max mode, question tool
- **Skills system** — create, list, install and manage prompt templates scoped to project or globally (`~/.codebrain/skills/`); marketplace with featured skills, tag filters, and one-click install all
- **Voice input** — push-to-talk with Groq Whisper transcription
- **Discord Rich Presence** — shows Codebrain status in your Discord profile; Client ID configurable via Settings
- **Desktop notifications** — native OS notifications when agents complete tasks, receive messages, or builds finish; toggleable per event type in Settings
- **Session export** — export any session as Markdown or JSON with a native save dialog
- **Session history** — SQLite-backed history panel; auto-saves every terminal session with preview and delete
- **Token cost tracking** — real-time cost per session/model/agent with budget alerts; supports 140+ models (Claude, Gemini, MIMO, Codex, OpenRouter, DeepSeek, Grok and more)
- **Auto-update** — background update checks with Windows registry repair

---

## Quick Start

```bash
git clone https://gitlab.com/maikeofc18/codebrain.git
cd codebrain
npm install
npm install-scripts approve better-sqlite3 electron esbuild
npm run setup:native
npm run dev
```

That's it. Hot reload is instant.

### Por que `setup:native` é obrigatório

O `better-sqlite3` é módulo nativo, e o Codebrain abre o mesmo banco a partir de
dois runtimes com **ABI diferente**: o processo main do Electron e o servidor MCP
stdio, que roda no Node do sistema. Um `npm install` resolve só um lado — o
`prebuild-install` baixa o binário do **Node**, e o Electron então morre no load,
antes de qualquer janela:

```
Error: better-sqlite3: nenhum binário compatível com este runtime
```

`npm run setup:native` deixa os dois no lugar, na ordem certa: copia o binário de
ABI de Node para `resources/native/` (de onde o MCP stdio e o `vitest` o pegam) e
só depois troca o de `node_modules` pelo de ABI do Electron. O script é
idempotente e dispensa o download quando já está correto. Se o app ou o
`npm run dev` estiver de pé, feche antes: no Windows um `.node` carregado não pode
ser sobrescrito.

### MCP sem abrir o Codebrain

O servidor headless usa o mesmo PTY real do aplicativo e pode ser iniciado
separadamente. No Linux instalado pelo `.deb`, execute:

```bash
codebrain --mcp-server
```

Em desenvolvimento:

```bash
npm run mcp:start
```

O `.vscode/mcp.json` e os arquivos do Claude usam um launcher stdio leve: ele
inicia o daemon automaticamente quando o editor conecta. Para parar um daemon
iniciado pelo launcher, use `npm run mcp:stop` no checkout de desenvolvimento;
no pacote instalado, encerre o processo `codebrain --mcp-server`.

### What happens in dev mode

- **Renderer** — HMR automatic (change .tsx, reloads instantly)
- **Main** — Restarts Electron on save to `electron/main/**`
- **Preload** — Rebuilt automatically on save

### Useful shortcuts in the app

| Shortcut | Action |
|----------|--------|
| `F12` | Toggle DevTools (dev mode) |
| `Ctrl+R` | Blocked in production (prevents accidental reload) |
| `Ctrl+Q` / `Cmd+Q` | Quit app |
| `Ctrl+W` / `Cmd+W` | Close window |
| `Ctrl+M` / `Cmd+M` | Minimize window |
| `Escape` | Minimize window |

O DevTools abre junto com o app em dev. O frontend dele escreve no stdout ruído
que não é do Codebrain — `Unknown VE context: language-mismatch` do visual
logging, e `Autofill.enable` / `Autofill.setAddresses` respondidos com `-32601`
porque o Electron não implementa esse domínio do CDP. Para um log de arranque
limpo, `CODEBRAIN_NO_DEVTOOLS=1 npm run dev`; o `F12` continua abrindo.

---

## Build Executable

```bash
# Install dependencies (if needed)
npm install

# Generate releases data + bundle stdio MCP + Vite build
npm run build
```

Then choose your packaging:

```bash
# Windows — Portable ZIP (no admin needed, recommended)
npm run pack:win

# Windows — NSIS installer (.exe, requires admin or Developer Mode)
npm run dist:win:nsis

# Windows — Full pipeline (prebuild native + bundle + build + package)
npm run dist:win

# macOS
npm run dist:mac

# Linux (AppImage + .deb)
npm run dist:linux
```

Output goes to `dist/`.

### Troubleshooting build errors

If NSIS fails with symlink errors, enable **Developer Mode**:
`Settings > System > For Developers` or run the terminal as Administrator.

#### `npm i` deixa install scripts pendentes

O npm 11 não roda install script sem aprovação. Depois de `npm install` você verá:

```
npm warn install-scripts 3 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   better-sqlite3@12.11.1 ...
npm warn install-scripts   electron@33.4.11 ...
npm warn install-scripts   esbuild@0.25.12 ...
```

Sem aprovar, o binário do Electron e o do esbuild nunca são baixados e o
`better-sqlite3` não é compilado — daí `'electron-vite' não é reconhecido`:

```bash
npm install-scripts approve better-sqlite3 electron esbuild
```

#### `Electron failed to install correctly` no Node 26

Sintoma: a aprovação acima roda, `node_modules/electron/dist` fica com **um
único arquivo** (`LICENSES.chromium.html`), `path.txt` não é criado, e o
`install.js` do Electron **termina com código 0 sem erro nenhum**.

Causa: o `extract-zip` (via `yauzl`), usado pelo instalador do Electron, não
funciona no Node 26 — a promise de extração nem resolve nem rejeita, então o
instalador acha que terminou. O zip em cache está íntegro; o extrator é que
para na primeira entrada. `npm audit` também lista `extract-zip` como
vulnerável, e a correção dele vem junto de um major novo do `electron-builder`.

Duas saídas:

1. **Rodar o projeto em Node LTS (22 ou 24)**, onde o instalador funciona. É a
   saída durável, porque todo `npm i` novo repete o problema no Node 26.
2. **Extrair à mão**, uma vez, fazendo o que o `install.js` faria:

```powershell
$dist = "node_modules\electron\dist"
Remove-Item $dist -Recurse -Force -ErrorAction SilentlyContinue
$zip = (Get-ChildItem "$env:LOCALAPPDATA\electron\Cache" -Recurse -Filter *.zip)[0].FullName
Expand-Archive -LiteralPath $zip -DestinationPath $dist -Force
Set-Content node_modules\electron\path.txt -Value "electron.exe" -NoNewline
```

O Node 26 também expõe um `localStorage` global próprio, que só funciona com
`--localstorage-file` e tem precedência sobre o do jsdom. É por isso que os
stores persistidos passam `storage: appStorage`
(`src/stores/persist-storage.ts`) em vez de deixar o zustand capturar o global
cru — sem isso, cinco testes de renderer quebram em
`Cannot read properties of undefined (reading 'setItem')`.

---

## Releases

Download the latest from [GitLab Releases](https://gitlab.com/maikeofc18/codebrain/-/releases).

Available for:
- Windows x64 (NSIS installer + portable ZIP)
- Linux x64 (AppImage + .deb)

---

## Stack

| Layer | Tech |
|-------|------|
| Framework | React 19 + TypeScript |
| Styling | Tailwind CSS v4 |
| State | Zustand v5 |
| Terminal | xterm.js v6 |
| Animation | Motion (Framer) |
| Icons | lucide-react |
| Font | JetBrains Mono |
| MCP | @modelcontextprotocol/sdk |
| CI/CD | GitLab CI |

---

## Providers (API Keys)

Click the account icon → **Providers** → **+ Add Provider**.

| Role | Provider | Model |
|------|----------|-------|
| Orchestrator | Claude / Anthropic | claude-sonnet-4-6 |
| Workers | Gemini API | gemini-3.1-pro-preview |

---

## MCP Tools

Agents get these tools automatically:

### Core (pane management)

| Tool | What it does |
|------|-------------|
| `pane_spawn` | Open a new agent terminal |
| `pane_write` | Send text to a pane |
| `pane_read` | Read pane output |
| `pane_wait_idle` | Wait until agent finishes |
| `pane_send_message` | Message another agent |
| `pane_read_messages` | Read your inbox |
| `pane_list` | List active panes |
| `pane_set_role` | Assign worker/orchestrator role |
| `todo_manager` | Manage the task sidebar |

### Browser automation (53 tools)

All tools work in **dual mode**: native Chrome via CDP (auto-detected on port 9222) or embedded Electron webview (fallback).

| Tool | What it does |
|------|-------------|
| `browser_guide` | MANDATORY — read before any browser tool |
| `browser_mode` | Current mode: CDP (native Chrome) or webview (embedded) |
| **Navigation** | |
| `browser_navigate` | Go to a URL |
| `browser_open` | Open new browser pane |
| `browser_back` / `browser_forward` | History navigation |
| `browser_reload` | Reload page |
| **DOM reading** | |
| `browser_get_html` | Get raw HTML |
| `browser_get_text` | Get visible text |
| `browser_get_accessibility_tree` | Semantic tree (roles, labels, bounds) |
| `browser_find_by_text` | Find element by visible text |
| `browser_find` | Natural language element search (CDP-only) |
| `browser_get_element_info` | Full element info (bounds, attributes, role) |
| `browser_get_url` | Current URL + title |
| `browser_page_summary` | URL, text, links, inputs, buttons in one call |
| **DOM interaction** | |
| `browser_click` | Click element by CSS selector |
| `browser_click_text` | Find + click by visible text |
| `browser_fill` | Fill input/textarea |
| `browser_fill_form` | Fill multiple fields at once |
| `browser_select` | Select dropdown option |
| `browser_check` | Check/uncheck checkbox |
| `browser_clear` | Clear input field |
| `browser_focus` | Focus element |
| `browser_hover` | Hover element (triggers tooltips) |
| **Coordinate interaction** | |
| `browser_click_at` | Click at exact (x, y) |
| `browser_hover_at` | Hover at exact (x, y) |
| `browser_drag` | Drag from (x1,y1) to (x2,y2) |
| `browser_scroll` | Scroll page or element |
| **Keyboard** | |
| `browser_type` | Type text character by character |
| `browser_key` | Press single key (Enter, Escape, Tab…) |
| `browser_shortcut` | Keyboard shortcut (Ctrl+A, Ctrl+Shift+I…) |
| **Computer (CDP-only)** | |
| `browser_computer` | Mouse/keyboard/screen actions (13 action types: left_click, right_click, double_click, middle_click, mouse_move, left_click_drag, key_press, type, scroll, screenshot, cursor_position, wait, get_screen_size) |
| **Tabs (CDP-only)** | |
| `browser_tabs_list` | List all open Chrome tabs |
| `browser_tabs_create` | Create a new tab |
| `browser_tabs_close` | Close a tab by ID |
| **Batch (CDP-only)** | |
| `browser_batch` | Execute multiple browser actions in a single roundtrip |
| **Wait / assertions** | |
| `browser_wait_for` | Wait for element to appear |
| `browser_wait_for_text` | Wait for text to appear |
| `browser_wait_for_url` | Wait for URL pattern |
| `browser_wait_for_load` | Wait for network idle |
| **Screenshots** | |
| `browser_screenshot` | Capture viewport (returns text description) |
| `browser_screenshot_element` | Capture specific element |
| `browser_annotate` | Draw boxes/arrows/labels on screenshot |
| **Console & network** | |
| `browser_console_log` | Read console entries (log/warn/error) |
| `browser_clear_console` | Clear console log |
| `browser_network_log` | Read network requests (fetch, XHR, WebSocket) |
| `browser_network_wait` | Wait for specific request |
| `browser_clear_network` | Clear network log |
| **Advanced** | |
| `browser_eval` | Execute JavaScript in page context |

### Shared Memory (6 tools)

| Tool | What it does |
|------|-------------|
| `memory_write` | Save context (type, key, content, tags) to shared SQLite memory |
| `memory_read` | Read specific memory by id or key |
| `memory_search` | Search memories by keyword, type, or tags |
| `memory_list` | List memories with filters (type, agent, workspace) |
| `memory_delete` | Delete a memory entry |
| `memory_stats` | Memory usage statistics (count by type, total size) |

### Knowledge Graph (3 tools)

| Tool | What it does |
|------|-------------|
| `memory_graph` | Get a memory node + neighbors with edge types (reference, similar, temporal, co_accessed) |
| `memory_rank` | PageRank scores for all memories — find the most important/central ones |
| `memory_similar` | Find similar memories using TF-IDF cosine similarity |

### Pattern Learning (4 tools)

| Tool | What it does |
|------|-------------|
| `pattern_write` | Save a learned pattern (type, description, quality score) |
| `pattern_list` | List patterns ordered by quality score |
| `pattern_update` | Update pattern quality score after successful use |
| `pattern_delete` | Delete a pattern |

### Swarm Coordination (6 tools)

| Tool | What it does |
|------|-------------|
| `swarm_status` | Swarm health: active workers, roles, topology |
| `swarm_broadcast` | Broadcast message to all workers |
| `swarm_assign_task` | Assign task to specific worker via message |
| `swarm_worker_health` | Health check on individual worker |
| `swarm_respawn` | Respawn a crashed worker |
| `swarm_set_topology` | Set topology: hierarchical, mesh, centralized |

### Agent Scoring (1 tool)

| Tool | What it does |
|------|-------------|
| `swarm_score_agents` | Multi-factor scoring: capability(30%), load(20%), performance(25%), health(15%), availability(10%) |

### Pipeline Coordination (4 tools)

| Tool | What it does |
|------|-------------|
| `swarm_fan_out` | Distribute N tasks to workers in parallel (round-robin) |
| `swarm_fan_in` | Collect + aggregate results (merge, vote, or best-agent) |
| `swarm_pipeline` | Chain sequential tasks where each step feeds the next |
| `swarm_pipeline_status` | Check pipeline execution status |

### Consensus (4 tools)

| Tool | What it does |
|------|-------------|
| `swarm_vote` | Start a vote: majority (>50%), unanimous (100%), or weighted (by agent score) |
| `swarm_cast_vote` | Cast a vote in an active session |
| `swarm_elect_leader` | Auto-elect leader by capability score |
| `swarm_consensus_status` | Current leader, active votes, recent results |

### Background Workers (6 tools)

| Tool | What it does |
|------|-------------|
| `worker_start` | Start a daemon (health, patterns, security, git, learning, cache, swarm) |
| `worker_stop` | Stop a daemon |
| `worker_status` | All daemons' status, last run, metrics |
| `worker_alerts` | Recent system alerts from daemons |
| `worker_start_all` | Start all 7 daemons |
| `worker_stop_all` | Stop all daemons |

### MessageBus (1 tool)

| Tool | What it does |
|------|-------------|
| `pane_bus_metrics` | Messages/sec, avg latency, queue depths, ack timeouts |

### Trajectory Tracking (8 tools)

| Tool | What it does |
|------|-------------|
| `trajectory_record` | Start recording a new action trajectory |
| `trajectory_add_step` | Add a step (tool call + result) to trajectory |
| `trajectory_update` | Update trajectory outcome and details |
| `trajectory_list` | List trajectories with filters |
| `trajectory_get` | Get full trajectory by id |
| `trajectory_stats` | Trajectory statistics (success rate, avg duration) |
| `trajectory_extract_patterns` | Auto-extract patterns from successful trajectories |
| `trajectory_delete` | Delete a trajectory |

### Lifecycle Hooks (3 tools)

| Tool | What it does |
|------|-------------|
| `hooks_status` | Registered hooks and recent event stats |
| `hooks_log` | Recent hook events (spawn, exit, idle, message) |
| `hooks_fire` | Manually fire a hook event for testing |

### File Tools (3 tools)

| Tool | What it does |
|------|-------------|
| `file_read` | Read file from workspace |
| `file_write` | Write file to workspace |
| `file_search` | Search files by pattern or content |

### System Tools (2 tools)

| Tool | What it does |
|------|-------------|
| `system_info` | System info (OS, RAM, CPU, app version) |
| `system_diagnostics` | Full diagnostics (pane health, MCP status, providers) |

### Worker Dispatch (3 tools)

| Tool | What it does |
|------|-------------|
| `worker_detect` | Scan text for dispatch triggers (optimize, audit, etc) |
| `worker_dispatch` | Spawn background worker for detected trigger |
| `worker_list_bg` | List active background workers |

### Lessons — correções aprendidas (4 tools)

Persistem entre panes e sessões. O aprendizado existente (`patterns`, `trajectories`) é endógeno: nasce de trajetória bem-sucedida e é pontuado. Uma lição é o oposto — é a regra que o **usuário** ditou, categórica, sem score, válida até alguém removê-la.

| Tool | What it does |
|------|-------------|
| `lesson_add` | Salva uma correção (`rule` + `negative`). `repo_scope` limita a regra a um projeto. `status` é a verdade: só `created`/`enriched` gravaram |
| `lesson_list` | Lista as aplicáveis ao workspace (globais + escopo casando) |
| `lesson_remove` | Remove por id ou por trecho da regra |
| `lesson_context` | Devolve o bloco pronto para injetar no prompt |

`lesson_add` é a única promoção ao core MCP (13/15), porque uma correção chega sem aviso, possivelmente antes de qualquer `enable_tool_group`.

### Work ledger — estado retomável (5 tools)

| Tool | What it does |
|------|-------------|
| `ledger_record` | Um passo: `phase`, `next` como intenção concreta, `tried_approach` + `tried_rejected_because`, `artifacts` (merge, não substituição). Mudar `phase` exige `event` + `event_kind` |
| `ledger_read` | Estado completo + eventos + tudo que foi descartado |
| `ledger_snapshot` | Bloco compacto para reinjetar; vazio em fase terminal |
| `ledger_list` | Workstreams em aberto no workspace |
| `agent_boot_context` | Lições aplicáveis + ledger do workstream numa chamada. Primeira coisa que um worker lê |

Fecha um buraco concreto do par goal/judge: `goal_judge` reentra até 12 vezes e o veredito não carrega nada do que já falhou, então um loop consegue gastar as reentradas repetindo a mesma abordagem. `goal_judge_ledger` registra o veredito negativo como abordagem descartada e devolve o histórico junto.

### Verify — prova visual de alteração de front-end (9 tools)

Fecha o ciclo que faltava: **o agente não afirma que mexeu na tela sem ter olhado.** Ativar com `enable_tool_group("verify")`.

```
verify_plan          git → rotas afetadas → servidor vivo → marcadores
  ↓ (se a página exigir login)
verify_auth_discover → verify_auth_request → verify_auth_approve → verify_login
  ↓
verify_run           navega, tira print, lê texto e console → veredito
verify_report        evidências e veredito por rota
```

| Tool | What it does |
|------|-------------|
| `verify_plan` | Lê a árvore de trabalho (ou um `base` ref), detecta o framework, mapeia arquivo → **rota candidata com confiança e evidência**, sonda portas de loopback e extrai os **marcadores**: as frases que o diff adicionou. Não abre navegador |
| `verify_run` | Abre cada rota, grava o print em `.codebrain/verify/<run_id>/`, lê texto e erros de console, e decide se os marcadores **aparecem** |
| `verify_report` | Veredito por rota, caminhos dos prints, erros de console |
| `verify_auth_discover` | Rota real de login, usuários do banco local com seus papéis, e qual deles tem credencial declarada no seeder do próprio repositório. Ordena pelo encaixe em `feature_context` |
| `verify_auth_request` | Cria concessão **pendente** e mostra o pedido no pane. Nenhum login acontece aqui |
| `verify_auth_approve` / `verify_auth_revoke` / `verify_auth_list` | Ciclo de vida da concessão (TTL padrão 1h) |
| `verify_login` | Executa o login de uma concessão aprovada: modo `seeder` digita a credencial versionada, modo `manual` espera o usuário digitar no painel Browser |

**Veredito, não otimismo.** `passed` só sai quando toda frase adicionada no diff aparece na tela. Os outros estados são informativos de propósito: `not-visible` (rota errada, build sem reload, ou a alteração não chegou à UI), `partial`, `auth-required` (a rota caiu num login), `inconclusive` (nenhum marcador extraível — o print precisa de olho humano), `unreachable`. Nenhum caminho reporta sucesso com base num print que ninguém leu.

**Regras de acesso, e por quê:**

- **Nenhuma tool devolve senha ou hash.** Sai `credentialAvailable` + a procedência `arquivo:linha`. Resultado de tool vira transcript, e transcript não é lugar de credencial.
- **Nenhuma senha é adivinhada.** Não há lista, não há variação. Isso seria credential stuffing contra o banco do próprio usuário, e ser local não muda o que é.
- **Só dois modos de login.** `seeder` usa a credencial declarada no seeder/fixture versionado — texto de desenvolvimento, lido no instante de digitar, nunca armazenado. `manual` abre a tela e espera o humano digitar no painel Browser.
- **`verify_grants` não tem coluna para segredo.** É registro de consentimento com prazo, não cofre; o schema impede o atalho.
- **Alvo é sempre loopback ou faixa privada**, barrado no handler e outra vez no armazém.

### Skills (6 tools)

| Tool | What it does |
|------|-------------|
| `skill_list` | List installed skills — global (`~/.codebrain/skills/`) and/or project (`.codebrain/skills/`) |
| `skill_get` | Get full skill content: manifest + prompt.md |
| `skill_create` | Create a new skill locally with prompt content, scope and tags |
| `skill_delete` | Delete a skill by id and scope |
| `skill_install` | Install a skill from the GitLab registry to `~/.codebrain/skills/` |
| `skill_uninstall` | Remove an installed skill |

**Total: 177 MCP tools**

---

## Project Structure

```
codebrain/
├── src/                    React renderer (TypeScript)
│   ├── components/         UI components
│   ├── stores/             Zustand state
│   └── styles/             Tailwind + design tokens
├── electron/main/          Electron main process
├── packages/
│   ├── mcp/                MCP server (177 agent tools)
│   │   ├── bridge/         Handler modules (15 files)
│   │   │   ├── message-bus.js        Priority in-memory messaging
│   │   │   ├── agent-scorer.js       Multi-factor agent scoring
│   │   │   ├── pipeline-handlers.js  Fan-out/fan-in/pipeline
│   │   │   ├── background-workers.js 7 maintenance daemons
│   │   │   ├── consensus-handlers.js Voting + leader election
│   │   │   ├── lessons-ledger-handlers.js  Lições + ledger + juiz informado
│   │   │   ├── cdp-client.js         Chrome DevTools Protocol client
│   │   │   ├── native-chrome-handlers.js  CDP browser commands
│   │   │   └── ...                   pane, browser, memory, swarm, etc.
│   │   ├── index.js        Tool registration (Zod schemas)
│   │   └── bridge.js       Handler composition + auto-notify
│   └── memory/             Shared memory store
│       ├── store.js        SQLite-backed memory + graph-aware search
│       ├── lessons-ledger.js  Correções do usuário + ledger de trabalho
│       ├── vector-store.js TF-IDF cosine similarity (pure JS)
│       └── knowledge-graph.js  Nodes, edges, PageRank, communities
├── prompts/                Squad system prompts
├── scripts/                Build + release scripts
├── resources/              Icons + bundled skills (auto-installed on startup)
└── local/                  Dev scripts (.bat, gitignored)
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+T` | New pane |
| `Ctrl+1-9` | Focus pane by number |
| `Ctrl+Shift+I` | DevTools |
| `Space` (hold) | Voice input |
| `F12` | Toggle DevTools (dev mode) |
| `Ctrl+Q` / `Cmd+Q` | Quit app |
| `Ctrl+W` / `Cmd+W` | Close window |
| `Ctrl+M` / `Cmd+M` | Minimize window |
| `Escape` | Minimize window |

---

## License

This project is licensed under the [MIT License](https://opensource.org/licenses/MIT) - see the [LICENSE](LICENSE) file for details.
