# memory-search

Search through shared memory for context, decisions, and project knowledge.

## Usage
```
/memory-search <query>
```

## Options
- `<query>` — Search query (keywords, tags, or content)
- `--type <type>` — Filter by memory type (episodic, semantic, procedural, working)
- `--limit <n>` — Maximum results (default: 10)

## Examples
```
/memory-search authentication
/memory-search "API schema" --type semantic
/memory-search "bug" --type episodic --limit 5
```

## MCP Tool Used

```
mcp__codebrain__memory_search({
  query: "authentication",
  type: "semantic",
  limit: 10
})
```

## Memory Types

| Type | Use Case | Example |
|------|----------|---------|
| `episodic` | Events, actions taken | "Implemented login flow" |
| `semantic` | Knowledge, facts | "API uses JWT with refresh tokens" |
| `procedural` | How-to, patterns | "How to add a new MCP tool" |
| `working` | Drafts, temporary | "Current API schema for /users" |

## When to Use

- **Before starting work** — search for "changes", "api", "schema", "decision"
- **When debugging** — search for "bug", "error", "issue"
- **When exploring** — search for "architecture", "component", "pattern"
- **When coordinating** — search for "result", "completed", "status"

## See Also
- `/memory-write` — Write to shared memory
- `/memory-list` — List all memory entries
