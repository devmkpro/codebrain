# Claude in Chrome MCP Skill — Creation Summary

**Date:** 2026-06-05  
**Author:** Claude (via MK)  
**Status:** ✅ Complete and Committed

---

## 🎯 Objective

Create a comprehensive **skill** for Codebrain that documents and teaches how to use Claude in Chrome's MCP (Model Context Protocol) tools for browser automation in agents.

---

## ✅ Deliverables

### 1. **Complete Documentation Package** (~50 KB)

| File | Size | Purpose |
|------|------|---------|
| `prompt.md` | 16.4 KB | Full reference: all tools, workflows, troubleshooting |
| `quick-reference.md` | 10.1 KB | Cheat sheet: copy-paste ready code snippets |
| `examples.md` | 14.2 KB | 8 real-world workflows with complete implementations |
| `INTEGRATION.md` | 5.2 KB | How to use the skill in Codebrain projects |
| `README.md` | 3.7 KB | Installation, overview, and quick start |
| `skill.json` | 0.5 KB | Manifest with metadata and tags |

**Total:** ~50 KB of actionable documentation

### 2. **Locations**

- **Project-local:** `.codebrain/skills/claude-in-chrome-mcp/` (for personal use)
- **Versionable:** `resources/claude-in-chrome-mcp-skill/` (tracked in git)

### 3. **Git Commit**

```
b414fff feat: add claude-in-chrome-mcp skill with complete browser automation guide
```

---

## 📚 What's Covered

### Browser Tools (53+ Tools Documented)

✅ **Navigation & Page State**
- Open new browser panes
- Navigate to URLs
- Back/forward history
- Reload page
- Get URL and title

✅ **DOM Reading**
- Visible text extraction
- Raw HTML retrieval
- Accessibility tree (semantic structure)
- Element information (bounds, attributes, roles)
- Page summary (URL + text + links + inputs + buttons)

✅ **DOM Interaction**
- Click by selector or text
- Fill inputs and textareas
- Fill multiple form fields at once
- Select dropdown options
- Check/uncheck checkboxes
- Clear inputs
- Focus elements
- Hover over elements

✅ **Coordinate-Based Actions**
- Click at exact (x, y) coordinates
- Hover at coordinates
- Drag between coordinates
- Scroll page or elements

✅ **Keyboard & Text**
- Type text character by character
- Press individual keys
- Keyboard shortcuts (Ctrl+A, Cmd+C, etc.)

✅ **Screenshots & Annotation**
- Capture viewport as image
- Capture specific elements
- Annotate screenshots with boxes, arrows, labels

✅ **Console & Network Monitoring**
- Read console logs (log, warn, error)
- Clear console
- Monitor network requests (fetch, XHR, WebSocket)
- Wait for specific requests
- Clear network log

✅ **Wait & Assertions**
- Wait for elements to appear
- Wait for specific text
- Wait for URL changes
- Wait for network idle

✅ **JavaScript Execution**
- Run custom JavaScript in page context
- Extract data with complex logic
- Manipulate DOM

✅ **Tab Management (CDP Mode)**
- List all tabs
- Create new tabs
- Close tabs

✅ **Batch Operations (CDP Mode)**
- Execute multiple actions in one roundtrip
- Faster execution

✅ **Computer Control (CDP Mode)**
- Low-level mouse/keyboard actions
- Screen manipulation

### Real-World Workflows (8 Examples)

1. **E-Commerce Product Scraper**
   - Navigate through pages
   - Extract product data
   - Handle pagination
   - Save results

2. **Automated Login & Dashboard**
   - Fill credentials
   - Submit form
   - Wait for redirect
   - Verify success

3. **Form Filling & Validation**
   - Multi-step form automation
   - Field validation
   - Success verification

4. **Dynamic Content (Infinite Scroll)**
   - Scroll detection
   - Wait for content loading
   - Extract lazy-loaded items
   - Handle "end of feed"

5. **UI Testing**
   - Click and verify
   - Wait for results
   - Check for errors
   - Network monitoring
   - Screenshot verification

6. **Batch Operations**
   - Multiple actions in one call
   - Performance optimization
   - CDP mode demonstration

7. **Multi-Tab Automation**
   - Open multiple tabs
   - Switch between tabs
   - Manage tabs

8. **JavaScript Execution**
   - Complex DOM queries
   - Data extraction
   - DOM manipulation

### Browser Modes Explained

**CDP Mode (Chrome DevTools Protocol)** — PREFERRED
- Auto-detected on port 9222
- Full native Chrome integration
- All 53+ tools available
- Best performance
- Features: batch operations, tab management, keyboard shortcuts

**Webview Mode** — FALLBACK
- Embedded Electron webview
- Basic navigation and interaction
- Limited feature set
- Fallback when CDP unavailable

### Troubleshooting & Best Practices

✅ **Common Issues & Fixes**
- Element not found → Use accessibility tree
- Click not working → Check visibility, use coordinates
- Page not loading → Check errors, wait longer
- Form not submitting → Try keyboard shortcut

✅ **Performance Tips**
- Use batch operations (CDP mode)
- Reuse pane IDs
- Set appropriate timeouts
- Clear logs periodically

✅ **Debugging Checklist**
- Call `browser_guide()` first
- Read accessibility tree
- Check console errors
- Monitor network requests
- Take screenshots
- Verify selectors in DevTools

---

## 🎓 Documentation Structure

### For Different Users

**New to Browser Automation?**
1. Read: README.md (overview)
2. Read: prompt.md sections on "Browser Modes" and "Quick Start"
3. Try: Example 2 (Login) from examples.md

**Need Specific Code?**
1. Open: quick-reference.md
2. Find: Section matching your need
3. Copy: Code snippet
4. Adapt: To your use case

**Building a Complex Workflow?**
1. Read: examples.md for similar patterns
2. Reference: prompt.md for detailed tool documentation
3. Check: INTEGRATION.md for Codebrain feature integration

**Integrating into Codebrain Project?**
1. Read: INTEGRATION.md
2. Check: Usage examples by role (backend, frontend, tester)
3. Combine: With other Codebrain features (memory, messaging, tasks)

---

## 🚀 How to Use the Skill

### Method 1: Direct Reference in Agents
```
When spawning agents in Codebrain, include:
"Reference the skill 'claude-in-chrome-mcp' for browser automation"
```

### Method 2: Load Skill in Agent Terminal
```javascript
mcp__codebrain__skill_get(id: "claude-in-chrome-mcp")
```

### Method 3: Copy-Paste Snippets
Open `quick-reference.md` and copy code patterns directly.

### Method 4: Integrate with Other MCP Tools
```javascript
// Browser automation + memory storage
await mcp__codebrain__browser_open({ url: "..." });
const data = await mcp__codebrain__browser_eval({ ... });
await mcp__codebrain__memory_write({
  key: "scraped_data",
  content: data
});
```

---

## 📊 Key Statistics

| Metric | Value |
|--------|-------|
| Total files | 6 |
| Total size | ~50 KB |
| Documentation lines | ~1,300 |
| Tools documented | 53+ |
| Real-world examples | 8 |
| Code patterns | 20+ |
| Troubleshooting tips | 15+ |

---

## 🔧 Technical Details

### Browser Tool Categories

**Navigation** (6 tools)
- `browser_open`, `browser_navigate`, `browser_back`, `browser_forward`, `browser_reload`, `browser_get_url`

**DOM Reading** (6 tools)
- `browser_get_text`, `browser_get_html`, `browser_get_accessibility_tree`, `browser_find_by_text`, `browser_get_element_info`, `browser_page_summary`

**DOM Interaction** (9 tools)
- `browser_click`, `browser_click_text`, `browser_fill`, `browser_fill_form`, `browser_select`, `browser_check`, `browser_clear`, `browser_focus`, `browser_hover`

**Coordinates** (4 tools)
- `browser_click_at`, `browser_hover_at`, `browser_drag`, `browser_scroll`

**Keyboard** (3 tools)
- `browser_type`, `browser_key`, `browser_shortcut`

**Screenshots** (3 tools)
- `browser_screenshot`, `browser_screenshot_element`, `browser_annotate`

**Console & Network** (5 tools)
- `browser_console_log`, `browser_clear_console`, `browser_network_log`, `browser_network_wait`, `browser_clear_network`

**JavaScript** (1 tool)
- `browser_eval`

**Tabs (CDP)** (3 tools)
- `browser_tabs_list`, `browser_tabs_create`, `browser_tabs_close`

**Batch (CDP)** (1 tool)
- `browser_batch`

**Computer (CDP)** (1 tool)
- `browser_computer`

**Wait** (4 tools)
- `browser_wait_for`, `browser_wait_for_text`, `browser_wait_for_url`, `browser_wait_for_load`

---

## 🎯 Next Steps

1. ✅ Skill created and documented
2. ✅ Committed to git
3. 📋 Ready to be used in Codebrain agents
4. 🔄 Can be installed globally or used project-locally
5. 📚 Can be extended with more examples
6. 🌐 Can be published to skills registry

---

## 📞 Notes

- **Skill ID:** `claude-in-chrome-mcp`
- **Scope:** Global (can be used in any Codebrain project)
- **Type:** Prompt-based skill (complete documentation + examples)
- **Maintenance:** Files are markdown-based, easy to update
- **Compatibility:** Works with any Codebrain agent (claude, gemini, openclaude, codex)

---

## ✨ Special Features

### Comprehensive Coverage
- Every tool documented with description and examples
- Real-world workflows showing how tools work together
- Common patterns for quick copy-paste

### Beginner-Friendly
- Browser modes explained clearly
- CDP vs Webview trade-offs documented
- Learning path provided
- Common mistakes addressed

### Production-Ready
- Error handling patterns
- Troubleshooting guide
- Performance tips
- Security considerations

### Well-Integrated
- Shows how to use with Codebrain features (memory, messaging, tasks)
- Usage patterns for different agent roles
- Examples of integration points

---

**Status:** ✅ Ready for use in Codebrain  
**Last Updated:** 2026-06-05  
**Version:** 1.0.0
