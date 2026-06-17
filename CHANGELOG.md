# Changelog

All notable changes to Codebrain will be documented in this file.

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
