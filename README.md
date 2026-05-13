# Codebrain

> Multi-agent AI IDE. Orchestrate Claude, Gemini, and more — side by side, in real time.

---

## What is Codebrain?

Codebrain is an **Electron desktop app** where multiple AI agents work together in a visible terminal grid.

- **Tiling grid** — auto-organizes 1/2/3/4+ panes
- **Focus mode** — expand any pane to 65% with one click
- **Multi-agent squads** — one orchestrator directs many workers
- **Live task sidebar** — agents update a shared todo list
- **Session map** — visual graph of all agent sessions
- **File editor** — browse and edit without leaving the app
- **Browser automation** — 42 MCP tools for web testing
- **Voice input** — push-to-talk with Groq Whisper transcription

---

## Quick Start

```bash
git clone https://gitlab.com/maikeofc18/codebrain.git
cd codebrain
npm install
npm run dev
```

That's it. Hot reload is instant.

---

## Build for Production

```bash
# Vite build
npm run build

# Portable ZIP (no admin needed)
node scripts/build-exe.mjs

# NSIS installer (.exe)
npm run dist:win:nsis
```

Output goes to `dist/`.

---

## Releases

Download the latest from [GitLab Releases](https://gitlab.com/maikeofc18/codebrain/-/releases).

Available for:
- Windows x64 (NSIS installer)
- Linux x64 (AppImage + .deb)

### Create a release

```bash
npm version patch        # 1.0.0 → 1.0.1 (updates package.json)
git tag 1.0.1            # tag WITHOUT "v" prefix (must match package.json version)
git push origin main --tags
```

GitLab CI builds Windows (via Wine) and Linux artifacts automatically and creates the release.

---

## Stack

| Layer | Tech |
|-------|------|
| Framework | React 19 + TypeScript |
| Styling | Tailwind CSS v4 |
| State | Zustand v5 |
| Terminal | xterm.js v6 |
| Animation | Motion (Framer) |
| Icons | lucide-react |
| Font | JetBrains Mono |
| MCP | @modelcontextprotocol/sdk |
| CI/CD | GitLab CI |

---

## Providers (API Keys)

Click the account icon → **Providers** → **+ Add Provider**.

| Role | Provider | Model |
|------|----------|-------|
| Orchestrator | Claude / Anthropic | claude-sonnet-4-6 |
| Workers | Gemini API | gemini-3.1-pro-preview |

---

## MCP Tools

Agents get these tools automatically:

### Core (pane management)

| Tool | What it does |
|------|-------------|
| `pane_spawn` | Open a new agent terminal |
| `pane_write` | Send text to a pane |
| `pane_read` | Read pane output |
| `pane_wait_idle` | Wait until agent finishes |
| `pane_send_message` | Message another agent |
| `pane_read_messages` | Read your inbox |
| `pane_list` | List active panes |
| `pane_set_role` | Assign worker/orchestrator role |
| `todo_manager` | Manage the task sidebar |

### Browser automation (42 tools)

| Tool | What it does |
|------|-------------|
| `browser_guide` | MANDATORY — read before any browser tool |
| **Navigation** | |
| `browser_navigate` | Go to a URL |
| `browser_open` | Open new browser pane |
| `browser_back` / `browser_forward` | History navigation |
| `browser_reload` | Reload page |
| **DOM reading** | |
| `browser_get_html` | Get raw HTML |
| `browser_get_text` | Get visible text |
| `browser_get_accessibility_tree` | Semantic tree (roles, labels, bounds) |
| `browser_find_by_text` | Find element by visible text |
| `browser_get_element_info` | Full element info (bounds, attributes, role) |
| `browser_get_url` | Current URL + title |
| `browser_page_summary` | URL, text, links, inputs, buttons in one call |
| **DOM interaction** | |
| `browser_click` | Click element by CSS selector |
| `browser_click_text` | Find + click by visible text |
| `browser_fill` | Fill input/textarea |
| `browser_fill_form` | Fill multiple fields at once |
| `browser_select` | Select dropdown option |
| `browser_check` | Check/uncheck checkbox |
| `browser_clear` | Clear input field |
| `browser_focus` | Focus element |
| `browser_hover` | Hover element (triggers tooltips) |
| **Coordinate interaction** | |
| `browser_click_at` | Click at exact (x, y) |
| `browser_hover_at` | Hover at exact (x, y) |
| `browser_drag` | Drag from (x1,y1) to (x2,y2) |
| `browser_scroll` | Scroll page or element |
| **Keyboard** | |
| `browser_type` | Type text character by character |
| `browser_key` | Press single key (Enter, Escape, Tab…) |
| `browser_shortcut` | Keyboard shortcut (Ctrl+A, Ctrl+Shift+I…) |
| **Wait / assertions** | |
| `browser_wait_for` | Wait for element to appear |
| `browser_wait_for_text` | Wait for text to appear |
| `browser_wait_for_url` | Wait for URL pattern |
| `browser_wait_for_load` | Wait for network idle |
| **Screenshots** | |
| `browser_screenshot` | Capture viewport (returns text description) |
| `browser_screenshot_element` | Capture specific element |
| `browser_annotate` | Draw boxes/arrows/labels on screenshot |
| **Console & network** | |
| `browser_console_log` | Read console entries (log/warn/error) |
| `browser_clear_console` | Clear console log |
| `browser_network_log` | Read network requests (fetch, XHR, WebSocket) |
| `browser_network_wait` | Wait for specific request |
| `browser_clear_network` | Clear network log |
| **Advanced** | |
| `browser_eval` | Execute JavaScript in page context |

---

## Project Structure

```
codebrain/
├── src/                    React renderer (TypeScript)
│   ├── components/         UI components
│   ├── stores/             Zustand state
│   └── styles/             Tailwind + design tokens
├── electron/main/          Electron main process
├── packages/mcp/           MCP server (agent tools)
├── prompts/                Squad system prompts
├── scripts/                Build + release scripts
├── resources/              Icons + bundled skill
└── local/                  Dev scripts (.bat, gitignored)
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+T` | New pane |
| `Ctrl+W` | Close pane |
| `Ctrl+1-9` | Focus pane by number |
| `Ctrl+Shift+I` | DevTools |
| `Space` (hold) | Voice input |

---

## License

This project is licensed under the [MIT License](https://opensource.org/licenses/MIT) - see the [LICENSE](LICENSE) file for details.

---

## License

Private — all rights reserved.
