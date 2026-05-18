---
name: api-testing
description: REST API testing using browser automation and network monitoring
version: 1.0.0
triggers:
  - /api-test
  - test API
  - API testing
  - REST test
  - endpoint test
tools:
  - browser_navigate
  - browser_fill
  - browser_click
  - browser_console_log
  - browser_network_log
  - browser_screenshot
  - browser_wait_for_url
  - memory_write
  - memory_search
  - pattern_write
---

# API Testing Skill

REST API testing using browser automation and network monitoring. Teaches agents to verify API endpoints, check response formats, validate error handling, and document findings.

## Core Workflow

```
1. Navigate to application
2. Trigger API calls via UI interactions
3. Monitor network tab for API requests
4. Verify response status codes and payloads
5. Check console for errors
6. Document findings in memory
```

## Quick Reference

### Setup
```
browser_guide() → MANDATORY first step
browser_open(url) → open browser pane
browser_wait_for_load() → wait for page
```

### Trigger API Call
```
browser_fill("input[name='email']", "test@example.com")
browser_fill("input[name='password']", "testpass123")
browser_click("button[type='submit']")
browser_wait_for_url("**/dashboard")
```

### Verify API Response
```
browser_network_log() → all network requests
browser_network_log("/api/auth") → filter by URL
browser_network_log(undefined, "POST") → filter by method
browser_network_log(undefined, undefined, "200") → filter by status
```

### Check for Errors
```
browser_console_log("error") → JavaScript errors
browser_console_log("warn") → warnings
```

## Example: Login API Test

```
## Task: Test POST /api/auth/login

### Steps
1. browser_guide()
2. browser_open("http://localhost:3000/login")
3. browser_wait_for_load()
4. browser_fill("input[name='email']", "test@example.com")
5. browser_fill("input[name='password']", "testpass123")
6. browser_click("button[type='submit']")
7. browser_wait_for_url("**/dashboard")

### Verify
8. browser_network_log("/api/auth/login")
   - Expected: POST request, status 200
   - Expected response: { ok: true, user: { id, email, name } }

9. browser_console_log("error")
   - Expected: No errors

10. browser_screenshot()
    - Proof of successful login

### Report
11. memory_write(key="test-login-api", content="PASS: POST /api/auth/login returns 200 with user object", tags=["test","api","auth"])
12. pattern_write("api-testing", "Login API test: fill form → submit → verify network → check console → screenshot")
```

## Example: Error Handling Test

```
## Task: Test POST /api/auth/login with invalid credentials

### Steps
1. browser_guide()
2. browser_open("http://localhost:3000/login")
3. browser_fill("input[name='email']", "invalid@example.com")
4. browser_fill("input[name='password']", "wrongpassword")
5. browser_click("button[type='submit']")
6. browser_wait_for_text("Invalid credentials")

### Verify
7. browser_network_log("/api/auth/login")
   - Expected: POST request, status 401
   - Expected response: { ok: false, error: "Invalid credentials" }

8. browser_console_log("error")
   - Expected: No errors (error handled gracefully)

9. browser_screenshot()
    - Proof of error message displayed

### Report
10. memory_write(key="test-login-api-error", content="PASS: POST /api/auth/login returns 401 for invalid credentials", tags=["test","api","auth","error"])
```

## Network Log Filters

| Filter | Example | Description |
|--------|---------|-------------|
| URL | `/api/auth` | Filter by URL substring |
| Method | `POST` | Filter by HTTP method |
| Status | `200` | Filter by status code |
| Status range | `4xx` | Filter by status range |

## Pattern Building

After successful tests, save patterns:

```
pattern_write("api-testing", `
  ## API Testing Pattern

  ### Context
  REST API testing via browser automation

  ### Steps
  1. browser_guide() → mandatory
  2. browser_open(url) → open page
  3. browser_fill + browser_click → trigger API call
  4. browser_network_log(filter) → verify request/response
  5. browser_console_log("error") → check for errors
  6. browser_screenshot() → visual proof
  7. memory_write(key, content, tags) → document results

  ### Network Filters
  - URL: browser_network_log("/api/users")
  - Method: browser_network_log(undefined, "POST")
  - Status: browser_network_log(undefined, undefined, "200")

  ### Quality: 0.95
`)
```

## Tips

1. **Always call browser_guide() first** — mandatory before any browser tool
2. **Use network log filters** — don't parse all requests, filter by URL/method/status
3. **Check both success and error cases** — test happy path AND error handling
4. **Screenshot for proof** — visual evidence of test results
5. **Write to memory immediately** — other agents need to know test results
6. **Save patterns** — reuse successful test approaches
