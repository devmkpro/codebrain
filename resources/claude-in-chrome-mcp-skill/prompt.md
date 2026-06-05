# Claude in Chrome MCP — Complete Automation Guide

You are inside **Codebrain**, a multi-agent IDE. You have access to **Claude in Chrome MCP tools** for browser automation via the Chrome DevTools Protocol (CDP) or embedded Electron webview.

> **TL;DR:** Use `browser_*` MCP tools to control Chrome/Brave from Codebrain agents. Always call `browser_guide()` first to understand the mode you're running in.

---

## 🎯 What is Claude in Chrome MCP?

Claude in Chrome is a browser automation system that integrates with Codebrain's MCP (Model Context Protocol). It lets you:

✅ Navigate websites programmatically  
✅ Read HTML, text, and accessibility trees  
✅ Click buttons, fill forms, select dropdowns  
✅ Take screenshots and annotate them  
✅ Monitor network requests and console logs  
✅ Execute JavaScript in page context  
✅ Wait for elements/text/URLs to appear  
✅ Control keyboard and mouse  

---

## 🔍 Before You Start: Browser Modes

### Mode 1: **CDP (Chrome DevTools Protocol)** — PREFERRED
- **Auto-detected** on port 9222 if native Chrome/Brave is running
- **Native tabs** managed via Chrome automation
- **Most powerful** — full keyboard shortcuts, batch operations, CDP-specific tools
- **Tools available:** All 53+ browser tools (batch, tabs_list, computer, network interception)

### Mode 2: **Electron Webview** — FALLBACK
- Used if Chrome CDP is not available
- **Embedded** in Codebrain pane
- **Limited** — no keyboard shortcuts, batch, or advanced CDP features
- **Tools available:** Basic navigation, DOM reading/interaction, screenshots

### 🚨 CRITICAL: Call `browser_guide()` FIRST

Before ANY browser tool call:
```
mcp__codebrain__browser_guide()
```

This reads the current mode and navigation rules. Ignore this → tools may fail silently.

---

## 🚀 Quick Start — 5 Steps

### Step 1: Open a browser pane

```
mcp__codebrain__browser_open(url: "https://example.com")
```

Returns `{ ok: true, paneId: "ABC123" }`. The browser opens in a new visible pane.

### Step 2: Check the mode

```
mcp__codebrain__browser_guide()
```

Reads the guide. Check if you're in **CDP mode** (native Chrome) or **webview mode** (embedded).

### Step 3: Read the page

```
mcp__codebrain__browser_get_text(paneId: "ABC123")
```

Returns visible text from the page. If you need structured data, use:
- `browser_get_html()` — raw HTML
- `browser_get_accessibility_tree()` — semantic tree (BEST for AI)
- `browser_page_summary()` — URL + text + links + inputs + buttons

### Step 4: Interact with the page

```
mcp__codebrain__browser_click(selector: "button.submit", paneId: "ABC123")
```

Or:
```
mcp__codebrain__browser_click_text(text: "Login", paneId: "ABC123")
```

Or fill a form:
```
mcp__codebrain__browser_fill_form(
  fields: [
    { selector: "input[name=email]", value: "test@example.com" },
    { selector: "input[name=password]", value: "secret" }
  ],
  paneId: "ABC123"
)
```

### Step 5: Verify + capture

```
mcp__codebrain__browser_screenshot(paneId: "ABC123")
```

Captures viewport and returns text description. To check console/network errors:

```
mcp__codebrain__browser_console_log(paneId: "ABC123")
mcp__codebrain__browser_network_log(paneId: "ABC123")
```

---

## 📚 Complete MCP Tools Reference

### Navigation & Page State

| Tool | Use case |
|------|----------|
| `browser_open(url)` | Open NEW browser pane, navigate to URL. Returns paneId. |
| `browser_navigate(url, paneId)` | Navigate existing pane to URL. |
| `browser_back(paneId)` | Go back in history. |
| `browser_forward(paneId)` | Go forward in history. |
| `browser_reload(paneId)` | Reload current page. |
| `browser_get_url(paneId)` | Get current URL + page title. |

**Example:**
```
mcp__codebrain__browser_navigate(
  url: "https://google.com/search?q=codebrain",
  paneId: "ABC123"
)
```

### DOM Reading — Find & Understand Elements

| Tool | Returns | Best for |
|------|---------|----------|
| `browser_get_text(paneId, selector?)` | Visible text only | Scraping content |
| `browser_get_html(paneId, selector?)` | Raw HTML | Analyzing structure |
| `browser_get_accessibility_tree(paneId, maxDepth?)` | Semantic tree (roles, labels, bounds) | AI understanding (BEST) |
| `browser_find_by_text(text, paneId, role?, exact?)` | Element info matching text | Finding buttons/links |
| `browser_get_element_info(selector, paneId)` | Full element data (bounds, attrs, role, value) | Detailed inspection |
| `browser_page_summary(paneId)` | URL + title + text + links + inputs + buttons | Complete page snapshot |

**Example — Read accessibility tree:**
```
mcp__codebrain__browser_get_accessibility_tree(
  paneId: "ABC123",
  maxDepth: 3
)
```

Returns structured tree with roles like:
```
- button "Login" (role: button, bounds: [100, 200, 200, 230])
  - span "Sign in" (role: none)
- input "" (role: textbox, type: email, value: "", bounds: [100, 250, 300, 280])
```

### DOM Interaction — Click, Fill, Select

| Tool | What it does |
|------|-------------|
| `browser_click(selector, paneId)` | Click element by CSS selector. |
| `browser_click_text(text, paneId, role?)` | Find element by visible text + click. |
| `browser_fill(selector, value, clearFirst?, paneId)` | Fill input/textarea. |
| `browser_fill_form(fields[], paneId)` | Fill multiple fields at once. |
| `browser_select(selector, value, paneId)` | Select dropdown option (by value or text). |
| `browser_check(selector, checked?, paneId)` | Check/uncheck checkbox or radio. |
| `browser_clear(selector, paneId)` | Clear input field. |
| `browser_focus(selector, paneId)` | Focus element without clicking. |
| `browser_hover(selector, paneId)` | Hover over element (trigger tooltips). |

**Example — Fill and submit login form:**
```
mcp__codebrain__browser_fill_form(
  fields: [
    { selector: "input[type=email]", value: "user@example.com" },
    { selector: "input[type=password]", value: "MyPassword123" }
  ],
  paneId: "ABC123"
)

mcp__codebrain__browser_click(selector: "button[type=submit]", paneId: "ABC123")
```

### Coordinate-Based Actions (CDP Mode Only)

| Tool | Use case |
|------|----------|
| `browser_click_at(x, y, button?, paneId)` | Click at exact (x, y) coordinates. |
| `browser_hover_at(x, y, paneId)` | Hover at exact (x, y) coordinates. |
| `browser_drag(x1, y1, x2, y2, steps?, paneId)` | Drag from (x1,y1) to (x2,y2). |
| `browser_scroll(selector?, direction, amount, paneId)` | Scroll page or specific element. |

**Example:**
```
mcp__codebrain__browser_drag(
  x1: 100, y1: 200,
  x2: 300, y2: 400,
  steps: 10,
  paneId: "ABC123"
)
```

### Keyboard & Shortcuts

| Tool | What it does |
|------|-------------|
| `browser_type(text, paneId)` | Type text character by character. |
| `browser_key(key, paneId)` | Press single key: "Enter", "Escape", "Tab", "ArrowDown", etc. |
| `browser_shortcut(keys, paneId)` | Keyboard shortcut: "Ctrl+A", "Ctrl+C", "Cmd+Z", etc. (CDP only) |

**Example — Type and press Enter:**
```
mcp__codebrain__browser_click(selector: "input.search", paneId: "ABC123")
mcp__codebrain__browser_type(text: "javascript tutorial", paneId: "ABC123")
mcp__codebrain__browser_key(key: "Enter", paneId: "ABC123")
```

### Screenshots & Annotation

| Tool | Returns |
|------|---------|
| `browser_screenshot(paneId)` | Viewport screenshot as text description. |
| `browser_screenshot_element(selector, paneId)` | Specific element screenshot. |
| `browser_annotate(imagePath, annotations[], paneId)` | Draw boxes, arrows, labels on screenshot. |

**Example:**
```
mcp__codebrain__browser_screenshot(paneId: "ABC123")

# Returns text like:
# "Screenshot of Google homepage: search bar at top, blue Google logo, Sign In button top-right..."

# Save and annotate:
mcp__codebrain__browser_annotate(
  imagePath: "/path/to/screenshot.png",
  annotations: [
    { type: "box", selector: ".search-box", color: "red", label: "Search input" },
    { type: "arrow", from: [100, 200], to: [300, 250], color: "blue" }
  ],
  paneId: "ABC123"
)
```

### Console & Network Monitoring

| Tool | What it monitors |
|------|-----------------|
| `browser_console_log(paneId, level?, since?)` | Browser console: log/warn/error messages. |
| `browser_clear_console(paneId)` | Clear console log. |
| `browser_network_log(paneId, filter?, since?)` | Network requests: fetch, XHR, WebSocket. |
| `browser_network_wait(paneId, urlPattern, timeout?)` | Wait for specific request to complete. |
| `browser_clear_network(paneId)` | Clear network log. |

**Example — Check for errors:**
```
mcp__codebrain__browser_console_log(
  paneId: "ABC123",
  level: "error"
)

# Returns: { ok: true, messages: [...] }
```

### Wait / Assertions

| Tool | Waits for |
|------|-----------|
| `browser_wait_for(selector, paneId, timeout?)` | Element to appear in DOM. |
| `browser_wait_for_text(text, paneId, timeout?)` | Text to appear on page. |
| `browser_wait_for_url(urlPattern, paneId, timeout?)` | URL to match pattern. |
| `browser_wait_for_load(paneId, timeout?)` | Network idle (page fully loaded). |

**Example — Wait for login to complete:**
```
mcp__codebrain__browser_click_text(text: "Login", paneId: "ABC123")
mcp__codebrain__browser_wait_for_url(
  urlPattern: "/dashboard",
  paneId: "ABC123",
  timeout: 10000
)
```

### Advanced — JavaScript Execution

| Tool | What it does |
|------|-------------|
| `browser_eval(script, paneId)` | Execute JavaScript in page context. Returns result. |

**Example — Get all links:**
```
mcp__codebrain__browser_eval(
  script: "document.querySelectorAll('a').map(a => ({ href: a.href, text: a.textContent })).slice(0, 10)",
  paneId: "ABC123"
)

# Returns: { ok: true, result: [{ href: "https://...", text: "Link text" }, ...] }
```

### Tabs Management (CDP Mode Only)

| Tool | What it does |
|------|-------------|
| `browser_tabs_list(paneId)` | List all open Chrome tabs. |
| `browser_tabs_create(paneId, url?)` | Create new tab (optionally navigate to URL). |
| `browser_tabs_close(paneId, tabId)` | Close a specific tab. |

### Batch Operations (CDP Mode Only)

| Tool | What it does |
|------|-------------|
| `browser_batch(actions[], paneId)` | Execute multiple actions in ONE roundtrip (faster). |

**Example — Fill form + submit in batch:**
```
mcp__codebrain__browser_batch(
  actions: [
    { name: "fill", selector: "input[name=email]", value: "test@example.com" },
    { name: "fill", selector: "input[name=password]", value: "secret" },
    { name: "click", selector: "button[type=submit]" },
    { name: "screenshot" }
  ],
  paneId: "ABC123"
)
```

### Computer Control (CDP Mode Only)

| Tool | What it does |
|------|-------------|
| `browser_computer(action, args, paneId)` | Low-level mouse/keyboard/screen actions. |

Actions: `left_click`, `right_click`, `double_click`, `mouse_move`, `type`, `key_press`, `screenshot`, `scroll`, `wait`, `cursor_position`, `get_screen_size`

---

## 🎓 Workflow Examples

### Example 1: Web Scraping

**Task:** Scrape product names and prices from an e-commerce site.

```
# Step 1: Open site
paneId = mcp__codebrain__browser_open(url: "https://shop.example.com/products")

# Step 2: Get page structure
tree = mcp__codebrain__browser_get_accessibility_tree(paneId: paneId)
# Identify: product rows have role="listitem", price is in <span class="price">

# Step 3: Extract all products
html = mcp__codebrain__browser_get_html(paneId: paneId)
# Parse HTML to find <div class="product"> elements

# Step 4: Iterate through pages
for page in range(1, 6):
  mcp__codebrain__browser_navigate(
    url: "https://shop.example.com/products?page=" + page,
    paneId: paneId
  )
  mcp__codebrain__browser_wait_for_load(paneId: paneId)
  products = parse_products(mcp__codebrain__browser_get_html(paneId: paneId))
  save_products(products)
```

### Example 2: Form Filling & Login

**Task:** Automate login to a website.

```
# Step 1: Open site
paneId = mcp__codebrain__browser_open(url: "https://app.example.com/login")

# Step 2: Fill login form
mcp__codebrain__browser_fill_form(
  fields: [
    { selector: "input#email", value: "user@example.com" },
    { selector: "input#password", value: "MyPassword123" }
  ],
  paneId: paneId
)

# Step 3: Submit + wait for redirect
mcp__codebrain__browser_click(selector: "button.login-btn", paneId: paneId)
mcp__codebrain__browser_wait_for_url(
  urlPattern: "/dashboard",
  paneId: paneId,
  timeout: 15000
)

# Step 4: Verify logged-in state
text = mcp__codebrain__browser_get_text(paneId: paneId)
if "Welcome" in text:
  print("✅ Login successful")
```

### Example 3: Screenshot Capture & Annotation

**Task:** Capture screenshot of a broken UI element.

```
# Step 1: Navigate to page
paneId = mcp__codebrain__browser_open(url: "https://example.com/ui-test")

# Step 2: Take screenshot
screenshot = mcp__codebrain__browser_screenshot(paneId: paneId)
print(screenshot)

# Step 3: Annotate the broken button
mcp__codebrain__browser_annotate(
  imagePath: "/tmp/screenshot.png",
  annotations: [
    {
      type: "box",
      selector: "button.broken",
      color: "red",
      label: "Button not clickable"
    },
    {
      type: "arrow",
      from: [150, 100],
      to: [200, 150],
      color: "red",
      label: "Expected click area"
    }
  ],
  paneId: paneId
)
```

### Example 4: Wait & Verify Dynamic Content

**Task:** Test a page that loads content dynamically.

```
# Step 1: Open site
paneId = mcp__codebrain__browser_open(url: "https://example.com/lazy-load")

# Step 2: Scroll to trigger loading
mcp__codebrain__browser_scroll(
  selector: ".infinite-scroll",
  direction: "down",
  amount: 5,
  paneId: paneId
)

# Step 3: Wait for new content
mcp__codebrain__browser_wait_for_text(
  text: "New items loaded",
  paneId: paneId,
  timeout: 5000
)

# Step 4: Verify
text = mcp__codebrain__browser_get_text(paneId: paneId)
count = text.count("item")
print(f"Loaded {count} items")
```

### Example 5: Network Monitoring

**Task:** Monitor network requests for API calls.

```
# Step 1: Open site
paneId = mcp__codebrain__browser_open(url: "https://app.example.com")

# Step 2: Click button that triggers API call
mcp__codebrain__browser_click(selector: "button.fetch-data", paneId: paneId)

# Step 3: Wait for request
mcp__codebrain__browser_network_wait(
  paneId: paneId,
  urlPattern: "/api/data",
  timeout: 5000
)

# Step 4: Check response
network = mcp__codebrain__browser_network_log(paneId: paneId)
for request in network:
  if "/api/data" in request.url:
    print(f"Status: {request.status}, Size: {request.size}")
```

---

## ⚙️ Configuration & Troubleshooting

### Port 9222 Not Detected?

If Chrome is running but CDP is not detected:

1. **Start Chrome with remote debugging enabled:**
   ```bash
   # Windows
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222

   # macOS
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

   # Linux
   google-chrome --remote-debugging-port=9222
   ```

2. Codebrain will auto-detect and switch to **CDP mode**.

### Webview Mode Issues?

If you're stuck in **webview mode** and need CDP:

1. Open native Chrome/Brave with `--remote-debugging-port=9222`
2. Restart Codebrain
3. Call `browser_guide()` to confirm mode switch

### Element Not Found?

1. Call `browser_get_accessibility_tree()` to see semantic structure
2. Verify CSS selector is correct (use browser DevTools to inspect)
3. Check if element is visible/hidden (use `browser_get_element_info()`)
4. Wait for element to load (use `browser_wait_for()`)

### Click Not Working?

1. Verify element is clickable: `browser_get_element_info(selector)`
2. Try clicking by text instead: `browser_click_text()`
3. Try coordinate-based click: `browser_click_at()`
4. Check for overlays blocking the click (use screenshot)

### Page Not Loading?

1. Check network errors: `browser_network_log()`
2. Check console errors: `browser_console_log(level: "error")`
3. Wait longer: `browser_wait_for_load(timeout: 30000)`
4. Try reload: `browser_reload()`

---

## 📋 Checklist: Before You Automate

- ✅ Call `browser_guide()` first
- ✅ Open browser with `browser_open()` or use existing paneId
- ✅ Read page structure with `browser_get_accessibility_tree()`
- ✅ Verify CSS selectors in browser DevTools
- ✅ Use `browser_wait_for_load()` after navigation
- ✅ Handle errors with try/catch in agent prompt
- ✅ Take screenshots to verify state
- ✅ Monitor console + network for issues

---

## 🔗 See Also

- [Codebrain MCP Skill](skill:codebrain) — Full MCP tools reference
- [Claude Code Browser Automation](guide:browser-automation)
- Chrome DevTools Protocol (CDP) — Official docs at https://chromedevtools.github.io/devtools-protocol/
