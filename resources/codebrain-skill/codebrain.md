# Codebrain MCP Skill

You are running inside **Codebrain**, an AI multi-agent IDE. You have access to MCP tools for terminal management, inter-agent communication, task tracking, and browser automation.

## Core Pane Tools

### mcp__codebrain__pane_spawn
Open a NEW VISIBLE terminal pane in the workspace grid. Use this instead of the Agent tool if you want the user to see progress.
- `cwd?` — Working directory (defaults to current workspace)
- `agent?` — Agent binary: openclaude, claude, gemini, codex, shell (default: openclaude)
- `providerId?` — Provider ID to use
- `model?` — Model to use
- Returns `{ paneId, ok: true }`

### mcp__codebrain__pane_write
Write text/prompt to an existing pane (simulates keyboard input).
- `paneId` — Target pane ID
- `text` — Text to send to stdin
- `submit?` — If true (default), appends newline to submit

### mcp__codebrain__pane_read
Read recent output from a pane's terminal buffer.
- `paneId` — Target pane ID
- `lastN?` — Number of recent lines (default 200)

### mcp__codebrain__pane_wait_idle
Wait until a pane becomes idle (no new output for ~3s). Call after pane_write to know when the agent finished.
- `paneId` — Pane to wait on
- `timeout?` — Max ms to wait (default 300000 = 5 min)

### mcp__codebrain__pane_list
List all active terminal panes. Returns paneId, label, providerId, model, status, isOrchestrator, hasAgent.

### mcp__codebrain__pane_set_role
Mark a pane as worker or orchestrator.
- `paneId` — Target pane ID
- `role` — "worker" or "orchestrator"

## Task Management

### mcp__codebrain__todo_manager
Manage the user-visible task list in the sidebar.
- `action` — "set_tasks" | "add_task" | "move_to_task" | "read_list" | "mark_all_done"
- `tasks?` — For set_tasks: ordered list of task names
- `task?` — For add_task: task name to add
- `moveToTask?` — For move_to_task: task to activate (marks previous ones done)

## Inter-Agent Messaging

### mcp__codebrain__pane_send_message
Send a message to another agent pane for coordination.
- `from` — Your pane ID (sender)
- `to` — Target pane ID (recipient)
- `content` — Message content (be specific, include all context)
- `type?` — "task" | "update" | "question" | "result" (default: "update")

The message appears as a yellow notification in the recipient's terminal.

### mcp__codebrain__pane_read_messages
Read messages sent to your pane from other agents.
- `paneId` — Your pane ID (reads from your inbox)
- `unreadOnly?` — If true (default), only return unread messages

## Browser Automation

### CRITICAL: Always call browser_guide() FIRST
Before using ANY browser tool, call `mcp__codebrain__browser_guide()` to read best-practices and navigation rules.

### Navigation
- `browser_open(url)` — Open NEW browser pane, navigate to URL. Returns paneId.
- `browser_navigate(url, pane_id?)` — Navigate existing browser to URL.
- `browser_back(pane_id?)` / `browser_forward` / `browser_reload`
- `browser_get_url(pane_id?)` — Get current URL and title.

### DOM Reading
- `browser_get_html(selector?, pane_id?)` — Get HTML content.
- `browser_get_text(selector?, pane_id?)` — Get visible text (no HTML).
- `browser_get_accessibility_tree(max_depth?, pane_id?)` — Get a11y tree (roles, labels, bounds). Best for AI understanding.
- `browser_find_by_text(text, role?, exact?, pane_id?)` — Find elements by visible text.
- `browser_get_element_info(selector, pane_id?)` — Get element bounds, attributes, role, value, visibility.
- `browser_page_summary(pane_id?)` — URL + title + text + links + inputs + buttons in one call.

### DOM Interaction
- `browser_click(selector, pane_id?)` — Click element by CSS selector.
- `browser_click_text(text, role?, pane_id?)` — Find by text + click in one call.
- `browser_fill(selector, value, clear_first?, pane_id?)` — Fill input/textarea.
- `browser_fill_form(fields[], pane_id?)` — Fill multiple fields at once.
- `browser_select(selector, value_or_text, pane_id?)` — Select dropdown option.
- `browser_check(selector, checked?, pane_id?)` — Check/uncheck checkbox/radio.
- `browser_clear(selector, pane_id?)` — Clear input field.
- `browser_focus(selector, pane_id?)` — Focus element without clicking.
- `browser_hover(selector, pane_id?)` — Hover over element.

### Coordinate-based
- `browser_click_at(x, y, button?, pane_id?)` — Click at exact coordinates.
- `browser_hover_at(x, y, pane_id?)` — Hover at coordinates.
- `browser_drag(x1, y1, x2, y2, steps?, pane_id?)` — Drag between coordinates.
- `browser_scroll(selector?, direction, amount, pane_id?)` — Scroll page/element.

### Keyboard
- `browser_type(text, delay_ms?, pane_id?)` — Type text character by character.
- `browser_key(key, pane_id?)` — Press single key (Enter, Escape, Tab, etc).
- `browser_shortcut(keys, pane_id?)` — Keyboard shortcut (Ctrl+A, Ctrl+Shift+I, etc).

### Wait / Assertions
- `browser_wait_for(selector, timeout_ms?, pane_id?)` — Wait for element to appear.
- `browser_wait_for_text(text, selector?, timeout_ms?, pane_id?)` — Wait for text to appear.
- `browser_wait_for_url(pattern, timeout_ms?, pane_id?)` — Wait for URL to match pattern.
- `browser_wait_for_load(timeout_ms?, pane_id?)` — Wait for page to finish loading.

### Screenshots
- `browser_screenshot(full_page?, pane_id?)` — Capture viewport. Returns file path + textual page description. NEVER read the PNG — use the text description.
- `browser_screenshot_element(selector, pane_id?)` — Capture specific element.
- `browser_annotate(path, annotations[])` — Draw boxes/arrows/labels on screenshot.

### Console & Network Monitoring
- `browser_console_log(level?, since_ms?, limit?, pane_id?)` — Read ALL console entries (log/warn/error/info/debug + uncaught errors + unhandled rejections). Use level="error" to find bugs.
- `browser_clear_console()` — Clear stored console log.
- `browser_network_log(url_filter?, method?, status?, since_ms?, limit?, pane_id?)` — Read network activity (fetch, XHR, WebSocket, resources). Use status="5xx" for server errors, status="4xx" for client errors.
- `browser_network_wait(pattern, method?, timeout_ms?)` — Wait for specific network request.
- `browser_clear_network()` — Clear stored network log.

### JavaScript Eval
- `browser_eval(javascript, pane_id?)` — Execute JS in page context.

## Browser Rules (from browser_guide)

1. **NEVER guess URLs or routes** — Navigate to root first, read the DOM, then follow real links.
2. **Read the page BEFORE interacting** — Call browser_get_accessibility_tree() or browser_get_html() first.
3. **Do NOT open multiple browser panes** — Use ONE pane, navigate with browser_navigate().
4. **Use semantic selectors** — Find elements by text/role, not guessed CSS classes.
5. **Wait for page state** — Use browser_wait_for_load() after navigation, browser_wait_for() after actions.
6. **NEVER read screenshot PNG files** — The text description has everything you need.
