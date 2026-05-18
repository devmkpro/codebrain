---
name: browser-automation
description: Web browser automation with AI-optimized element discovery
version: 1.0.0
triggers:
  - /browser
  - browse
  - web automation
  - scrape
  - navigate
  - screenshot
tools:
  - browser_guide
  - browser_open
  - browser_navigate
  - browser_get_accessibility_tree
  - browser_get_text
  - browser_get_html
  - browser_find_by_text
  - browser_get_element_info
  - browser_click
  - browser_fill
  - browser_select
  - browser_check
  - browser_clear
  - browser_focus
  - browser_hover
  - browser_click_at
  - browser_hover_at
  - browser_drag
  - browser_scroll
  - browser_type
  - browser_key
  - browser_shortcut
  - browser_wait_for
  - browser_wait_for_text
  - browser_wait_for_url
  - browser_wait_for_load
  - browser_screenshot
  - browser_screenshot_element
  - browser_annotate
  - browser_console_log
  - browser_network_log
  - browser_eval
---

# Browser Automation Skill

Web browser automation with 30 MCP tools for navigation, DOM interaction, keyboard input, screenshots, and console/network monitoring.

## CRITICAL RULES

1. **ALWAYS call `browser_guide()` first** — mandatory before any other browser tool
2. **NEVER guess routes** (/login, /dashboard) — read the DOM and follow real links
3. **NEVER use system commands** (start, open) — use `browser_open()` instead
4. **Use ONE browser pane** — navigate with `browser_navigate()`, don't open multiple
5. **Read before interacting** — use `browser_get_accessibility_tree()` to understand structure
6. **Wait for state** — use `browser_wait_for_load()` after navigation

## Core Workflow

```
1. browser_guide() → READ THIS FIRST
2. browser_open(url) → open browser
3. browser_wait_for_load() → wait for page
4. browser_get_accessibility_tree() → understand structure
5. browser_find_by_text(text, role) → find elements
6. browser_click(selector) → interact
7. browser_screenshot() → capture proof
```

## Quick Reference

### Navigation
| Tool | Description |
|------|-------------|
| `browser_open(url)` | Open new browser pane |
| `browser_navigate(url)` | Navigate to URL |
| `browser_back()` | Go back |
| `browser_forward()` | Go forward |
| `browser_reload(hard?)` | Reload page |

### DOM Reading
| Tool | Description |
|------|-------------|
| `browser_get_accessibility_tree()` | Best for AI — semantic tree |
| `browser_get_text(selector?)` | Visible text |
| `browser_get_html(selector?)` | Raw HTML |
| `browser_find_by_text(text, role?)` | Find by visible text |
| `browser_get_element_info(selector)` | Full element info |
| `browser_get_url()` | Current URL + title |

### DOM Interaction
| Tool | Description |
|------|-------------|
| `browser_click(selector)` | Click element |
| `browser_fill(selector, value)` | Fill input |
| `browser_select(selector, value)` | Select dropdown |
| `browser_check(selector, checked?)` | Toggle checkbox |
| `browser_clear(selector)` | Clear input |
| `browser_focus(selector)` | Focus element |
| `browser_hover(selector)` | Hover element |

### Coordinate Interaction
| Tool | Description |
|------|-------------|
| `browser_click_at(x, y)` | Click at coordinates |
| `browser_hover_at(x, y)` | Hover at coordinates |
| `browser_drag(x1, y1, x2, y2)` | Drag and drop |
| `browser_scroll(direction, amount)` | Scroll page |

### Keyboard
| Tool | Description |
|------|-------------|
| `browser_type(text)` | Type text |
| `browser_key(key)` | Press key (Enter, Escape, Tab) |
| `browser_shortcut(keys)` | Keyboard shortcut (Ctrl+A) |

### Wait/Assertions
| Tool | Description |
|------|-------------|
| `browser_wait_for(selector)` | Wait for element |
| `browser_wait_for_text(text)` | Wait for text |
| `browser_wait_for_url(pattern)` | Wait for URL |
| `browser_wait_for_load()` | Wait for page load |

### Screenshots
| Tool | Description |
|------|-------------|
| `browser_screenshot(fullPage?)` | Capture viewport |
| `browser_screenshot_element(selector)` | Capture element |
| `browser_annotate(path, annotations)` | Draw on screenshot |

### Console/Network
| Tool | Description |
|------|-------------|
| `browser_console_log(level?)` | Read console entries |
| `browser_network_log(url?, method?, status?)` | Read network requests |
| `browser_eval(js)` | Execute JavaScript |

## Selectors

### From Accessibility Tree (Recommended)
```
browser_get_accessibility_tree()
→ Shows: button "Submit" [ref=e2], input "Email" [ref=e3]

browser_click("button") → generic
browser_find_by_text("Submit", "button") → by text
```

### CSS Selectors
```
browser_click("#submit") → by ID
browser_fill(".email-input", "test@test.com") → by class
browser_click("button[type='submit']") → by attribute
```

## Examples

### Login Flow
```
browser_guide()
browser_open("https://example.com/login")
browser_wait_for_load()
browser_get_accessibility_tree()
browser_fill("input[name='email']", "user@example.com")
browser_fill("input[name='password']", "password123")
browser_click("button[type='submit']")
browser_wait_for_url("**/dashboard")
browser_console_log("error")
browser_screenshot()
```

### Form Submission
```
browser_guide()
browser_open("https://example.com/contact")
browser_wait_for_load()
browser_fill("input[name='name']", "John Doe")
browser_fill("input[name='email']", "john@example.com")
browser_fill("textarea[name='message']", "Hello!")
browser_click("button[type='submit']")
browser_wait_for_text("Thank you")
browser_screenshot()
```

### Data Extraction
```
browser_guide()
browser_open("https://example.com/products")
browser_wait_for_load()
browser_get_text(".product-name") → product name
browser_get_text(".product-price") → price
browser_get_element_info(".product-link") → href attribute
```

## Tips

1. **Always use accessibility tree** — it's optimized for AI understanding
2. **Prefer semantic selectors** — buttons, links, inputs over CSS classes
3. **Re-snapshot after navigation** — page state changes
4. **Wait before interacting** — use wait_for_load() or wait_for()
5. **Never read screenshot PNGs** — use the text description returned
6. **One browser pane** — navigate, don't open multiple
