# Relatório: MiMo-Code (OpenCode) vs Codebrain

> Auditoria completa de source code — 2026-07-04
> Fontes: `C:\Users\Maike\Downloads\MiMo-Code-main` (commit GitHub) vs `C:\Users\Maike\Desktop\codebrain` (v1.14.0)

---

## 1. Resumo Executivo

| Dimensão | MiMo-Code (OpenCode) | Codebrain |
|---|---|---|
| **Tipo** | CLI TUI + Desktop + Web + Console | Desktop Electron App |
| **Linguagem** | TypeScript + Bun | TypeScript + Node.js |
| **Framework core** | Effect (functional effect system) | Electron + React + Zustand |
| **UI** | OpenTUI + SolidJS (terminal) | React + Tailwind (desktop GUI) |
| **Arquivos TS** | 518 (só packages/opencode/src) | ~120 (src/ + electron/) |
| **Ferramentas built-in** | 25 (20 always-on + 5 experimental) | — (ferramentas são MCP tools) |
| **MCP Tools** | Servidor MCP incluso (25 built-in tools) | **265 tools** (64 core + 114 advanced + 74 browser + 5 fetch + 8 meta) |
| **Providers** | 11 (opencode, anthropic, openai, google, google-vertex, github-copilot, amazon-bedrock, azure, openrouter, mistral, gitlab) | 16 provider templates (MIMO, Anthropic, Gemini, OpenRouter, OpenAI, DeepSeek, Mistral, xAI, Ollama, Kimi, Cursor, Copilot, Codex) |
| **Agentes** | 3 primary (build/plan/compose) + subagents ilimitados | 5 roles (orchestrator/backend/frontend/ui-tester/gemini-worker) |
| **Memória** | SQLite FTS5 + MEMORY.md + checkpoint.md | SQLite FTS5 + Knowledge Graph (PageRank, cosine similarity, HNSW) |
| **Hooks** | Plugin hooks (actor.preStop/postStop) | 24 lifecycle hooks (spawn/idle/exit/message/task/tool/file/memory/error/performance/consensus/worker) |
| **Skills** | Sistema de skills com CLI | Local + GitLab registry |
| **Voice** | MiMo ASR (streaming) | Whisper (via register-audio.ts) |
| **LSP** | Integrado (experimental) | 12 LSP tools (experimental, on-demand group) |
| **Orçamento de contexto** | Budgeted injection com importância ranking | Session compaction + checkpoints + snapshots |

---

## 2. Arquitetura

### MiMo-Code — Monorepo com Effect

```
packages/
├── opencode/     ← Core engine (518 TS files)
│   ├── src/
│   │   ├── agent/        ← Agent definitions (build/plan/compose)
│   │   ├── session/      ← 45+ session modules (checkpoint, compaction, auto-dream, trajectory...)
│   │   ├── tool/         ← 44 tool files (25 built-in + utilities)
│   │   ├── provider/     ← 11 providers com Effect-based abstraction
│   │   ├── memory/       ← SQLite FTS5 memory
│   │   ├── plugin/       ← Plugin system with lifecycle hooks
│   │   ├── workflow/     ← Built-in workflows (deep-research, compose)
│   │   ├── permission/   ← Granular permission rules
│   │   ├── config/       ← Hierarchical config system
│   │   ├── mcp/          ← MCP server + client
│   │   ├── lsp/          ← Language Server Protocol integration
│   │   ├── skill/        ← Skill loading and management
│   │   ├── task/         ← Task registry
│   │   ├── actor/        ← Subagent orchestration (registry + waiter)
│   │   ├── team/         ← Team coordination
│   │   ├── worktree/     ← Git worktree management
│   │   ├── git/          ← Git integration
│   │   ├── cron/         ← Scheduled task execution
│   │   ├── bus/          ← Event bus (Effect-based)
│   │   ├── pty/          ← Pseudo-terminal management
│   │   ├── auth/         ← OAuth + token management
│   │   └── ...
├── desktop/      ← Tauri desktop app
├── app/          ← SolidJS web app
├── console/      ← Admin console (Hono + SolidJS)
├── enterprise/   ← Enterprise features
├── sdk/          ← JavaScript SDK
├── plugin/       ← Plugin SDK
├── shared/       ← Shared utilities
├── ui/           ← Component library
└── slack/        ← Slack integration
```

**Padrão arquitetural:** Effect (functional effect system com Layer/Deps/Context). Cada módulo é um `Service` com `Layer` de dependency injection. Zero classes globais — tudo via Effect.gen().

### Codebrain — Electron Monolith com MCP Bridge

```
codebrain/
├── electron/
│   ├── main/ipc/           ← 10 register-*.ts files (IPC handlers)
│   ├── main/services/      ← Core services (mcp, hooks, prompts, spawn)
│   └── preload/            ← contextBridge API
├── src/
│   ├── components/         ← React components
│   ├── stores/             ← Zustand stores
│   └── types/              ← TypeScript types
├── packages/
│   ├── mcp/                ← MCP server (265 tools)
│   │   ├── bridge/         ← 10 handler files
│   │   ├── index.js        ← Tool registration (Zod schemas)
│   │   └── bridge.js       ← Handler composition
│   └── memory/             ← SQLite memory (better-sqlite3)
└── prompts/                ← Agent prompt templates
```

**Padrão arquitetural:** 3-tier MCP bridge (handler → registration → wiring). IPC chain para UI (handler → preload → types → store → component). Zustand para estado, Tailwind para styling.

---

## 3. Ferramentas — Comparação Detalhada

### 3.1 Ferramentas Built-in do MiMo-Code (25)

| Tool | Status | Descrição | Codebrain equivalente? |
|---|---|---|---|
| `bash` | Always-on | Executar comandos shell | Não (agentes usam CLI nativa) |
| `read` | Always-on | Ler arquivos | `file_read`, `file_budgeted_read` |
| `glob` | Always-on | Buscar arquivos por padrão | `file_search` |
| `grep` | Always-on | Buscar conteúdo em arquivos | `file_search` (content param) |
| `edit` | Always-on | Editar arquivos (diff-based) | Não (agentes editam diretamente) |
| `write` | Always-on | Escrever arquivos | `file_write` |
| `notebook-edit` | Always-on | Editar Jupyter notebooks | Não |
| `actor` | Always-on | Spawnar subagents | `pane_spawn`, `swarm_assign_task` |
| `fetch` | Always-on | Fetch de URLs (web) | `browser_navigate` + `browser_get_text` |
| `search` | Always-on | Web search (Exa/MiMo) | Não (agents usam WebSearch nativo) |
| `code` | Always-on | Code search (Exa/MiMo) | Não |
| `skill` | Always-on | Carregar skills | `skill_get`, `skill_list`, `skill_install` |
| `patch` | Always-on | Apply unified patches | Não |
| `changedir` | Always-on | Mudar diretório de trabalho | Não (cwd fixo no spawn) |
| `question` | Conditional | Perguntar ao usuário | `question_ask`, `question_answer` |
| `planenter` | Always-on | Entrar em modo plan (read-only) | Não (separado por agent role) |
| `planexit` | Always-on | Sair do modo plan | Não |
| `memory` | Always-on | Ler/escrever memória | `memory_read`, `memory_write`, `memory_search` |
| `history` | Always-on | Histórico de sessões | `history_search`, `history_record` |
| `task` | Always-on | Task tracking (T1, T1.1) | `task_create`, `task_move`, `task_tree` |
| `lsp` | Experimental | Language Server Protocol | Não |
| `cron` | Experimental | Agendamento de tarefas | Não (Codebrain tem via hooks mas sem tool) |
| `session` | Experimental | Orchestration de sessões | `pane_spawn`, `pane_write`, `pane_wait_idle` |
| `workflow` | Experimental | Workflows pré-definidos | Não |
| `invalid` | Always-on | Tool inválido (fallback) | Não |

### 3.2 MCP Tools do Codebrain (265) — MiMo-Code NÃO tem equivalente

| Categoria | Count | Tools notáveis |
|---|---|---|
| **Pane Management** | ~25 | `pane_spawn`, `pane_write`, `pane_read`, `pane_kill_cascade`, `pane_set_role`, `pane_spawn_and_wait` |
| **Memory** | ~15 | `memory_write`, `memory_search`, `memory_read`, `memory_list`, `memory_stats`, `memory_rank`, `memory_graph`, `memory_similar` |
| **Browser Automation** | 74 | CDP + webview: navigation, DOM read/interact, coordinates, keyboard, wait/assert, screenshots, console/network, eval, batch, CDP-only (tabs, intercept, resize, GIF), fetch/scraping (5) |
| **Swarm** | ~8 | `swarm_status`, `swarm_broadcast`, `swarm_respawn`, `swarm_worker_health`, `swarm_assign_task` |
| **Hooks** | 3+3 | Core: `hooks_status`, `hooks_log`, `hooks_fire`. Advanced: `hooks_export_logs`, `hooks_event_stats`, `hooks_correlation_events` |
| **Todo/Kanban** | ~5 | `todo_manager` (set_tasks, add_task, move_to_task, read_list, mark_all_done) |
| **Skills** | ~8 | `skill_create`, `skill_delete`, `skill_get`, `skill_install`, `skill_list`, `skill_uninstall` |
| **Tasks** | ~10 | `task_create`, `task_move`, `task_assign`, `task_complete`, `task_list`, `task_tree`, `task_delete` |
| **Trajectories** | ~8 | `trajectory_record`, `trajectory_add_step`, `trajectory_list`, `trajectory_stats`, `trajectory_extract_patterns` |
| **Session** | ~8 | `session_compact`, `session_compact_save`, `session_compaction_history` |
| **Snapshot** | ~3 | `snapshot_track`, `snapshot_list`, `snapshot_revert` |
| **Goals** | ~4 | `goal_set`, `goal_get`, `goal_judge`, `goal_clear` |
| **Questions** | ~3 | `question_ask`, `question_answer`, `question_list` |
| **Security** | ~2 | `security_scan`, `security_status` |
| **Text Loop Detection** | ~2 | `text_loop_check`, `text_loop_reset` |
| **Agent Monitoring** | ~5 | `agent_list`, `agent_messages`, `agent_status`, `actor_list`, `actor_status` |
| **Provider** | ~5 | `provider_health`, `provider_prompt`, `provider_prompt_list` |
| **System** | ~3 | `system_info`, `system_diagnostics`, `tool_groups` |
| **Handoff** | ~3 | `handoff_submit`, `handoff_wait` |
| **Worker Dispatch** | ~3 | `worker_find_idle`, `worker_detect`, `worker_list_triggers` |
| **Cron** | ~3 | `cron_create`, `cron_list`, `cron_delete` |
| **Consensus** | 19 | Raft (start/stop/append/status), PBFT (start/stop/propose/view-change/status), Gossip (start/stop/set/get/sync/status), swarm_vote/elect_leader/consensus_status |
| **LSP** | 12 | go_to_definition, find_references, hover, document/workspace_symbol, go_to_implementation, call_hierarchy (incoming/outgoing) |
| **Workflows** | 11 | max_mode (run/candidate/judge), compose (start/advance/phases), plan (start/save/read/list/exit) |
| **Background Worker** | 10 | worker_start/stop/status/alerts, start_all/stop_all, execute_trigger, trigger_history, pattern_clusters, force_evolution |
| **Swarm Pipeline** | 10 | fan_out/fan_in, pipeline/status, complete_task, domain_status, worker_loads, steal_work, score_agents, bus_metrics |
| **Event Sourcing** | 5 | event_store/replay/list/snapshot/stats |
| **Outros** | ~15 | `pane_send_message`, `pane_read_messages`, `enable_tool_group`, `file_multi_edit`, `file_budgeted_read`, `intelligence_consolidate`, etc. |

---

## 4. Features Exclusivas de Cada Projeto

### 4.1 Features EXCLUSIVAS do MiMo-Code (Codebrain NÃO tem)

| Feature | Descrição | Impacto |
|---|---|---|
| **Effect (functional effect system)** | Toda a arquitetura usa Effect para DI, error handling, concurrency. Zero classes globais. | Alto — arquitetura muito mais robusta |
| **Voice Input (MiMo ASR)** | Input de voz streaming via TenVAD + MiMo ASR. `/voice` ativa. | Médio — UX diferenciada |
| **LSP Integration** | Language Server Protocol para autocompletion, go-to-definition, diagnostics | Alto — code intelligence nativo |
| **Built-in Workflows** | `deep-research` e `compose` como workflows pré-definidos com phases | Médio — produtividade |
| **Plugin System com Hooks** | `actor.preStop`, `actor.postStop`, `tool.definition` — extensível via plugins | Alto — extensibilidade |
| **Granular Permissions** | `permission/` com arity, evaluate, ruleset — controle fino por tool/agent | Alto — segurança enterprise |
| **Multi-client Architecture** | Mesmo core para CLI, Desktop (Tauri), Web (SolidJS), Console (admin), Slack | Alto — reach |
| **Enterprise Package** | `packages/enterprise/` com features corporativas | Alto — revenue |
| **SDK Package** | `packages/sdk/` — programmatic API para integradores | Médio — ecosystem |
| **Auto-Dream / Auto-Distill** | Sessões automáticas de consolidação de memória (7d/30d) | Alto — memória evolutiva |
| **Budgeted Context Injection** | Injeção de contexto com orçamento de tokens e ranking de importância | Alto — eficiência de contexto |
| **Context Reconstruction** | Reconstrói contexto de checkpoint + memory + task progress quando limite se aproxima | Alto — continuidade |
| **Compose Mode** | Modo estruturado para specs-driven development com skills de planning/TDD/review | Médio — workflow |
| **Goal/Stop Condition com Judge** | `/goal` com modelo juiz independente para avaliar se condição foi satisfeita | Alto — autonomia |
| **Codex/MiMo Import** | Importar sessões do Claude Code e Codex | Baixo — migração |
| **Change Directory Tool** | `cd` como tool para mudar cwd durante sessão | Baixo |
| **Apply Patch Tool** | Aplicar unified diffs como tool separado | Baixo |
| **Code Search (Exa)** | Busca semântica em código via Exa API | Médio |
| **i18n no TUI** | Internacionalização na interface terminal | Baixo |
| **Storybook** | `packages/storybook/` para documentação de componentes UI | Baixo |

### 4.2 Features EXCLUSIVAS do Codebrain (MiMo-Code NÃO tem)

| Feature | Descrição | Impacto |
|---|---|---|
| **Visible Terminal Grid** | Grid visual de terminais — cada agente é um terminal visível com xterm.js | Alto — transparência total |
| **74 Browser Automation Tools** | CDP + webview completo: navigation, DOM, coordinates, keyboard, wait, screenshots, console/network, eval, batch, request interception/mock, tabs, file upload, GIF recording, fetch/scraping | Alto — UI testing nativo |
| **Role Badges** | Cada terminal mostra badge com role (orchestrator/backend/frontend) | Médio — organização |
| **24 Lifecycle Hooks** | pane_spawned/exited/idle, message, task, tool, file, memory, error, performance, consensus, worker — com correlation IDs e export | Alto — observabilidade |
| **Swarm Orchestration + Consensus** | Status, broadcast, respawn, worker_health + Raft/PBFT/Gossip (19 tools) — coordenação distribuída | Alto — multi-agent robusto |
| **Actor Registry** | Registro persistente de actors com status/turn_count/stuck_detection | Alto — monitoring |
| **Kanban Board** | task_create/move/assign com colunas (inbox/assigned/in_progress/review/done) | Alto — organização visual |
| **Task Tree Hierárquico** | T1, T1.1, T1.2 com SQLite — subtasks aninhadas | Médio |
| **Trajectory Recording** | Gravação de ações com extract_patterns — aprende com sucesso | Alto — auto-aprendizado |
| **Pattern Learning** | Sistema de padrões com quality_score — auto-aprende e prioriza | Alto — inteligência |
| **Security Scanner** | `security_scan` — detecção de secrets, vulnerabilidades, code smells | Alto — segurança |
| **Cost Tracking** | Per-model pricing, cost_estimate, cost_models — rastreamento de custos | Alto — financeiro |
| **MCP Server HTTP** | `packages/mcp/server.js` — SSE + Streamable HTTP para clientes externos | Médio — integração |
| **GitLab Review Pipeline** | Review automático de MRs com inline comments | Alto — CI/CD |
| **Multi-provider com Proxy** | API proxy que intercepta TODOS os providers para token counting | Alto — billing |
| **Custom Env Vars** | `globalEnv` em ConfigStore — variáveis customizadas injetadas em todos os agents | Médio |
| **Session Restore** | Auto-restaura sessão com todos os panes/agents via snapshot JSON | Alto — continuidade |
| **Workspace Auto-detection** | Detecta projeto automaticamente via markers (.git, package.json) | Médio — UX |
| **Pane Send Message** | Comunicação inter-agente via mensagem (não terminal write) | Alto — coordenação |
| **Handoff System** | `handoff_submit` / `handoff_wait` — protocolo de entrega de tarefas | Alto — orquestração |
| **Worker Dispatch** | `worker_detect` — detecta triggers e despacha workers automaticamente | Médio — automação |
| **LSP Tools (12)** | go_to_definition, find_references, hover, symbols, call_hierarchy — code intelligence | Alto — code intelligence |
| **Background Workers (10)** | start/stop/status/alerts, triggers, pattern clusters, force evolution | Alto — automação |
| **Event Sourcing (5)** | store/replay/list/snapshot/stats — audit trail completo | Médio — auditabilidade |
| **Knowledge Graph** | memory_graph (traversal), memory_rank (PageRank), memory_similar (cosine/TF-IDF) | Alto — inteligência de memória |
| **Consensus Protocols** | Raft, PBFT, Gossip para coordenação distribuída de agents | Alto — distributed systems |
| **Intelligence Consolidate** | Pipeline completo: RETRIEVE → JUDGE → DISTILL → CONSOLIDATE | Alto — auto-aprendizado |

---

## 5. Providers — Comparação

| Provider | MiMo-Code | Codebrain |
|---|---|---|
| Anthropic (Claude) | `anthropic` | `anthropic` + `claude-oauth` (via API + CLI OAuth) |
| OpenAI | `openai` | `openai` (direct) + `codex`/`codex-oauth` (CLI) |
| Google Gemini | `google` + `google-vertex` | `gemini` (API) + `gemini-cli` (native CLI) |
| OpenRouter | `openrouter` | `openrouter` (10 models) |
| Amazon Bedrock | `amazon-bedrock` | Não |
| Azure | `azure` | Não |
| GitHub Copilot | `github-copilot` | `copilot` (auto-detected CLI) |
| Mistral | `mistral` | `mistral` (4 models) |
| GitLab | `gitlab` | Não |
| MiMo Auto | `opencode` (free tier) | `mimo` + `mimo-claude` (2 providers, 5 models) |
| Claude Code CLI | Não | `claude` (OAuth plan, auto-detected) |
| DeepSeek | Não | `deepseek` (4 models) |
| xAI (Grok) | Não | `xai` (3 models) |
| Ollama (Local) | Não | `ollama` (dynamic) |
| Kimi | Não | `kimi` (2 models) |
| Cursor | Não | `cursor` (auto-detected CLI) |

**MiMo-Code: 11 providers | Codebrain: 16 provider templates (60+ model entries)**

---

## 6. Sistema de Memória — Comparação

| Aspecto | MiMo-Code | Codebrain |
|---|---|---|
| **Storage** | SQLite FTS5 + arquivos .md | SQLite (better-sqlite3) |
| **Tipos de memória** | MEMORY.md, checkpoint.md, notes.md, tasks/<id>/progress.md | episodic, semantic, procedural, working |
| **Busca** | FTS5 full-text search | keyword search + cosine similarity (HNSW) |
| **Auto-consolidação** | Auto-Dream (7 dias) + Auto-Distill (30 dias) | `auto_dream` manual |
| **Importação** | Claude Code, Codex, OpenCode | Claude Code memory import |
| **Checkpoint** | Automatic checkpoint writer subagent | checkpoint_write/read + snapshot_track |
| **Context Injection** | Budgeted injection com importance ranking | Session compaction + recent turns |
| **Pattern Learning** | Via distill (identifica workflows repetidos) | `pattern_write`/`pattern_list` com quality_score |
| **PageRank** | Não | `memory_rank` — PageRank para memórias |

---

## 7. Sistema de Agentes — Comparação

| Aspecto | MiMo-Code | Codebrain |
|---|---|---|
| **Primary Agents** | build, plan, compose (Tab para alternar) | Orchestrator (implícito no chat) |
| **Subagents** | Ilimitados, spawned by `actor` tool | Workers spawned by `pane_spawn` |
| **Visibilidade** | Background (não visíveis no TUI) | Terminais visíveis no grid |
| **Roles** | Sem roles formais — per-based | Role badges (orchestrator/backend/frontend/ui-tester) |
| **Communication** | Compartilham contexto da sessão | `pane_send_message` + `pane_write` |
| **Orchestration** | `session` tool (orchestrator-only) | Orchestrator prompt + `pane_spawn_and_wait` |
| **Cancellation** | Via actor registry | `pane_kill_cascade` (recursive) |
| **Stuck Detection** | Não mencionado | `actor_status` com stuck detection |
| **Model Override** | Per-agent model config | Per-pane model via `pane_spawn` |
| **Goal/Judge** | `/goal` com modelo juiz | `goal_set` + `goal_judge` |

---

## 8. Tech Stack — Comparação

| Aspecto | MiMo-Code | Codebrain |
|---|---|---|
| **Runtime** | Bun 1.3 | Node.js |
| **Framework** | Effect (functional) | Electron |
| **UI Framework** | OpenTUI + SolidJS | React 18 |
| **Styling** | Tailwind CSS v4 | Tailwind CSS |
| **State** | Effect Services + InstanceState | Zustand |
| **Database** | Drizzle ORM + SQLite | better-sqlite3 |
| **Schema** | Zod + Effect Schema | Zod |
| **Build** | Bun build + Turbo | Vite + esbuild |
| **Desktop** | Tauri | Electron |
| **Web** | SolidStart (SSR) | Vite SPA |
| **Package Manager** | Bun | npm |
| **Monorepo** | Turborepo | npm workspaces (single package) |
| **Linting** | oxlint | ESLint (implícito) |
| **Testing** | Playwright (e2e) | Vitest |
| **CI/CD** | SST (AWS) + GitHub Actions | GitLab CI |

---

## 9. Maturidade e Escopo

| Métrica | MiMo-Code | Codebrain |
|---|---|---|
| **Repositório** | github.com/anomalyco/opencode | Privado (GitLab) |
| **Equipe estimada** | 10-20 devs (monorepo com enterprise/SDK) | 1-2 devs (Maike) |
| **Pacotes** | 17+ packages | 3 packages (root, mcp, memory) |
| **Lines of Code** | ~518 TS files (só core) + milhares em UI/SDK | ~120 TS files + ~10 JS handler files |
| **Target** | Developer tool (CLI + Desktop + Web + Enterprise) | Developer tool (Desktop IDE) |
| **Business Model** | SaaS (MiMo Auto free tier + Enterprise) | Open source / local-first |
| **Open Source** | MIT license | Não (privado) |
| **LSP** | Sim (experimental) | Não |
| **Voice** | Sim (MiMo ASR) | Não |
| **i18n** | Sim (TUI) | Não |

---

## 10. Gaps do Codebrain vs MiMo-Code

### 🔴 Gaps Críticos (features que MiMo-Code tem e Codebrain precisa)

1. **Effect System / Arquitetura funcional** — MiMo-Code usa Effect para DI, error handling, concurrency. Codebrain usa classes e callbacks. Impacto: robustez, testabilidade, composição.

2. **Budgeted Context Injection** — MiMo-Code injeta contexto com orçamento de tokens e ranking de importância. Codebrain usa compaction genérica. Impacto: eficiência de contexto, menos desperdício.

3. **Context Reconstruction** — Quando contexto se esgota, MiMo-Code reconstrói de checkpoint + memory + task. Codebrain só compacta. Impacto: continuidade em sessões longas.

4. **Granular Permissions** — MiMo-Code tem `permission/` com arity, evaluate, ruleset por tool/agent. Codebrain tem permissões básicas via role. Impacto: segurança enterprise.

5. **Plugin System** — MiMo-Code permite plugins com hooks (preStop, postStop, tool.definition). Codebrain tem skills mas não plugins extensíveis. Impacto: extensibilidade.

### 🟡 Gaps Médios (features úteis que Codebrain poderia implementar)

6. **LSP Integration** — Autocompletion, go-to-definition via Language Server Protocol.

7. **Voice Input** — Input de voz para o agent.

8. **Built-in Workflows** — Workflows pré-definidos (deep-research, compose) com phases.

9. **Code Search (Exa)** — Busca semântica em código via API externa.

10. **Multi-client Architecture** — Mesmo core para CLI + Desktop + Web + Slack.

11. **SDK Package** — API programática para integradores.

12. **Auto-Dream / Auto-Distill automáticos** — Codebrain tem `auto_dream` manual, MiMo-Code agenda automaticamente (7d/30d).

### 🟢 Gaps Baixos (nice-to-have)

13. Notebook edit tool
14. Apply patch tool (separado)
15. Change directory tool
16. i18n

---

## 11. Gaps do MiMo-Code vs Codebrain

### 🔴 Gaps Críticos

1. **Visible Terminal Grid** — MiMo-Code roda subagents em background invisível. Codebrain mostra cada agente como terminal visível. Impacto: transparência, debug.

2. **Browser Automation (74 tools)** — MiMo-Code não tem browser automation. Codebrain tem CDP + webview com 74 tools para UI testing. Impacto: QA automation.

3. **Swarm Orchestration Tools** — MiMo-Code tem subagents mas sem ferramentas de gerenciamento (status, broadcast, respawn, health). Codebrain tem 10+ swarm tools + consensus (Raft/PBFT/Gossip). Impacto: operação multi-agent.

4. **Lifecycle Hooks (24)** — MiMo-Code tem apenas 2 plugin hooks. Codebrain tem 24 lifecycle events. Impacto: observabilidade.

5. **Pattern Learning** — MiMo-Code tem distill mas não tem sistema de padrões com quality_score que melhora com uso. Codebrain tem `pattern_write/list/update`. Impacto: auto-aprendizado.

6. **Consensus Protocols (19 tools)** — Raft, PBFT, Gossip para coordenação distribuída de agents. MiMo-Code não tem equivalente.

### 🟡 Gaps Médios

6. **Cost Tracking** — MiMo-Code não tem per-model pricing ou cost estimation visível.

7. **Security Scanner** — MiMo-Code não tem scan de secrets/vulnerabilidades.

8. **Kanban Board** — Codebrain tem task management visual com colunas.

9. **Trajectory Recording** — Codebrain grava ações e extrai padrões automaticamente.

10. **GitLab Review Pipeline** — Codebrain faz review automático de MRs.

11. **Handoff Protocol** — Protocolo estruturado de entrega de tarefas entre agents.

### 🟢 Gaps Baixos

12. Session restore automático
13. Workspace auto-detection
14. Custom env vars injection
15. Text loop detection

---

## 12. O que o MiMo-Code Faz MELHOR

1. **Arquitetura** — Effect system é superior a classes/callbacks para DI, error handling, e composição funcional.
2. **Context Management** — Budgeted injection + reconstruction é muito mais inteligente que compaction genérica.
3. **Multi-client** — CLI + Desktop + Web + Console + Slack a partir do mesmo core.
4. **Provider Breadth** — 11 providers nativos vs 16 templates do Codebrain (mas Codebrain tem mais providers).
5. **Plugin System** — Extensível via hooks e plugins carregados dinamicamente.
6. **Voice** — Input de voz nativo.
7. **LSP** — Code intelligence nativo.
8. **Auto-memory** — Dream/distill automáticos para consolidação de memória.

---

## 13. O que o Codebrain Faz MELHOR

1. **Multi-agent Transparency** — Terminais visíveis para cada agente. O usuário vê TUDO.
2. **Browser Automation** — 74 tools para UI testing (CDP + webview). MiMo-Code não tem nada equivalente.
3. **Swarm + Consensus** — 10 swarm tools + 19 consensus tools (Raft/PBFT/Gossip). Coordenação distribuída real.
4. **Pattern Learning** — Sistema que melhora com uso (quality_score) + auto-promote de short-term para long-term.
5. **Cost Visibility** — Per-model pricing, estimativas, rastreamento via API proxy.
6. **Lifecycle Observability** — 24 hooks para monitorar tudo, com correlation IDs e export JSONL/CSV.
7. **Security Scanning** — Scan de secrets (7 patterns) e vulnerabilidades (8 patterns) integrado.
8. **Kanban + Task Tree + Todo** — 3 sistemas de organização de tarefas complementares.
9. **GitLab Integration** — Review automático de MRs com inline comments.
10. **MCP Tool Count** — 265 tools (vs 25 built-in do MiMo-Code).
11. **Knowledge Graph** — PageRank, cosine similarity (TF-IDF), graph traversal para memórias.
12. **LSP Tools (12)** — Code intelligence via Language Server Protocol (experimental).
13. **Background Workers (10)** — Workers autônomos com triggers, pattern clusters, force evolution.
14. **Event Sourcing** — Audit trail completo com store/replay/snapshot.
15. **Intelligence Consolidate** — Pipeline RETRIEVE→JUDGE→DISTILL→CONSOLIDATE em uma chamada.
16. **16 Provider Templates** — 60+ model entries (vs 11 do MiMo-Code).

---

## 14. Recomendações para Codebrain

### Alta Prioridade (implementar em 1-3 meses)

1. **Budgeted Context Injection** — Implementar orçamento de tokens para injeção de contexto (memory, patterns, checkpoint) com ranking de importância. Evita desperdício e melhora qualidade das respostas.

2. **Context Reconstruction** — Quando contexto se esgota, reconstruir de checkpoint + memory + task ao invés de apenas compactar. Mantém continuidade.

3. **Auto-Dream/Distill automáticos** — Transformar `auto_dream` manual em cron automático (7 dias para dream, 30 dias para distill).

4. **Plugin System** — Criar sistema de plugins com hooks (tool.definition, agent.preStop, agent.postStop) para extensibilidade.

### Média Prioridade (3-6 meses)

5. **Granular Permissions** — Sistema de permissões por tool/agent com rulesets.

6. **Built-in Workflows** — Workflows pré-definidos com phases (ex: "full-feature" = plan → backend → frontend → test → review). Codebrain já tem 11 workflow tools mas sem built-in scripts equivalentes ao deep-research/compose do MiMo-Code.

7. **Voice Input** — Codebrain já tem register-audio.ts mas precisa de integração streaming similar ao MiMo ASR.

8. **LSP Stability** — Codebrain já tem 12 LSP tools (experimental). Priorizar estabilização e tornar always-on.

### Baixa Prioridade (6-12 meses)

9. **Multi-client Architecture** — Separar core engine do Electron para permitir CLI e Web.

10. **SDK Package** — API programática para integradores.

11. **Enterprise Features** — Multi-tenant, audit log, SSO.

---

## 15. Conclusão

**MiMo-Code** é um projeto de **equipe grande** (Xiaomi/MiMo) com arquitetura sofisticada (Effect system), multi-client, e foco em **developer experience** (voice, LSP, workflows). É mais maduro em termos de arquitetura e context management.

**Codebrain** é um projeto de **solo developer** (Maike) que compensa com **inovação em multi-agent** (terminais visíveis, swarm orchestration, browser automation) e **ferramentas únicas** (pattern learning, cost tracking, security scanning, GitLab review). Tem mais ferramentas MCP (265) do que MiMo-Code tem built-in tools (25).

**Os projetos são complementares, não concorrentes.** MiMo-Code é um CLI/desktop developer tool. Codebrain é um multi-agent IDE. As maiores oportunidades para Codebrain estão em: (1) context management inteligente, (2) plugin system, e (3) auto-memory automáticos — todos features que MiMo-Code já tem e que elevariam a qualidade das sessões multi-agent.
