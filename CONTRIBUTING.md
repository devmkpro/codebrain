# Contributing to Codebrain

Thank you for your interest in contributing to Codebrain! 🧠

## Quick Start

```bash
git clone https://github.com/devmkpro/codebrain.git
cd codebrain
npm install
npm run dev
```

## Architecture

```
codebrain/
├── electron/           # Main process (Node.js)
│   ├── main/ipc/       # IPC handlers (register-*.ts)
│   └── main/services/  # Core services (mcp, prompts, hooks, pane-spawn)
├── src/                # Renderer (React + Vite)
│   ├── components/     # React components
│   ├── stores/         # Zustand stores
│   └── types/          # TypeScript types
├── packages/
│   ├── mcp/            # MCP server (244 tools)
│   │   ├── bridge/     # Handler modules
│   │   ├── index.js    # Tool registration (Zod schemas)
│   │   └── bridge.js   # Handler composition
│   └── memory/         # SQLite memory store
├── prompts/            # Agent system prompts
└── scripts/            # Build/release scripts
```

## Adding a New MCP Tool

Follow the 3-layer pattern:

### 1. Bridge Handler (`packages/mcp/bridge/<name>-handlers.js`)

```javascript
"use strict";

function createMyHandlers(opts) {
  return {
    async myTool({ param }) {
      try {
        // implementation
        return { ok: true, data: result };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  };
}

module.exports = { createMyHandlers };
```

### 2. Tool Registration (`packages/mcp/index.js`)

```javascript
server.tool(
  "mcp__codebrain__my_tool",
  "Description of what this tool does",
  { param: z.string().describe("Parameter description") },
  async ({ param }) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await bridge.myTool({ param }), null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);
```

### 3. Wiring (`packages/mcp/bridge.js`)

```javascript
const { createMyHandlers } = require("./bridge/my-handlers.js");
// In createMCPBridge():
const myHandlers = createMyHandlers(sharedOpts);
// In return object:
...myHandlers,
```

## Adding an IPC Feature

1. `electron/main/ipc/register-<name>.ts` — handler
2. `electron/main/ipc/register-all.ts` — import
3. `electron/preload/index.ts` — expose to renderer
4. `src/types/electron.d.ts` — TypeScript types
5. `src/stores/<name>-store.tsx` — Zustand store
6. `src/components/<name>/` — React component

## Conventions

- **TypeScript strict** for all `.ts/.tsx` files
- **Tailwind CSS** for styling (no CSS modules)
- **Zustand** for state (no Redux)
- Return `{ ok: boolean, data?, error? }` in all handlers
- Use `isError: true` in MCP tool catch blocks
- Every handler must be wrapped in try/catch — never throw uncaught

## Code Style

```bash
npm run lint      # Check style
npm run test      # Run tests (Vitest)
npm run build     # Full build
```

## Commit Convention

```
feat: add new feature
fix: fix a bug
refactor: refactor code
chore: maintenance tasks
ci: CI/CD changes
docs: documentation
```

## Submitting Changes

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Run `npm run build` to verify
5. Commit with a descriptive message
6. Push and create a Merge Request (GitLab) or Pull Request (GitHub)

## Questions?

Open an issue or reach out on [Discord](https://discord.gg/_devmk).
