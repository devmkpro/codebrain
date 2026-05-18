# Codebrain

> Multi-agent AI IDE. Orchestrate Claude, Gemini, and more — side by side, in real time.

---

## What is Codebrain?

Codebrain is an **Electron desktop app** where multiple AI agents work together in a visible terminal grid.

- **Tiling grid** — auto-organizes 1/2/3/4+ panes
- **Focus mode** — expand any pane to 65% with one click
- **Multi-agent squads** — one orchestrator directs many workers
- **Live task sidebar** — agents update a shared todo list
- **Session map** — visual graph of all agent sessions
- **File editor** — browse and edit without leaving the app
- **Browser automation** — 42 browser MCP tools for web testing
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
- **110 MCP tools** — pane, browser, memory, patterns, swarm, hooks, trajectories, files, system, knowledge graph, scoring, pipeline, workers, consensus
- **Voice input** — push-to-talk with Groq Whisper transcription

---

## Quick Start

```bash
git clone https://gitlab.com/maikeofc18/codebrain.git
cd codebrain
npm install
npm run dev
```

That's it. Hot reload is instant.

---

## Build for Production

```bash
# Vite build
npm run build

# Portable ZIP (no admin needed)
node scripts/build-exe.mjs

# NSIS installer (.exe)
npm run dist:win:nsis
```

Output goes to `dist/`.

---

## Releases

Download the latest from [GitLab Releases](https://gitlab.com/maikeofc18/codebrain/-/releases).

Available for:
- Windows x64 (NSIS installer)
- Linux x64 (AppImage + .deb)

### Create a release

```bash
npm version patch        # 1.0.0 → 1.0.1 (updates package.json)
git tag 1.0.1            # tag WITHOUT "v" prefix (must match package.json version)
git push origin main --tags
```

GitLab CI builds Windows (via Wine) and Linux artifacts automatically and creates the release.

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

### Browser automation (42 tools)

| Tool | What it does |
|------|-------------|
| `browser_guide` | MANDATORY — read before any browser tool |
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

**Total: 110 MCP tools**

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
│   ├── mcp/                MCP server (110 agent tools)
│   │   ├── bridge/         Handler modules (13 files)
│   │   │   ├── message-bus.js        Priority in-memory messaging
│   │   │   ├── agent-scorer.js       Multi-factor agent scoring
│   │   │   ├── pipeline-handlers.js  Fan-out/fan-in/pipeline
│   │   │   ├── background-workers.js 7 maintenance daemons
│   │   │   ├── consensus-handlers.js Voting + leader election
│   │   │   └── ...                   pane, browser, memory, swarm, etc.
│   │   ├── index.js        Tool registration (Zod schemas)
│   │   └── bridge.js       Handler composition + auto-notify
│   └── memory/             Shared memory store
│       ├── store.js        SQLite-backed memory + graph-aware search
│       ├── vector-store.js TF-IDF cosine similarity (pure JS)
│       └── knowledge-graph.js  Nodes, edges, PageRank, communities
├── prompts/                Squad system prompts
├── scripts/                Build + release scripts
├── resources/              Icons + bundled skill
└── local/                  Dev scripts (.bat, gitignored)
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+T` | New pane |
| `Ctrl+W` | Close pane |
| `Ctrl+1-9` | Focus pane by number |
| `Ctrl+Shift+I` | DevTools |
| `Space` (hold) | Voice input |

---

## License

This project is licensed under the [MIT License](https://opensource.org/licenses/MIT) - see the [LICENSE](LICENSE) file for details.
