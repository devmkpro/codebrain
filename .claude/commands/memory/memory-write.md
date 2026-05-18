# memory-write

Write context, decisions, or project knowledge to shared memory.

## Usage
```
/memory-write <key> <content> [options]
```

## Options
- `<key>` — Unique key (e.g., "api-schema-users", "decision-auth-jwt")
- `<content>` — The content to store
- `--type <type>` — Memory type (episodic, semantic, procedural, working)
- `--tags <list>` — Comma-separated tags for searchability

## Examples
```
/memory-write "api-schema-users" "GET /users returns {id, name, email}" --tags api,schema
/memory-write "decision-auth-jwt" "Using JWT with refresh tokens for authentication" --type semantic --tags decision,auth
/memory-write "bug-login" "Login fails when email has special chars" --type episodic --tags bug,auth
```

## MCP Tool Used

```
mcp__codebrain__memory_write({
  type: "semantic",
  key: "api-schema-users",
  content: "GET /users returns {id, name, email}",
  tags: ["api", "schema"]
})
```

## When to Use

- **After changing an API** — so other agents know about breaking changes
- **After making a decision** — to document architectural choices
- **After finding a bug** — to track issues
- **After completing a task** — to summarize what was done
- **When discovering a pattern** — to share knowledge with other agents

## Key Naming Conventions

| Pattern | Example |
|---------|---------|
| API changes | `api-changed-/users` |
| Schema updates | `schema-users-table` |
| Decisions | `decision-auth-jwt` |
| Bugs | `bug-login-validation` |
| Results | `completed-backend-auth` |
| Conventions | `convention-naming-files` |

## See Also
- `/memory-search` — Search shared memory
- `/memory-list` — List all memory entries
