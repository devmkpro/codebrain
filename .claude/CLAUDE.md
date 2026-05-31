# Codebrain — Project Instructions for Claude Code

> Multi-agent IDE built with Electron + React + TypeScript
> 97 MCP tools | Squad orchestration | Shared memory | Pattern learning

---

## 🔧 Skills — USE SEMPRE AUTOMATICAMENTE

Você tem skills especializadas do Codebrain. As skills são injetadas no system prompt com conteúdo completo. **Ao detectar um trigger, execute diretamente os passos da skill correspondente** — não use `Skill()` tool (isso é para slash commands do Claude Code, não para skills do Codebrain).

**REGRA:** Se o pedido do usuário bater com qualquer trigger de skill → execute imediatamente os passos descritos na seção da skill no system prompt. Não pergunte, não explique — execute direto. Se precisar consultar uma skill que não está no prompt, use `mcp__codebrain__skill_get({ id: "nome-da-skill" })`.

---

## Project Overview

Codebrain is an Electron desktop application that provides a multi-agent IDE experience. It allows users to spawn AI agents (orchestrator, backend worker, frontend worker, UI tester) that communicate in real-time via shared memory and inter-agent messaging.

**Key Features:**
- Multi-agent squad orchestration (orchestrator + specialized workers)
- 97 MCP tools for pane management, browser automation, memory, patterns, swarm, trajectories, hooks, skills
- Shared memory (SQLite-backed) across all agents in a workspace
- Pattern learning (auto-learns successful approaches)
- Browser automation (30 tools for UI testing)
- Skills system (install prompt templates from local or GitLab registry)
- Hooks system (lifecycle events: spawn, exit, idle, message, task)

---

## Architecture

```
codebrain/
├── electron/
│   ├── main/                    # Main process (Node.js)
│   │   ├── ipc/                 # IPC handlers (register-*.ts pattern)
│   │   │   ├── register-all.ts  # Unified registration
│   │   │   ├── register-pane.ts # Pane management
│   │   │   ├── register-skill.ts # Skills CRUD + GitLab sync
│   │   │   ├── register-browser.ts # Browser automation
│   │   │   └── register-*.ts    # Other IPC groups
│   │   └── services/
│   │       ├── prompts.ts       # System prompts (CODEBRAIN_SYSTEM_PROMPT)
│   │       ├── hooks.ts         # HooksManager (EventEmitter-based)
│   │       ├── mcp.ts           # MCP server startup + bridge wiring
│   │       └── pane-spawn.ts    # Squad spawning logic
│   └── preload/
│       └── index.ts             # contextBridge API (window.codeBrainApp)
├── src/                         # Renderer (React + Vite)
│   ├── components/
│   │   ├── skills/              # SkillsPanel.tsx
│   │   ├── settings/            # SettingsModal.tsx
│   │   └── navigation/          # releases-data.ts (auto-generated)
│   ├── stores/                  # Zustand stores (skills-store.tsx, etc.)
│   ├── types/
│   │   └── electron.d.ts        # TypeScript types for IPC API
│   └── views/
│       └── home/                # SettingsPage.tsx
├── packages/
│   ├── mcp/                     # MCP server (91 tools)
│   │   ├── bridge/              # Handler modules (8 files)
│   │   │   ├── browser-handlers.js
│   │   │   ├── memory-handlers.js
│   │   │   ├── pane-handlers.js
│   │   │   ├── swarm-handlers.js
│   │   │   ├── hooks-handlers.js
│   │   │   ├── file-handlers.js
│   │   │   ├── todo-handlers.js
│   │   │   ├── worker-dispatch.js
│   │   │   └── skill-handlers.js
│   │   ├── bridge.js            # Composes all handlers
│   │   ├── index.js             # Tool registration (Zod schemas)
│   │   └── server.js            # HTTP server (SSE + Streamable HTTP)
│   └── memory/
│       └── store.js             # SQLite-backed memory (memories + patterns + trajectories)
├── prompts/                     # Agent prompt templates
│   ├── squad-orchestrator.md    # Orchestrator system prompt
│   ├── squad-worker.md          # Standard worker prompt
│   ├── squad-worker-gemini.md   # Gemini-optimized worker prompt
│   └── squad-ui-tester.md       # UI Tester prompt
├── resources/
│   └── codebrain-skill/         # Bundled skill (installs to ~/.claude/skills/)
│       └── codebrain.md         # MCP tools documentation for Claude
└── scripts/
    └── gen-releases.mjs         # Auto-generates releases-data.ts from git tags
```

---

## Key Patterns

### IPC Handler Registration (3-tier)

Every feature follows this pattern:

1. **Bridge handler** (`packages/mcp/bridge/<name>-handlers.js`) — implements the logic
2. **Tool registration** (`packages/mcp/index.js`) — registers MCP tools with Zod schemas
3. **Wiring** (`packages/mcp/bridge.js` + `electron/main/services/mcp.ts`) — composes bridge

For UI features, add the IPC chain:
4. **IPC handler** (`electron/main/ipc/register-<name>.ts`) — main process handler
5. **Preload bridge** (`electron/preload/index.ts`) — expose to renderer
6. **Type definitions** (`src/types/electron.d.ts`) — TypeScript types
7. **Zustand store** (`src/stores/<name>-store.tsx`) — UI state
8. **React component** (`src/components/<name>/`) — UI

### Squad Communication

```
Orchestrator
  ├── pane_spawn → creates worker terminals (visible in grid)
  ├── pane_write → sends detailed TASK PROMPTS ONLY (never messages)
  ├── pane_wait_idle → waits for worker completion
  ├── pane_read → reads worker output
  └── pane_send_message → ALL inter-agent messages (yellow terminal notification)
       ├── worker reads with pane_read_messages
       └── worker responds with pane_send_message

⚠️ RULE: pane_write = task execution only. pane_send_message = all inter-agent communication.
   pane_send_message injects a yellow notification into the recipient's terminal.

Shared Memory (SQLite)
  ├── memory_write → all agents write changes immediately
  ├── memory_search → all agents search before starting
  └── memory_read → read specific entries
```

### Pattern Learning

```
Task completed → pattern_write(type, description, source, quality_score)
Next similar task → pattern_list(type) → reuse successful patterns
Quality improves → pattern_update(id, new_score)
```

---

## Conventions

### Code Style
- **Language**: TypeScript (strict mode)
- **Framework**: React 18 + Electron + Vite
- **State**: Zustand (no Redux)
- **Styling**: Tailwind CSS (utility-first, no CSS modules)
- **Testing**: Vitest
- **Package manager**: npm

### File Naming
- Components: `PascalCase.tsx` (e.g., `SkillsPanel.tsx`)
- Stores: `kebab-case-store.tsx` (e.g., `skills-store.tsx`)
- IPC handlers: `register-kebab-case.ts` (e.g., `register-skill.ts`)
- Bridge handlers: `kebab-case-handlers.js` (e.g., `skill-handlers.js`)
- Prompts: `kebab-case.md` (e.g., `squad-orchestrator.md`)

### IPC Pattern
```typescript
// electron/main/ipc/register-feature.ts
export function registerFeatureHandlers(ctx: IPCContext) {
  ctx.ipc.handle("feature:action", async (_event, args) => {
    // implementation
    return { ok: true, data: result };
  });
}

// electron/preload/index.ts
feature: {
  action: (args: ActionArgs) => ipcRenderer.invoke("feature:action", args),
}

// src/types/electron.d.ts
feature: {
  action: (args: ActionArgs) => Promise<{ ok: boolean; data?: Result; error?: string }>;
}
```

### MCP Tool Registration
```javascript
// packages/mcp/bridge/feature-handlers.js
function createFeatureHandlers(opts) {
  return {
    featureAction: async (args) => {
      // implementation using opts.dependencies
      return { ok: true, data: result };
    },
  };
}

// packages/mcp/index.js
server.tool(
  "mcp__codebrain__feature_action",
  "Description of what this tool does",
  { param: z.string().describe("Parameter description") },
  async ({ param }) => {
    try {
      const result = await bridge.featureAction({ param });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);
```

---

## Build & Run

```bash
# Development
npm run dev          # Start Electron + Vite dev server

# Build
npm run build        # Build all (triggers gen:releases)
npm run build:electron  # Build Electron only
npm run build:web    # Build renderer only

# Scripts
npm run gen:releases # Generate releases-data.ts from git tags
npm run lint         # Run linter
npm run test         # Run tests (Vitest)
```

---

## Skills System

Skills are prompt templates installed to `~/.codebrain/skills/<name>/`:

```
~/.codebrain/skills/
  api-testing/
    skill.json       ← manifest (id, name, type, version, description, tags, entrypoint)
    prompt.md        ← prompt template (type: "prompt")
  react-fullstack/
    skill.json
    squad.json       ← squad config (type: "squad")
    prompt.md
```

### MCP Tools for Skills
- `skill_list(type?)` — list installed skills
- `skill_get(id)` — get manifest + content
- `skill_install(id)` — install from GitLab registry
- `skill_uninstall(id)` — remove skill
- `skill_sync(direction)` — pull/push with registry

### GitLab Registry
- Repo: `gitlab.com/maikeofc18/codebrain-skills`
- `index.json` — catalog of all skills
- `skills/<name>/` — each skill directory

---

## Squad System

Squads are multi-agent teams spawned by the orchestrator:

```typescript
// Spawn orchestrator
const orchestratorId = await pane_spawn({ agent: "openclaude", label: "orchestrator" });

// Orchestrator spawns workers
const backendId = await pane_spawn({ agent: "openclaude", label: "backend" });
const frontendId = await pane_spawn({ agent: "openclaude", label: "frontend" });
const testerId = await pane_spawn({ agent: "openclaude", label: "ui-tester" });

// Orchestrator sends tasks
await pane_write(backendId, detailedPrompt, true);
await pane_wait_idle(backendId);
const output = await pane_read(backendId);

// Workers communicate directly
await pane_send_message({ from: backendId, to: frontendId, content: "API ready at /users", type: "update" });
```

### Worker Roles
| Role | Prompt | Model | Responsibility |
|------|--------|-------|----------------|
| Orchestrator | `squad-orchestrator.md` | gemini-3.1-pro-preview | Plan, delegate, synthesize |
| Backend | `squad-worker-gemini.md` | gemini-3.1-pro-preview | APIs, databases, server logic |
| Frontend | `squad-worker-gemini.md` | gemini-3.1-pro-preview | UI components, styling, state |
| UI Tester | `squad-ui-tester.md` | gemini-2.5-flash | Browser testing, bug detection |

---

## Hooks System

The `HooksManager` (`electron/main/services/hooks.ts`) provides lifecycle events:

| Event | Trigger | Use Case |
|-------|---------|----------|
| `pane_spawned` | New pane created | Log, register worker |
| `pane_exited` | Pane terminated | Cleanup, respawn |
| `pane_idle` | No output for 3s | Auto-assign tasks |
| `message_sent` | Agent sends message | Audit trail |
| `message_received` | Agent receives message | Routing |
| `squad_spawned` | Full squad created | Track topology |
| `task_started` | Task begins | Timer, logging |
| `task_completed` | Task finishes | Pattern learning |
| `hook_registered` | New hook added | Meta-tracking |

### MCP Tools
- `hooks_status()` — active hooks and stats
- `hooks_log(limit?)` — recent hook events
- `hooks_fire(event, data?)` — manually trigger event

---

## Common Tasks

### Adding a new MCP tool
1. Create handler in `packages/mcp/bridge/<name>-handlers.js`
2. Register in `packages/mcp/index.js` with Zod schema
3. Wire in `packages/mcp/bridge.js` (import + compose)
4. Wire in `electron/main/services/mcp.ts` (pass dependencies)
5. Update `README.md` tool count

### Adding a new IPC feature
1. Create `electron/main/ipc/register-<name>.ts`
2. Import in `register-all.ts`
3. Add to `electron/preload/index.ts`
4. Add types to `src/types/electron.d.ts`
5. Create Zustand store in `src/stores/`
6. Create UI component in `src/components/`

### Creating a new skill
1. Create directory: `~/.codebrain/skills/<name>/`
2. Create `skill.json` manifest
3. Create `prompt.md` (or `squad.json` + `prompt.md` for squad type)
4. Test with `skill_list` and `skill_get` MCP tools

### Version bump
1. Update `package.json` version
2. Commit with `chore: bump version to X.Y.Z`
3. Tag: `git tag vX.Y.Z`
4. Push: `git push origin master --tags`
5. Run `npm run gen:releases` to update releases-data.ts
