# Claude in Chrome MCP — Quick Reference

Copy-paste ready code snippets for common tasks.

---

## 📍 Navigation

```javascript
// Open new browser pane
const paneId = await mcp__codebrain__browser_open({
  url: "https://example.com"
});

// Navigate in existing pane
await mcp__codebrain__browser_navigate({
  url: "https://example.com/page2",
  paneId
});

// Go back/forward
await mcp__codebrain__browser_back({ paneId });
await mcp__codebrain__browser_forward({ paneId });

// Reload
await mcp__codebrain__browser_reload({ paneId });

// Get current URL
const urlInfo = await mcp__codebrain__browser_get_url({ paneId });
console.log(urlInfo.url, urlInfo.title);
```

---

## 🔍 Reading Content

```javascript
// Get visible text only
const text = await mcp__codebrain__browser_get_text({ paneId });

// Get raw HTML
const html = await mcp__codebrain__browser_get_html({
  selector: ".content", // optional
  paneId
});

// Get semantic tree (BEST for AI)
const tree = await mcp__codebrain__browser_get_accessibility_tree({
  maxDepth: 3,
  paneId
});

// Get specific element info
const info = await mcp__codebrain__browser_get_element_info({
  selector: "button.submit",
  paneId
});

// Get everything at once
const summary = await mcp__codebrain__browser_page_summary({ paneId });
```

---

## 🎯 Clicking & Interaction

```javascript
// Click by CSS selector
await mcp__codebrain__browser_click({
  selector: "button.submit",
  paneId
});

// Click by visible text
await mcp__codebrain__browser_click_text({
  text: "Login",
  paneId
});

// Click at coordinates
await mcp__codebrain__browser_click_at({
  x: 150,
  y: 200,
  button: "left", // or "right", "middle"
  paneId
});

// Hover
await mcp__codebrain__browser_hover({
  selector: ".tooltip-trigger",
  paneId
});

// Drag
await mcp__codebrain__browser_drag({
  x1: 100,
  y1: 200,
  x2: 300,
  y2: 400,
  steps: 10,
  paneId
});

// Scroll
await mcp__codebrain__browser_scroll({
  selector: ".container", // optional, scrolls page if omitted
  direction: "down", // or "up", "left", "right"
  amount: 5,
  paneId
});
```

---

## ✏️ Filling Forms

```javascript
// Fill single field
await mcp__codebrain__browser_fill({
  selector: "input[name=email]",
  value: "user@example.com",
  clearFirst: true,
  paneId
});

// Fill multiple fields at once
await mcp__codebrain__browser_fill_form({
  fields: [
    { selector: "input[name=email]", value: "user@example.com" },
    { selector: "input[name=password]", value: "secret123" },
    { selector: "textarea[name=message]", value: "Hello world" }
  ],
  paneId
});

// Clear input
await mcp__codebrain__browser_clear({
  selector: "input.search",
  paneId
});

// Select dropdown
await mcp__codebrain__browser_select({
  selector: "select[name=country]",
  value: "United States", // by text or value
  paneId
});

// Check/uncheck checkbox
await mcp__codebrain__browser_check({
  selector: "input[type=checkbox]",
  checked: true,
  paneId
});

// Focus element
await mcp__codebrain__browser_focus({
  selector: "input.search",
  paneId
});
```

---

## ⌨️ Keyboard & Text Input

```javascript
// Type text
await mcp__codebrain__browser_type({
  text: "Hello world",
  paneId
});

// Press key
await mcp__codebrain__browser_key({
  key: "Enter", // or Tab, Escape, ArrowDown, etc.
  paneId
});

// Keyboard shortcut (CDP only)
await mcp__codebrain__browser_shortcut({
  keys: "Ctrl+A", // Ctrl+C, Ctrl+V, Cmd+Z, etc.
  paneId
});
```

---

## 📸 Screenshots

```javascript
// Screenshot of viewport
const screenshot = await mcp__codebrain__browser_screenshot({
  paneId
});
console.log(screenshot); // Text description

// Screenshot of specific element
const elemScreenshot = await mcp__codebrain__browser_screenshot_element({
  selector: ".product-card",
  paneId
});

// Annotate screenshot
await mcp__codebrain__browser_annotate({
  imagePath: "/path/to/screenshot.png",
  annotations: [
    {
      type: "box",
      selector: "button.broken",
      color: "red",
      label: "Not clickable"
    },
    {
      type: "arrow",
      from: [100, 200],
      to: [300, 400],
      color: "blue"
    }
  ],
  paneId
});
```

---

## ⏳ Wait & Assertions

```javascript
// Wait for element to appear
await mcp__codebrain__browser_wait_for({
  selector: ".modal",
  paneId,
  timeout: 5000
});

// Wait for specific text
await mcp__codebrain__browser_wait_for_text({
  text: "Loading complete",
  paneId,
  timeout: 10000
});

// Wait for URL change
await mcp__codebrain__browser_wait_for_url({
  urlPattern: "/dashboard",
  paneId,
  timeout: 15000
});

// Wait for page load (network idle)
await mcp__codebrain__browser_wait_for_load({
  paneId,
  timeout: 30000
});
```

---

## 🔍 Finding Elements

```javascript
// Find by text
const element = await mcp__codebrain__browser_find_by_text({
  text: "Click me",
  role: "button", // optional: "button", "link", "checkbox", etc.
  exact: false,   // optional: exact match only
  paneId
});

// Find by CSS selector (use get_element_info)
const info = await mcp__codebrain__browser_get_element_info({
  selector: "div.my-class span.nested",
  paneId
});

// Natural language search (CDP only)
const elements = await mcp__codebrain__browser_find({
  query: "red button in the top right",
  paneId
});
```

---

## 📊 Console & Network

```javascript
// Read console logs
const logs = await mcp__codebrain__browser_console_log({
  level: "error", // or "log", "warn"
  since: 60000,   // last 60 seconds
  paneId
});

// Clear console
await mcp__codebrain__browser_clear_console({ paneId });

// Read network requests
const network = await mcp__codebrain__browser_network_log({
  filter: "api/users", // optional
  since: 60000,        // optional
  paneId
});

// Wait for specific network request
await mcp__codebrain__browser_network_wait({
  urlPattern: "/api/data",
  paneId,
  timeout: 5000
});

// Clear network log
await mcp__codebrain__browser_clear_network({ paneId });
```

---

## 💻 JavaScript Execution

```javascript
// Run JavaScript in page context
const result = await mcp__codebrain__browser_eval({
  script: `
    document.querySelectorAll('a').map(a => ({
      href: a.href,
      text: a.textContent
    })).slice(0, 5)
  `,
  paneId
});

console.log(result.result); // Returns the result
```

---

## 🗂️ Tabs (CDP Mode Only)

```javascript
// List all tabs
const tabs = await mcp__codebrain__browser_tabs_list({ paneId });

// Create new tab
const newTab = await mcp__codebrain__browser_tabs_create({
  url: "https://example.com",
  paneId
});

// Close tab
await mcp__codebrain__browser_tabs_close({
  tabId: newTab.tabId,
  paneId
});
```

---

## ⚡ Batch Operations (CDP Mode Only)

```javascript
// Execute multiple actions in one roundtrip
const results = await mcp__codebrain__browser_batch({
  actions: [
    { name: "fill", selector: "input[type=email]", value: "test@example.com" },
    { name: "fill", selector: "input[type=password]", value: "secret" },
    { name: "click", selector: "button[type=submit]" },
    { name: "wait_for_load" },
    { name: "screenshot" }
  ],
  paneId
});
```

---

## 🎮 Computer Control (CDP Mode Only)

```javascript
// Low-level mouse/keyboard control
await mcp__codebrain__browser_computer({
  action: "left_click",
  coordinate: [150, 200],
  paneId
});

// Available actions:
// - "left_click", "right_click", "double_click", "middle_click"
// - "mouse_move", "left_click_drag"
// - "key_press", "type"
// - "scroll", "screenshot"
// - "wait", "cursor_position", "get_screen_size"
```

---

## ✅ Pre-Check Checklist

Always do this BEFORE browser automation:

```javascript
// 1. Check browser mode
const guide = await mcp__codebrain__browser_guide();

// 2. Open browser
const paneId = await mcp__codebrain__browser_open({
  url: "https://example.com"
});

// 3. Wait for load
await mcp__codebrain__browser_wait_for_load({ paneId });

// 4. Read structure
const tree = await mcp__codebrain__browser_get_accessibility_tree({ paneId });
console.log(tree); // Verify selectors are correct

// 5. Start automating
// ...
```

---

## 🐛 Troubleshooting Quick Fixes

```javascript
// Element not found? Debug with tree
const tree = await mcp__codebrain__browser_get_accessibility_tree({ paneId });

// Click not working? Check visibility
const info = await mcp__codebrain__browser_get_element_info({
  selector: "button.submit",
  paneId
});

// Page stuck loading? Check errors
const errors = await mcp__codebrain__browser_console_log({
  level: "error",
  paneId
});

// Form filled but not submitting? Try key press
await mcp__codebrain__browser_key({ key: "Enter", paneId });

// Still not working? Take screenshot
const screenshot = await mcp__codebrain__browser_screenshot({ paneId });
```

---

## 🎯 Common Patterns

### Pattern: Login
```javascript
const paneId = await mcp__codebrain__browser_open({ url: "https://app.example.com/login" });
await mcp__codebrain__browser_wait_for_load({ paneId });
await mcp__codebrain__browser_fill_form({
  fields: [
    { selector: "input#email", value: "test@example.com" },
    { selector: "input#password", value: "password123" }
  ],
  paneId
});
await mcp__codebrain__browser_click({ selector: "button[type=submit]", paneId });
await mcp__codebrain__browser_wait_for_url({ urlPattern: "/dashboard", paneId });
```

### Pattern: Scrape List
```javascript
const paneId = await mcp__codebrain__browser_open({ url: "https://example.com/list" });
const items = await mcp__codebrain__browser_eval({
  script: `document.querySelectorAll('[data-item]').map(el => el.textContent)`,
  paneId
});
```

### Pattern: Wait & Verify
```javascript
await mcp__codebrain__browser_wait_for_text({ text: "Success", paneId, timeout: 5000 });
const text = await mcp__codebrain__browser_get_text({ paneId });
console.assert(text.includes("Success"), "Verification failed");
```

### Pattern: Screenshot & Annotate
```javascript
const paneId = await mcp__codebrain__browser_open({ url: "https://example.com" });
const screenshot = await mcp__codebrain__browser_screenshot({ paneId });
await mcp__codebrain__browser_annotate({
  imagePath: "/tmp/screenshot.png",
  annotations: [{ type: "box", selector: "button.error", color: "red" }],
  paneId
});
```

---

**Last updated:** 2026-06-05  
**Skill version:** 1.0.0  
**For full docs:** See `prompt.md` in this skill
