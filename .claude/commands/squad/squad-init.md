# squad-init

Initialize a new squad with orchestrator and workers.

## Usage
```
/squad-init [options]
```

## Options
- `--workers <list>` — Comma-separated worker roles (backend, frontend, ui-tester)
- `--model <model>` — Default model for workers
- `--label <name>` — Squad label for identification

## Examples
```
/squad-init
/squad-init --workers backend,frontend,ui-tester
/squad-init --workers backend,frontend --model gemini-3.1-pro-preview
```

## What It Does

1. **Spawns Orchestrator** — opens a new terminal with orchestrator prompt
2. **Orchestrator spawns workers** — based on the specified roles
3. **Sets up shared memory** — all agents share SQLite memory
4. **Enables inter-agent messaging** — via pane_send_message/pane_read_messages

## MCP Tools Used

```
mcp__codebrain__pane_spawn({ agent: "openclaude", label: "orchestrator" })
mcp__codebrain__pane_spawn({ agent: "openclaude", label: "backend" })
mcp__codebrain__pane_spawn({ agent: "openclaude", label: "frontend" })
mcp__codebrain__pane_spawn({ agent: "openclaude", label: "ui-tester" })
mcp__codebrain__todo_manager({ action: "set_tasks", tasks: ["Backend API", "Frontend UI", "UI Testing"] })
```

## Architecture

```
Orchestrator (plans, delegates, synthesizes)
  ├── Backend Worker (APIs, databases, server logic)
  ├── Frontend Worker (React components, styling, state)
  └── UI Tester (browser automation, bug detection)
```

## See Also
- `/squad-status` — Check squad health
- `/swarm-monitor` — Monitor swarm activity
- `/memory-search` — Search shared memory
