# Claude in Chrome MCP Skill

Complete guide to using browser automation with Claude in Chrome and Codebrain MCP tools.

## 📦 What's Included

- **prompt.md** — Full guide with 50+ examples covering all browser automation tools
- **skill.json** — Manifest with metadata and tags

## 🚀 Installation

### Option 1: Project-Scoped (Recommended)
The skill is already in `.codebrain/skills/claude-in-chrome-mcp/` — local to this Codebrain project.

### Option 2: Global Installation
Copy to your global skills directory:
```bash
# Windows
copy .codebrain\skills\claude-in-chrome-mcp %USERPROFILE%\.codebrain\skills\

# macOS/Linux
cp -r .codebrain/skills/claude-in-chrome-mcp ~/.codebrain/skills/
```

## 📖 How to Use

### In Codebrain Agent
When an agent needs to automate browser tasks, reference this skill:

```
Use the skill "claude-in-chrome-mcp" to understand how to:
- Navigate websites
- Fill forms and click buttons
- Scrape content
- Take screenshots
- Monitor network requests
```

### Via CLI
```bash
# List installed skills
mcp__codebrain__skill_list()

# Get full content of this skill
mcp__codebrain__skill_get(id: "claude-in-chrome-mcp")
```

## 📚 Contents at a Glance

The **prompt.md** covers:

1. **Browser Modes** — CDP (Chrome DevTools) vs Webview
2. **Quick Start** — 5 steps to automate your first page
3. **Complete Reference** — All 53+ browser tools with examples
4. **Workflows** — 5 real-world examples (scraping, login, screenshots, etc.)
5. **Troubleshooting** — Common issues + fixes

## 🎯 Key Sections

| Section | What you'll learn |
|---------|------------------|
| **Navigation & Page State** | How to navigate, reload, go back/forward |
| **DOM Reading** | Reading HTML, text, accessibility tree |
| **DOM Interaction** | Clicking, filling forms, selecting dropdowns |
| **Coordinates** | Precise mouse/drag operations |
| **Keyboard** | Typing, pressing keys, shortcuts |
| **Screenshots** | Capturing and annotating screenshots |
| **Console & Network** | Monitoring errors and API requests |
| **Wait & Assertions** | Waiting for elements, text, URLs to load |
| **JavaScript** | Running code in page context |
| **Tabs** | Managing multiple tabs (CDP mode) |
| **Batch** | Multiple actions in one call (CDP mode) |

## 🔧 Prerequisites

- **Codebrain** running (v1.8.0+)
- **Chrome or Brave** browser installed (for CDP mode)
- **MCP tools** available in your Codebrain agent

## 💡 Common Patterns

### Pattern 1: Scrape Data
```
browser_open() → browser_get_html() → parse → loop through pages
```

### Pattern 2: Test UI
```
browser_open() → browser_fill_form() → browser_click() → browser_wait_for() → browser_screenshot()
```

### Pattern 3: Monitor Errors
```
browser_navigate() → browser_console_log() → check for errors
```

### Pattern 4: API Testing
```
browser_click() → browser_network_wait() → browser_network_log() → verify response
```

## 🚨 Important Notes

⚠️ **Always call `browser_guide()` first** before any browser tool — this ensures you understand the current mode.

⚠️ **CDP mode** (native Chrome) offers 10x more features than webview mode.

⚠️ **Port 9222** must be available for Chrome DevTools Protocol detection.

## 📞 Support

For issues or questions:
1. Check the **Troubleshooting** section in prompt.md
2. Verify you're in the correct browser mode (CDP vs webview)
3. Check browser console + network logs
4. Ensure selectors are correct (use DevTools in real Chrome/Brave)

## 📝 Version

- **Skill version:** 1.0.0
- **Created:** 2026-06-05
- **Author:** MK (maikeofc18@gmail.com)
- **Tags:** browser-automation, mcp, chrome, testing, web-scraping, ui-automation

---

**Happy automating! 🚀**
