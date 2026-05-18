# swarm-monitor

Monitor swarm activity — worker health, message flow, task progress.

## Usage
```
/swarm-monitor [options]
```

## Options
- `--live` — Live monitoring mode (updates every 5s)
- `--messages` — Show recent inter-agent messages
- `--tasks` — Show task progress

## Examples
```
/swarm-monitor
/swarm-monitor --live
/swarm-monitor --messages --tasks
```

## MCP Tools Used

```
mcp__codebrain__swarm_status() → swarm topology and health
mcp__codebrain__swarm_worker_health(paneId) → individual worker check
mcp__codebrain__hooks_log({ limit: 20 }) → recent events
mcp__codebrain__todo_manager({ action: "read_list" }) → task progress
mcp__codebrain__memory_stats() → memory usage
```

## Example Output

```
## Swarm Monitor

### Topology: hierarchical
### Workers: 3 active, 0 idle, 0 error

| Worker | Status | Role | Last Activity |
|--------|--------|------|---------------|
| orchestrator | idle | coordinator | 10s ago |
| backend | running | developer | 5s ago |
| frontend | idle | developer | 30s ago |

### Recent Messages (5)
- [10s ago] orchestrator → backend: "Implement /api/users endpoint"
- [8s ago] backend → frontend: "API ready at /users, returns {id, name, email}"
- [5s ago] orchestrator → frontend: "Build user list component"
- [3s ago] frontend → orchestrator: "DONE: UserList component created"

### Task Progress
- [x] Backend API endpoints
- [ ] Frontend components
- [ ] UI testing

### Memory Stats
- Total: 15 entries
- Recent writes: 3 (last 5m)
```

## See Also
- `/squad-status` — Check squad health
- `/swarm-broadcast` — Send message to all workers
