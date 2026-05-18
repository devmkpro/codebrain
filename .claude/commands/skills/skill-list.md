# skill-list

List all installed skills and available skills from the registry.

## Usage
```
/skill-list [options]
```

## Options
- `--type <type>` — Filter by type (prompt, squad)
- `--installed` — Show only installed skills
- `--registry` — Show only registry skills

## Examples
```
/skill-list
/skill-list --type prompt
/skill-list --installed
/skill-list --registry
```

## MCP Tools Used

```
mcp__codebrain__skill_list({ type: "prompt" }) → installed skills
mcp__codebrain__skill_registry_index() → registry catalog
```

## Example Output

```
## Installed Skills (3)

| ID | Name | Type | Version | Description |
|----|------|------|---------|-------------|
| api-testing | API Testing | prompt | 1.0.0 | REST API testing with browser automation |
| code-review | Code Review | prompt | 1.2.0 | Automated code review and suggestions |
| react-fullstack | React Fullstack | squad | 1.0.0 | Squad for React + Node.js apps |

## Available from Registry (2)

| ID | Name | Type | Version |
|----|------|------|---------|
| swarm-coordination | Swarm Coordination | prompt | 1.0.0 |
| performance-optimization | Performance Optimization | prompt | 1.1.0 |
```

## See Also
- `/skill-install` — Install a skill
- `/skill-uninstall` — Remove a skill
- `/skill-sync` — Sync with registry
