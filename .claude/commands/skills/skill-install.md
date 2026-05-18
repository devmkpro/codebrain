# skill-install

Install a skill from the GitLab registry to local skills directory.

## Usage
```
/skill-install <id>
```

## Options
- `<id>` — Skill ID from the registry (e.g., api-testing, react-fullstack)

## Examples
```
/skill-install api-testing
/skill-install react-fullstack
/skill-install code-review
```

## What It Does

1. **Fetches skill from registry** — downloads from GitLab
2. **Validates manifest** — checks skill.json
3. **Copies to local** — installs to ~/.codebrain/skills/<id>/
4. **Updates installed list** — refreshes the skills panel

## MCP Tool Used

```
mcp__codebrain__skill_install({ id: "api-testing" })
```

## Skill Format

```
~/.codebrain/skills/<id>/
  skill.json       ← manifest (required)
  prompt.md        ← prompt template (for type: "prompt")
  squad.json       ← squad config (for type: "squad")
  README.md        ← documentation (optional)
```

### skill.json
```json
{
  "id": "api-testing",
  "name": "API Testing",
  "type": "prompt",
  "version": "1.0.0",
  "description": "Teaches agent to test REST APIs using browser automation",
  "author": "codebrain",
  "tags": ["testing", "api", "browser"],
  "entrypoint": "prompt.md",
  "tools": ["browser_navigate", "browser_fill", "browser_click", "browser_console_log", "browser_network_log"]
}
```

## Registry

- **URL**: https://gitlab.com/maikeofc18/codebrain-skills
- **Index**: index.json contains all available skills
- **Sync**: Use `/skill-sync` to pull latest updates

## See Also
- `/skill-list` — List installed skills
- `/skill-uninstall` — Remove a skill
- `/skill-sync` — Sync with registry
