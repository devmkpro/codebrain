# squad-status

Check the status of the current squad — active workers, health, topology.

## Usage
```
/squad-status
```

## What It Shows

1. **Active Workers** — list of spawned worker terminals
2. **Health Status** — each worker's state (running, idle, exited, error)
3. **Memory Stats** — shared memory usage
4. **Recent Messages** — inter-agent communication log

## MCP Tools Used

```
mcp__codebrain__pane_list() → list all active panes
mcp__codebrain__swarm_status() → swarm health and topology
mcp__codebrain__memory_stats() → memory usage
mcp__codebrain__hooks_log({ limit: 10 }) → recent hook events
```

## Example Output

```
## Squad Status

### Workers (3 active)
| Label | Pane ID | Status | Uptime |
|-------|---------|--------|--------|
| orchestrator | abc123 | idle | 5m |
| backend | def456 | running | 3m |
| frontend | ghi789 | idle | 3m |

### Memory
- Total entries: 15
- Episodic: 5, Semantic: 8, Working: 2

### Recent Events
- [2m ago] backend spawned
- [1m ago] frontend spawned
- [30s ago] orchestrator sent task to backend
```

## See Also
- `/squad-init` — Initialize a new squad
- `/swarm-monitor` — Monitor swarm activity
