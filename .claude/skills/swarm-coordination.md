---
name: swarm-coordination
description: Multi-agent swarm coordination with shared memory and pattern learning
version: 1.0.0
triggers:
  - /swarm
  - swarm
  - multi-agent
  - coordinate agents
  - parallel tasks
tools:
  - swarm_status
  - swarm_broadcast
  - swarm_assign_task
  - swarm_worker_health
  - swarm_respawn
  - memory_write
  - memory_search
  - memory_stats
  - pattern_write
  - pattern_list
  - hooks_status
  - hooks_log
  - hooks_fire
---

# Swarm Coordination Skill

Multi-agent swarm coordination with shared memory, pattern learning, and lifecycle hooks.

## Core Concepts

### Topology
```
Hierarchical (default)
  Orchestrator
    ├── Worker A (backend)
    ├── Worker B (frontend)
    └── Worker C (ui-tester)

Mesh (peer-to-peer)
  Worker A ↔ Worker B ↔ Worker C
    ↕           ↕           ↕
  Worker D ↔ Worker E ↔ Worker F
```

### Communication
```
Direct: pane_send_message(from, to, content, type)
Broadcast: swarm_broadcast(message, from)
Status: swarm_status()
Health: swarm_worker_health(paneId)
```

### Memory
```
Shared: all agents read/write same SQLite database
Scoped: each agent has own working memory
Search: memory_search(query) finds across all scopes
Stats: memory_stats() shows usage
```

## Workflow

### 1. Initialize Swarm
```
swarm_status() → check current state
pane_spawn({ label: "orchestrator" }) → spawn coordinator
pane_spawn({ label: "worker-1" }) → spawn workers
pane_spawn({ label: "worker-2" })
pane_spawn({ label: "worker-3" })
```

### 2. Distribute Tasks
```
swarm_assign_task(worker1Id, "Build REST API for /users")
swarm_assign_task(worker2Id, "Build React components for user management")
swarm_assign_task(worker3Id, "Test user management flow")

// Or via orchestrator
pane_write(orchestratorId, "Coordinate workers to build user management feature", true)
```

### 3. Monitor Health
```
swarm_status() → overall health
swarm_worker_health(worker1Id) → specific worker
hooks_log({ limit: 20 }) → recent events

// If worker crashed
swarm_respawn(worker1Id) → restart worker
```

### 4. Coordinate Changes
```
// Backend notifies frontend of API change
pane_send_message({
  from: backendId,
  to: frontendId,
  content: "API changed: GET /users now returns {id, name, email, role}",
  type: "update"
})

// Orchestrator broadcasts architecture change
swarm_broadcast("New requirement: add role-based access control")
```

### 5. Learn and Adapt
```
// After successful task
pattern_write("coordination", `
  ## User Management Squad

  ### Roles
  - Backend: REST API with Express.js
  - Frontend: React components with Zustand
  - UI Tester: Browser automation verification

  ### Communication Pattern
  1. Backend builds API first
  2. Backend notifies frontend via pane_send_message
  3. Frontend builds UI using API contract
  4. UI Tester verifies integration
  5. All write to shared memory

  ### Quality: 0.90
`)
```

## MCP Tools Reference

### Swarm Management
| Tool | Description |
|------|-------------|
| `swarm_status()` | Overall swarm health |
| `swarm_broadcast(message)` | Send to all workers |
| `swarm_assign_task(paneId, task)` | Assign task to worker |
| `swarm_worker_health(paneId)` | Check specific worker |
| `swarm_respawn(paneId)` | Restart crashed worker |

### Memory
| Tool | Description |
|------|-------------|
| `memory_write(key, content, tags?)` | Write to shared memory |
| `memory_search(query)` | Search across all memory |
| `memory_stats()` | Memory usage stats |

### Hooks
| Tool | Description |
|------|-------------|
| `hooks_status()` | Active hooks and stats |
| `hooks_log(limit?)` | Recent hook events |
| `hooks_fire(event, data?)` | Trigger event manually |

## Lifecycle Events

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

## Tips

1. **Always check swarm_status() first** — understand current state
2. **Use memory for coordination** — don't rely only on messages
3. **Monitor health periodically** — catch crashed workers early
4. **Broadcast architecture changes** — all workers need to know
5. **Learn from coordination** — save successful patterns
6. **Use hooks for automation** — lifecycle events enable auto-scaling
