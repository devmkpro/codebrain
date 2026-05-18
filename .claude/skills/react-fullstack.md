---
name: react-fullstack
description: Squad template for React + Node.js fullstack applications
version: 1.0.0
triggers:
  - /react-app
  - fullstack
  - React + Node
  - build app
  - create app
tools:
  - pane_spawn
  - pane_write
  - pane_wait_idle
  - pane_read
  - pane_send_message
  - pane_read_messages
  - memory_write
  - memory_search
  - pattern_write
  - todo_manager
---

# React Fullstack Skill

Squad template for building React + Node.js applications with coordinated multi-agent development.

## Squad Configuration

```json
{
  "orchestrator": {
    "model": "gemini-3.1-pro-preview",
    "promptFile": "prompts/squad-orchestrator.md"
  },
  "workers": [
    { "label": "backend", "model": "gemini-3.1-pro-preview", "role": "backend" },
    { "label": "frontend", "model": "gemini-3.1-pro-preview", "role": "frontend" },
    { "label": "ui-tester", "model": "gemini-2.5-flash", "role": "ui-tester" }
  ]
}
```

## Workflow

### 1. Initialize Squad
```
pane_spawn({ agent: "openclaude", label: "orchestrator", model: "gemini-3.1-pro-preview" })
```

### 2. Orchestrator Spawns Workers
```
pane_spawn({ agent: "openclaude", label: "backend", model: "gemini-3.1-pro-preview" })
pane_spawn({ agent: "openclaude", label: "frontend", model: "gemini-3.1-pro-preview" })
pane_spawn({ agent: "openclaude", label: "ui-tester", model: "gemini-2.5-flash" })
```

### 3. Orchestrator Delegates Tasks
```
// Backend: API endpoints
pane_write(backendId, `
  ## Task: Build REST API

  ### Endpoints
  - GET /api/users — list users
  - POST /api/users — create user
  - GET /api/users/:id — get user
  - PUT /api/users/:id — update user
  - DELETE /api/users/:id — delete user

  ### Stack
  - Express.js + TypeScript
  - SQLite database
  - JWT authentication

  ### Conventions
  - RESTful naming
  - { ok: true, data } response format
  - try-catch error handling
  - Input validation with zod

  ### Before starting
  memory_search("api"), memory_search("schema")

  ### After completing
  memory_write(key="api-users", content="CRUD endpoints for /api/users", tags=["api","backend"])
`, true)

// Frontend: UI components
pane_write(frontendId, `
  ## Task: Build User Management UI

  ### Components
  - UserList — table with users
  - UserForm — create/edit form
  - UserCard — user detail view

  ### Stack
  - React 18 + TypeScript
  - Zustand for state
  - Tailwind CSS for styling

  ### Conventions
  - Functional components with hooks
  - Dark theme (bg-[#0c0c14])
  - Responsive design

  ### Before starting
  memory_search("api"), memory_search("component")

  ### After completing
  memory_write(key="component-users", content="UserList, UserForm, UserCard components", tags=["component","frontend"])
`, true)

// UI Tester: verify
pane_write(testerId, `
  ## Task: Verify User Management

  ### Test Cases
  1. Navigate to /users
  2. Verify user list loads
  3. Click "Add User" button
  4. Fill form and submit
  5. Verify user appears in list
  6. Edit user
  7. Delete user
  8. Check console for errors
  9. Check network for API calls

  ### Report
  PASS/FAIL with evidence
`, true)
```

### 4. Monitor Progress
```
pane_wait_idle(backendId)
pane_wait_idle(frontendId)
pane_wait_idle(testerId)

// Check for issues
memory_search("bug")
memory_search("error")
```

### 5. Synthesize
```
memory_write(
  key="completed-user-management",
  content="Fullstack user management: REST API + React UI + automated testing",
  tags=["result","fullstack"]
)

pattern_write("fullstack", `
  ## React + Node.js Fullstack Pattern

  ### Stack
  - Backend: Express.js + TypeScript + SQLite
  - Frontend: React 18 + Zustand + Tailwind
  - Testing: Browser automation

  ### Workflow
  1. Backend builds API endpoints first
  2. Frontend builds UI components
  3. UI Tester verifies integration
  4. All agents write to shared memory

  ### Quality: 0.90
`)
```

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Backend | Express.js + TypeScript | REST API |
| Database | SQLite | Data storage |
| Auth | JWT | Authentication |
| Frontend | React 18 | UI framework |
| State | Zustand | State management |
| Styling | Tailwind CSS | Utility-first CSS |
| Testing | Browser automation | UI verification |

## Tips

1. **Backend first** — API contracts define the interface
2. **Memory protocol** — all agents search before starting, write after completing
3. **UI Tester as gate** — verify before reporting completion
4. **Pattern learning** — save successful approaches for reuse
