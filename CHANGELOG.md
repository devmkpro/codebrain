# Changelog

All notable changes to Codebrain will be documented in this file.

## [1.15.3] — 2026-07-22

### Fixes
- OpenRouter + Claude Code CLI: modelos não-Anthropic (moonshotai/kimi-k3, google/*, meta-llama/*, etc.) agora funcionam via Claude Code usando `claude-sonnet-4-5` como placeholder local e `ANTHROPIC_DEFAULT_SONNET_MODEL` com o modelo real
- OpenRouter + Claude Code CLI: `ANTHROPIC_BASE_URL` agora sem `/v1` (Claude Code appende sozinho, evitando `/v1/v1/` duplicado)
- Health check: URL `/v1` duplicada corrigida para todos providers openai-compat via `stripV1Suffix()`
- Health check: OpenRouter pula listagem de modelos (400+ modelos) e usa `openai/gpt-4o-mini` como fallback
- ProviderForm: removido `useEffect` que forçava `host: "openclaude"` para OpenRouter, permitindo Claude Code CLI
- ProviderForm: opção "Claude Code" agora visível para providers OpenRouter com label correto
- `resolve-spawn-target`: quando `preferredAgent=claude` e provider é OpenRouter, usa `agent=claude` corretamente
- `pane-spawn`: OpenRouter não mais força `openclaude` quando `provider.type=openai-compat`

## [1.15.2] — 2026-07-16

### Features
- OpenRouter model picker with search, multi-select, and public catalog fetch (289 MCP tools)

### Fixes
- mergeModels now respects user-edited models for existing providers (no more template override)
- Auto-fetch no longer overrides model edits when saving existing providers
- Claude Code host disabled for OpenRouter (only works with Anthropic-compat providers)
- Force OpenClaude when host=claude but provider is not anthropic/mimo/oauth
- Improved OAuth warning message (accurate per provider type)
- × button for removing models now visible (was gray-700 on black)

## [1.15.1] — 2026-07-06

### Features
- Real token counting from Claude Code JSONL session files with USD cost badge per pane
- Orchestrator panes show Σ mission total (sum of all workers' tokens + cost)
- LibreWizard expanded to 6-step flow with model selection per worker
- Terminal Alt+Click cursor jump and paste queue with Esc cancel
- OpenRouter and Fireworks.ai providers added with accurate pricing in cost-tracker

### Fixes
- Removed all audio/voice/Gemini Live code (BrainVoiceOrb, register-voice, register-gemini-live)
- AppHeader cleaned of BrainVoiceButton and orbVisible references

## [1.15.0] — 2026-07-05

### Features
- Proactive shared memory: new `memory_digest` MCP tool (290 total) returns everything other agents did since your last turn (memories, handoffs, file changes), with per-agent `last_seen_ts` tracking
- Auto-handoff to memory: every `handoff_submit` now writes a searchable episodic memory so any agent can find a worker's result via `memory_search`
- Libre Mode redesigned as orchestrator + workers: pick the orchestrator model and how many workers (with their own models); the orchestrator spawns with `role: orchestrator` and is aware of its workers via `SQUAD_WORKER_IDS`

### Fixes
- MCP failed to start (`Cannot find module '../context'`) — removed a runtime `require` that the bundler could not resolve after flattening
- Loop-detector warnings leaked into the user's terminal input — warnings now go to the agent inbox, and idempotent read-only tools (digest/search/status polling) are whitelisted so they never false-positive
- Orchestrators spawned from the UI (Libre/Squad) showed the WORKER badge — `actorRegister` now persists `role`, and UI spawns register their role in the actor registry
- Removed the Jarvis module and Guided Onboarding entirely (backend, frontend, menus, MCP tools)

## [1.14.0] — 2026-07-04

### Features
- Mission-scoped orchestration: `mission_context` auto-discovery, roles persisted in the actor registry, and a mandatory mission task board (kanban) that the Tasks panel now reads
- Role badge in the terminal header (Orchestrator / Worker) with live updates
- Agent/CLI preferred selector — Settings section + header control; used as tie-breaker across all spawn paths (including MCP `pane_spawn`)
- Silent worker watchdog — the mission's orchestrator is notified in the background when a worker stalls or exits, without touching the user's input
- Idle-worker reuse: `worker_find_idle` + spawn now reuses an available idle worker of the same model instead of spawning a new pane
- Orchestrator-as-coordinator guardrails (delegate-first, cost-aware, requires double confirmation to execute directly)
- Unified top header: shared Providers / Preferred Agent / Squad controls across Home and Workspace, grouped into a compact menu in the workspace bar so tabs stay visible
- New Codebrain brand assets (icons, logo, wordmark) and primary color refresh to #5855e5

### Fixes
- Files panel showed "empty" — corrected the `files:list` IPC contract
- Terminal text selection misaligned — migrated app zoom to native `setZoomFactor`, removing the coordinate hacks
- Statusline showed `v?` / `MCP 0 tools` in freshly opened workspaces — real version + tool count now synced (265 tools) and provisioned per workspace
- Removed the obsolete "Review Bot" settings menu

## [1.13.1] — 2026-07-03

### Fixes
- Remove Review Bot onboarding screen from WhatsNewModal

## [1.13.0] — 2026-07-03

### Features
- **feat: remove MR/PR review feature** — removed 2054 lines across 23 files. Deleted mr-handlers, mr-review-store, MrFixModal, register-mr-review IPC, registerMRTools from MCP, mr_poll background worker, and all MR references from prompts and UI. 257 total MCP tools.

### Fixes
- **fix: spawn system — worker config injection, role mapping, OpenRouter routing, duplicate guard** — orchestrator now receives worker config (providerId, model) in system prompt instead of invisible env var; workers get correct role (ui-tester prompt); OpenRouter google/* models route via OpenAI adapter; duplicate guard checks provider/model, not just label
- **fix: React getSnapshot infinite loop and duplicate key warnings** — stable empty array references in Grid.tsx and MissionSidebar.tsx Zustand selectors; deduplicate registryIndex by id in SettingsPage marketplace

## [1.12.4] — 2026-06-29

### Fixes
- **fix: Node.js 24 compatibility** — `node:` prefix for built-in modules, SEA `.exe` detection, and settings file passing via environment variable instead of argv (avoids ESM loader errors)
- **fix: clipboard IPC consistency, right-click selection loss, and text loop terminal noise** — unified clipboard handling across IPC boundaries, prevented right-click from clearing text selection, suppressed noisy loop detection output in terminal

### Other
- **chore: cleanup temp scripts on PtyManager startup** — removes leftover temp files from previous sessions

## [1.12.3] — 2026-06-24

### Fixes
- **fix: ERR_UNKNOWN_FILE_EXTENSION no Windows com NVM** — quando `where claude` retorna `claude.exe` diretamente (NVM), o arquivo pode ser um wrapper Node.js sem header PE32 MZ. O Codebrain agora detecta isso antes do branch `.cmd/.bat`, e redireciona para: (1) shim `.cmd`/`.bat` na mesma pasta, (2) script `.js` via `node`, evitando o crash do ESM loader no Node.js v24.

## [1.12.2] — 2026-06-24

### Fixes
- **fix: Windows .exe shim detection** — ao resolver binários no Windows, verifica magic bytes MZ antes de usar o `.exe`. CLIs instalados via NVM (ex: `@anthropic-ai/claude-code`) geram `claude.exe` que é um wrapper Node.js sem header PE32 — usá-lo diretamente causava `ERR_UNKNOWN_FILE_EXTENSION` no ESM loader. Agora o Codebrain pula para o Step 2 (shim `.cmd`) nesses casos.

## [1.12.1] — 2026-06-21

### Fixes
- **fix: pane_write usa bracketed paste** — preserva formatação multi-linha (antes sanitizava `\n` → espaço, colapsando prompts em uma linha só)
- **fix: handoff_submit auto-notifica orquestrador** — `pokeOrchestrator` injeta `[squad] Worker X finished` diretamente no PTY do orquestrador via Promise chain serializada (500ms + 350ms delay), eliminando necessidade de polling manual
- **fix: pane_send_message type="task" acorda o receptor** — agora usa `pane_write` com submit=true para tasks; outros types continuam como banner silencioso sem interromper
- **fix: idle broadcast removido** — `sendAgentNotification` em `pane_spawned`, `pane_exited`, `memory_write`, `file_write` e `idle` removidos — eram fonte primária de loops entre agentes
- **fix: loop detector não dispara em orquestrador** — text loop e step signature detectors agora pulam panes com role="orchestrator" (falso positivo durante multi-step orchestration)
- **fix: threshold do loop detector** — 3 → 5 outputs idênticos consecutivos + janela de comparação 200 → 400 chars
- **new: pane_wait_many** — novo tool que bloqueia até any/all workers ficarem idle ou submeterem handoff, com suporte a matchStrings. Elimina polling manual de múltiplos workers (262 total MCP tools)
- **new: WORKER_CONTRACT_FOOTER** — appendado automaticamente em todo pane_write de task (>80 chars) instruindo worker a chamar handoff_submit como última ação

## [1.12.0] — 2026-06-17

### Features
- **SQLite-backed browser request logger**: New `request-logger.js` module that auto-intercepts and persists ALL HTTP requests to SQLite for scraping analysis
- **5 new MCP tools for browser requests**: `browser_requests_log` (query all captured requests with filters), `browser_requests_search` (full-text search across request/response bodies), `browser_requests_stats` (statistics by method, status, top sites), `browser_requests_export` (JSON/CSV export), `browser_requests_clear` (clear log)
- **CDP request interception improvements**: Enhanced `cdp-client.js` with better request capture and forwarding
- **261 total MCP tools** (was 244)

## [1.11.3] — 2026-06-17

### Fixes
- **Auto-repair stale MCP paths in `~/.claude.json`**: On every startup, scans all per-project `mcpServers` entries and fixes the known `resources\resources\mcp-stdio` double-path bug (17 affected projects). Also detects any path pointing to a non-existent file and replaces with the correct stdio path. Prevents "MCP failed" error when opening Claude Code in any project.

## [1.11.2] — 2026-06-17

### Fixes
- **MCP server crash on startup**: `auto-memory-handlers.js` comment contained `*/` inside glob pattern `*/memory/*.md` which JS parser interpreted as end-of-comment, leaving bare `memory;` statement → ReferenceError crash. Fixed by converting to line comments.
- **MCP stale path bug**: `~/.mcp.json` and `~/.claude.json` project entries kept pointing to non-existent `resources/packages/mcp/stdio.js` instead of `resources/mcp-stdio/stdio.cjs`. Root cause: `setupClaudeIntegration()` returned early in dev mode (missing `electron/.claude/` dir), so `~/.mcp.json` was never updated; `refreshAllWorkspaces()` only checked `!existing.command` (not path correctness), so stale entries persisted forever.
- **`getStdioPath()` unreliable `__dirname` in dev mode**: electron-vite resolves `__dirname` differently than expected, producing paths like `Desktop/resources/...` (missing `/codebrain/`). Fixed to use `app.getAppPath()` which always returns the correct project root.
- **`~/.mcp.json` update moved before early return**: Step 0 (write `~/.mcp.json`) now runs before the `bundledDir` existence check, ensuring the MCP config is always updated even when `electron/.claude/` doesn't exist in dev mode.

## [1.11.1] — 2026-06-17

### Fixes
- MCP auto-detection: workspace `.mcp.json` now uses stdio transport (was streamable-http, broke standalone Claude Code)
- `ensureClaudeSettings` now runs on app startup (was only called when spawning panes, leaving workspace settings stale)
- `refreshAllWorkspaces` writes stdio in `.mcp.json` and `~/.claude.json` projects (HTTP kept for OpenClaude/Gemini/Codex/Kimi configs)
- Workspace `.claude/settings.json` synced with correct version + 250 MCP tools on every app start

### Other
- 250 total MCP tools (was showing 172 in global settings)

## [1.11.0] — 2026-06-16

### Features
- **Semantic Hash Embeddings** — 384-dim dense vectors replace TF-IDF for knowledge graph similarity (packages/memory/vector-store.js)
- **Auto-Memory Bridge** — import ALL Claude Code project memories (~/.claude/projects/*/memory/*.md) into SQLite for cross-project knowledge (packages/memory/auto-memory-bridge.js)
- **Short-term Pattern Promotion** — session-level patterns auto-promote to long-term after 3 uses + 0.6 quality (packages/memory/store.js)
- **Intelligence Pipeline** — full RETRIEVE→JUDGE→DISTILL→CONSOLIDATE pass via `intelligence_consolidate` MCP tool
- **Security Scanner** — automated secret detection (passwords, API keys, tokens) + vulnerability scanning (SQL/command injection, eval) via `security_scan` MCP tool
- **20 Agent Prompts** — specialized roles: code-analyst, security-auditor, performance-engineer, api-designer, test-generator, database-optimizer, refactor-specialist, system-architect, ci-pipeline-builder, code-reviewer, dependency-auditor, bottleneck-analyzer, migration-planner, tech-lead, readme-writer, docker-optimizer, lint-fixer, tech-researcher, changelog-generator, competitor-analyzer
- **20 Slash Commands** — discoverable via /command syntax: squad, memory, security, pattern, agent, task, system, coordination
- **Statusline Auto-Detection** — auto-reads version from package.json and counts MCP tools from index.js when settings.json has stale values

### MCP Tools — 250 total (was 244)
- `mcp__codebrain__memory_import_claude` — import Claude Code memories cross-project
- `mcp__codebrain__memory_bridge_status` — auto-memory bridge status
- `mcp__codebrain__memory_scan_claude` — scan available memory files without importing
- `mcp__codebrain__security_scan` — scan workspace for secrets and vulnerabilities
- `mcp__codebrain__security_status` — last scan result
- `mcp__codebrain__intelligence_consolidate` — full intelligence pipeline pass

### Changes
- Tool group reclassification: session_advanced (7), memory_advanced (4), mission (5) promoted to essential (always-on)
- Knowledge graph now uses semantic-hash embeddings by default (was TF-IDF)
- EmbeddingService LRU cache increased to 2000 entries

## [1.10.7] — 2026-06-17

### Fixes
- Browser: fixed `pageTarget` scope bug in CDP client connect function
- Browser: Chrome without CDP now auto-kills and relaunches with CDP enabled
- Browser: removed webview fallback — CDP (native Chrome) is now required for all browser commands

## [1.10.6] — 2026-06-17

### CI/CD
- GitHub mirror: auto-sync from GitLab to GitHub on every push
- GitHub Releases: auto-upload AppImage, deb, exe to GitHub Releases on tags
- Pipeline cleanup: fixed YAML syntax, jq dependency removed

### Marketplace
- New "Marketplace" section in Settings with catalog browsing
- Search, filter (All/Agents/Skills), install/remove 1-click
- Local filesystem scan for installed skills
- GitLab API integration with Cloudflare fallback

## [1.10.2] — 2026-06-16

### Features — 25 MiMo-Code Features Ported
- **Session Compaction** — LLM-based summarization when context pressure is high
- **Goal/Judge System** — independent judge evaluates if autonomous work is truly done
- **Session Snapshots** — revert workspace to any previous state
- **Checkpoint Writer** — 11-section structured checkpoints with validation
- **Checkpoint Validation** — 13 rules, per-section token budgets, spillover files
- **Cross-Session History** — FTS5 search across ALL conversation history with BM25
- **LSP Integration** — 12 semantic code navigation tools (goToDefinition, findReferences, hover, etc.)
- **Text Loop Recovery** — progressive recovery prompts for stuck agents
- **Step Classification** — classify steps (final/continue/filtered/think-only/invalid/failed)
- **Max Mode** — Best-of-N: N parallel candidates, judge selects best
- **Compose Mode** — specs-driven workflow: plan → execute → review → test → debug → verify → merge
- **Plan Agent** — read-only mode for code exploration before implementation
- **Question Tool** — structured user interaction with predefined options
- **Multi-Edit** — batch multiple edits on a single file in one call
- **Provider-Specific Prompts** — model-optimized prompts per family (Claude, Gemini, GPT, MIMO)
- **Task Gate Pre-Stop** — checks incomplete tasks before allowing agent to stop
- **Memory Path Guard** — validates memory write paths against allowed scopes
- **Actor Return Header** — structured status/summary/files/findings parsing
- **Actor Lifecycle** — ephemeral vs persistent workers
- **Instruction File Hierarchy** — AGENTS.md/CLAUDE.md discovery walking up directories
- **Subagent Progress Checker** — validates progress documentation before termination
- **Enhanced Loop Detection** — key-order-independent signatures via stableStringify
- **Bus Event System** — typed event bus for subsystem decoupling
- **Actor Orphan Recovery** — marks stale actors on startup
- **Checkpoint Splitover** — splits over-budget checkpoints into spillover files

### Tool Classification
- 20 essential tools (always enabled)
- 30 on-demand tools in 3 groups: session_advanced (7), lsp (12), workflows (11)

## [1.10.0] — 2026-06-16

### Features
- Ported 8 MiMo-Code features (Phase 1-3):
  - FTS5 Memory Search with BM25 ranking
  - Actor Stuck Detection (60s scanner)
  - Repeated-Step Loop Detection
  - Context Pressure Levels (0-3)
  - Budgeted File Read (token-aware)
  - Memory Auto-Pruning (7-day cleanup)
  - Task Tree Structure (hierarchical IDs)
  - Auto-Dream + Auto-Distill

## [1.9.5] — 2026-06-16

### Features
- Auto-download portable Chromium on first browser_launch
- Bundle portable Chromium for offline browser automation
- Fix CDP detection with Brave on port 9222

## [1.9.4] — 2026-06-16

### Features
- Actor registry with persistent SQLite storage
- Provider host fix for MiMo Claude
- ProviderList key fix

## [1.9.3] — 2026-06-15

### Features
- Auto-fix modal for MR review findings
- GitLab MR/PR auto-review with AI
- Health endpoint (`/api/health`)
- Server shutdown race condition fixes

## [1.8.x] — 2026-06

### Features
- Mission system (create, switch, archive)
- Desktop notifications on task complete
- CLI auto-install (OpenClaude, Claude, Codex, Gemini)
- Discord Rich Presence
- Session export (Markdown/JSON)
- Session history (SQLite-backed)
- Token cost tracking (140+ models)
- Voice input (Groq Whisper)
- Skills marketplace
- Knowledge graph with PageRank
- Pipeline coordination (fan-out/fan-in)
- Background workers (7 daemons)
- Consensus protocols (Raft, PBFT, Gossip)
- Browser automation (60 CDP tools)

## [1.7.x] — 2026-05

### Features
- Discord RPC integration
- Layout redesign
- Notifications system
- Skills marketplace
- Session export and history

## [1.6.x] — 2026-05

### Features
- Settings page migration
- Session restore
- GitLab pipeline CI/CD

## [1.5.x] — 2026-05

### Features
- Multi-agent squad orchestration
- Shared memory (SQLite)
- Pattern learning
- Trajectory tracking
- Lifecycle hooks

---

For full details, see [releases on GitLab](https://gitlab.com/maikeofc18/codebrain/-/releases) or [GitHub Releases](https://github.com/devmkpro/codebrain/releases).
