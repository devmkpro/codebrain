# browser-test

Automated UI testing using browser automation.

## Usage
```
/browser-test <url> [options]
```

## Options
- `<url>` — URL to test (e.g., http://localhost:3000)
- `--flow <name>` — Test flow to run (login, form, navigation, all)
- `--screenshot` — Capture screenshots at each step

## Examples
```
/browser-test http://localhost:3000
/browser-test http://localhost:3000/login --flow login
/browser-test http://localhost:3000 --flow form --screenshot
```

## What It Does

1. **Opens browser** — creates a new browser pane
2. **Navigates to URL** — loads the page
3. **Reads accessibility tree** — understands page structure
4. **Runs test flow** — performs user actions
5. **Checks console** — looks for JavaScript errors
6. **Checks network** — verifies API calls
7. **Takes screenshots** — visual proof
8. **Reports results** — PASS/FAIL with evidence

## MCP Tools Used

```
mcp__codebrain__browser_guide() → MANDATORY first step
mcp__codebrain__browser_open(url) → open browser pane
mcp__codebrain__browser_wait_for_load() → wait for page
mcp__codebrain__browser_get_accessibility_tree() → understand structure
mcp__codebrain__browser_find_by_text(text, role) → find elements
mcp__codebrain__browser_click(selector) → interact
mcp__codebrain__browser_fill(selector, value) → fill forms
mcp__codebrain__browser_wait_for_url(pattern) → wait for navigation
mcp__codebrain__browser_console_log("error") → check errors
mcp__codebrain__browser_network_log() → check API calls
mcp__codebrain__browser_screenshot() → visual proof
```

## Test Flows

### Login Flow
```
1. Navigate to /login
2. Find email input
3. Fill email: test@example.com
4. Find password input
5. Fill password: testpass123
6. Find submit button
7. Click submit
8. Wait for redirect to /dashboard
9. Check console for errors
10. Check network for /api/auth/login call
11. Screenshot
```

### Form Flow
```
1. Navigate to form page
2. Find all form inputs
3. Fill each input with test data
4. Find submit button
5. Click submit
6. Wait for success message
7. Check console for errors
8. Check network for API call
9. Screenshot
```

### Navigation Flow
```
1. Navigate to home page
2. Find all navigation links
3. Click each link
4. Verify URL changes
5. Verify page content loads
6. Check for 404s in network tab
7. Screenshot each page
```

## Example Output

```
## Browser Test Results

### URL: http://localhost:3000/login
### Flow: login

### Steps
1. ✅ Navigate to /login
2. ✅ Find email input (input[name='email'])
3. ✅ Fill email: test@example.com
4. ✅ Find password input (input[name='password'])
5. ✅ Fill password: testpass123
6. ✅ Find submit button (button[type='submit'])
7. ✅ Click submit
8. ✅ Wait for redirect to /dashboard
9. ✅ Check console: No errors
10. ✅ Check network: POST /api/auth/login → 200 OK
11. ✅ Screenshot saved

### Result: PASS
```

## See Also
- `/browser-inspect` — Inspect specific elements
- `/browser-screenshot` — Capture screenshots
