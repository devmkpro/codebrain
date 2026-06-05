# Claude in Chrome MCP Skill — Integration Guide

How to use this skill in Codebrain agents and projects.

---

## 📦 What You Get

A complete **browser automation skill** for Codebrain agents with:

- **prompt.md** (16.4 KB) — Full reference with 50+ examples
- **quick-reference.md** (10.1 KB) — Copy-paste code snippets
- **examples.md** (14.2 KB) — 8 real-world workflow examples
- **README.md** (3.7 KB) — Installation & overview
- **skill.json** — Manifest metadata

**Total:** 44.9 KB of actionable documentation

---

## 🚀 How to Use This Skill

### Option 1: Reference in Agent Prompts (RECOMMENDED)

When spawning an agent in Codebrain, include this in the prompt:

```
You have access to the skill "claude-in-chrome-mcp" for browser automation.

Use it to:
- Open and navigate websites
- Interact with forms, buttons, and dynamic content
- Scrape data from pages
- Test web applications
- Monitor network requests and console errors
- Take screenshots and annotate them

Start by reading the skill documentation:
mcp__codebrain__skill_get(id: "claude-in-chrome-mcp")

Then refer to:
- prompt.md for complete tool reference
- examples.md for workflow examples
- quick-reference.md for code snippets
```

### Option 2: Load Skill in Agent Terminal

```bash
# In any Codebrain agent terminal:
mcp__codebrain__skill_get(id: "claude-in-chrome-mcp")

# This returns the full skill content (manifest + prompt.md)
```

### Option 3: Copy Code Snippets

Open `quick-reference.md` and copy-paste the patterns you need:

```javascript
// Example: Open browser + click element
const paneId = await mcp__codebrain__browser_open({
  url: "https://example.com"
});

await mcp__codebrain__browser_click_text({
  text: "Login",
  paneId
});
```

---

## 📋 Skill Contents

### 1. **prompt.md** — Main Reference

Covers:
- **Browser Modes** — CDP vs Webview
- **Quick Start** — 5 steps to automate
- **Complete Tool Reference** — All 53 tools with descriptions
- **Real Workflows** — 5 examples (scraping, login, testing, etc.)
- **Troubleshooting** — Common issues + fixes

**Best for:** Understanding the full picture

### 2. **quick-reference.md** — Cheat Sheet

Contains:
- 🎯 Navigation (open, navigate, reload)
- 🔍 Reading (text, HTML, accessibility tree)
- 🎯 Clicking & interaction (click, hover, drag, scroll)
- ✏️ Filling forms (fill fields, select, check boxes)
- ⌨️ Keyboard (type, keys, shortcuts)
- 📸 Screenshots & annotation
- ⏳ Wait & assertions
- 💻 JavaScript execution
- 🗂️ Tab management (CDP only)
- ⚡ Batch operations (CDP only)
- ✅ Pre-check checklist
- 🐛 Troubleshooting quick fixes
- 🎯 Common patterns

**Best for:** Copy-paste ready code

### 3. **examples.md** — Real-World Workflows

8 complete examples:
1. **E-Commerce Scraper** — Pagination + data extraction
2. **Login & Dashboard** — Authentication + verification
3. **Form Filling** — Multi-step form automation
4. **Infinite Scroll** — Dynamic content loading
5. **UI Testing** — Complete test workflow
6. **Batch Operations** — Multiple actions in one call
7. **Multi-Tab Automation** — Tab management
8. **JavaScript Execution** — Custom DOM manipulation

**Best for:** Learning patterns for your use case

### 4. **README.md** — Overview

Quick reference:
- What's included
- Installation options
- How to use the skill
- Key sections at a glance
- Prerequisites
- Common patterns
- Support tips

**Best for:** Getting started

---

## 🎯 Usage Examples by Role

### 👨‍💻 Backend Agent (API Testing)

```javascript
// Use this skill to test APIs by:
// 1. Navigate to API documentation
// 2. Fill request forms
// 3. Monitor network requests
// 4. Check responses

const paneId = await mcp__codebrain__browser_open({
  url: "https://api.example.com/docs"
});

await mcp__codebrain__browser_click_text({ text: "Try it out", paneId });
await mcp__codebrain__browser_fill_form({
  fields: [{ selector: "input[name=id]", value: "123" }],
  paneId
});
await mcp__codebrain__browser_click({ selector: "button.execute", paneId });
await mcp__codebrain__browser_network_wait({
  urlPattern: "/api/",
  paneId
});
```

### 🎨 Frontend Agent (Component Testing)

```javascript
// Use this skill to test UI components by:
// 1. Navigate to component library
// 2. Interact with components
// 3. Take screenshots
// 4. Verify accessibility

const paneId = await mcp__codebrain__browser_open({
  url: "http://localhost:6006"
});

const tree = await mcp__codebrain__browser_get_accessibility_tree({ paneId });
console.log(tree); // Verify roles and labels

await mcp__codebrain__browser_screenshot({ paneId });
```

### 🧪 UI Tester Agent (End-to-End Testing)

```javascript
// Use this skill to test full workflows by:
// 1. Perform user actions
// 2. Wait for results
// 3. Verify state
// 4. Check for errors

const paneId = await mcp__codebrain__browser_open({
  url: "http://localhost:3000"
});

// Execute workflow
await mcp__codebrain__browser_fill_form({
  fields: [{ selector: "input#search", value: "test" }],
  paneId
});
await mcp__codebrain__browser_key({ key: "Enter", paneId });

// Verify results
await mcp__codebrain__browser_wait_for_text({
  text: "Results found",
  paneId
});

const errors = await mcp__codebrain__browser_console_log({
  level: "error",
  paneId
});
console.assert(errors.messages.length === 0, "Console errors found");
```

### 📊 Researcher Agent (Data Extraction)

```javascript
// Use this skill to extract data by:
// 1. Navigate to data source
// 2. Scrape content
// 3. Handle pagination
// 4. Save results

const paneId = await mcp__codebrain__browser_open({
  url: "https://example.com/data"
});

const data = await mcp__codebrain__browser_eval({
  script: `
    Array.from(document.querySelectorAll('[data-item]'))
      .map(el => JSON.parse(el.dataset.item))
  `,
  paneId
});

// Save data...
```

---

## 🔧 Integration with Codebrain Features

### With Pane Management
```javascript
// Spawn agent + browser in same session
const agentId = await mcp__codebrain__pane_spawn({
  agent: "openclaude",
  model: "gemini-3.1-pro-preview"
});

// Agent uses browser_open to create UI pane
const browserPane = await mcp__codebrain__browser_open({
  url: "https://example.com"
});
```

### With Memory System
```javascript
// Save findings to shared memory
await mcp__codebrain__memory_write({
  key: "website_structure_example",
  type: "semantic",
  content: tree, // accessibility tree from browser_get_accessibility_tree
  tags: ["browser-automation", "website-structure"]
});

// Later: retrieve findings
const memory = await mcp__codebrain__memory_search({
  query: "website structure",
  type: "semantic"
});
```

### With Task Tracking
```javascript
// Update task sidebar during automation
await mcp__codebrain__todo_manager({
  action: "move_to_task",
  moveToTask: "Testing login flow"
});

// When done
await mcp__codebrain__todo_manager({
  action: "move_to_task",
  moveToTask: "Verifying results"
});
```

### With Inter-Agent Messaging
```javascript
// Browser automation agent sends results to coordinator
await mcp__codebrain__pane_send_message({
  from: myPaneId,
  to: orchestratorPaneId,
  content: "Scraped 150 products from https://shop.example.com",
  type: "result"
});
```

---

## ✅ Installation Verification

Check that the skill is installed:

```bash
# List skills
mcp__codebrain__skill_list()

# Should include: claude-in-chrome-mcp

# Get skill details
mcp__codebrain__skill_get(id: "claude-in-chrome-mcp")
```

---

## 📚 When to Use Each File

| File | Use When |
|------|----------|
| **prompt.md** | You need detailed explanations or reference material |
| **quick-reference.md** | You need code snippets to copy-paste |
| **examples.md** | You're learning a pattern (scraping, testing, etc.) |
| **README.md** | You need installation or quick overview |
| **This file** | You're integrating the skill into Codebrain workflows |

---

## 🎓 Learning Path

1. **New to browser automation?** → Start with README.md
2. **Need specific tool?** → Check quick-reference.md
3. **Learning a pattern?** → Read examples.md
4. **Deep understanding?** → Read prompt.md sections
5. **Troubleshooting?** → Check prompt.md "Troubleshooting" or examples.md "Tips & Best Practices"

---

## 🤔 FAQ

### Q: Can I use this in non-Codebrain projects?
**A:** No, this skill is specific to Codebrain's MCP tool ecosystem. For standalone projects, use Puppeteer or Playwright directly.

### Q: Do I need Chrome installed?
**A:** Yes, for best results (CDP mode). Falls back to Electron webview if unavailable.

### Q: Can I use this with CLI agents (claude, gemini, codex)?
**A:** Yes! Any agent that has access to Codebrain's MCP tools can use this.

### Q: Is it production-ready?
**A:** Yes, all examples have error handling patterns. Always check console logs and network errors.

### Q: How do I extend this skill?
**A:** Create a new skill or modify this one. All files are markdown/JSON — easy to edit.

---

## 🚀 Next Steps

1. ✅ Skill installed at `.codebrain/skills/claude-in-chrome-mcp/`
2. 📖 Read quick-reference.md for quick overview
3. 💻 Try Example 1 (E-Commerce Scraper) from examples.md
4. 🧪 Create your own automation workflow
5. 📝 Save findings to memory for future use
6. 🔄 Reuse patterns from pattern_list() in similar tasks

---

**Version:** 1.0.0  
**Updated:** 2026-06-05  
**Author:** MK (maikeofc18@gmail.com)  
**Status:** ✅ Ready to use

---

## 📞 Support

- Check **Troubleshooting** section in prompt.md
- Review examples.md "Tips & Best Practices"
- Check browser console + network logs for errors
- Take screenshots to visually debug
- Use browser_get_accessibility_tree() to inspect page structure
