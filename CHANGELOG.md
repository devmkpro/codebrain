# Changelog

All notable changes to Codebrain will be documented in this file.

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
