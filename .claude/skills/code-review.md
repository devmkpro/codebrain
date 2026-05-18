---
name: code-review
description: Automated code review with bug detection, security analysis, and best practices
version: 1.0.0
triggers:
  - /review
  - code review
  - review code
  - check code
  - find bugs
tools:
  - file_read
  - file_list
  - file_search
  - memory_write
  - memory_search
  - pattern_write
  - pattern_list
  - pane_send_message
---

# Code Review Skill

Automated code review that finds bugs, security issues, performance problems, and ensures consistency with project conventions.

## Core Workflow

```
1. Read the code to review
2. Check against checklist (bugs, security, performance, style)
3. Document findings
4. Save patterns for future reviews
5. Report to orchestrator
```

## Review Checklist

### Bugs
- [ ] Null/undefined handling
- [ ] Error handling (try-catch)
- [ ] Edge cases (empty arrays, zero values, negative numbers)
- [ ] Race conditions (async/await)
- [ ] Memory leaks (event listeners, subscriptions)
- [ ] Type mismatches (TypeScript strict mode)

### Security
- [ ] No hardcoded secrets (API keys, passwords)
- [ ] Input validation (sanitization, type checking)
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS prevention (sanitize outputs)
- [ ] CSRF protection (tokens)
- [ ] Authentication/authorization checks

### Performance
- [ ] No unnecessary re-renders (React.memo, useMemo, useCallback)
- [ ] Efficient data structures (Map vs Object, Set vs Array)
- [ ] Lazy loading (dynamic imports)
- [ ] Database query optimization (indexes, JOINs)
- [ ] Caching (Redis, memoization)
- [ ] Bundle size (tree shaking, code splitting)

### TypeScript
- [ ] Strict mode enabled
- [ ] No `any` types
- [ ] Proper interface definitions
- [ ] Generic types used appropriately
- [ ] Union types for variants
- [ ] Discriminated unions for state

### React
- [ ] Functional components with hooks
- [ ] Proper dependency arrays in useEffect
- [ ] Cleanup in useEffect (return function)
- [ ] Key prop in lists
- [ ] Controlled vs uncontrolled inputs
- [ ] Error boundaries

### Naming
- [ ] Components: PascalCase (LoginForm, UserProfile)
- [ ] Functions: camelCase (getUserData, handleSubmit)
- [ ] Constants: UPPER_SNAKE_CASE (API_URL, MAX_RETRY)
- [ ] Files: kebab-case (login-form.tsx, user-profile.tsx)

## Example Review

```
## Task: Review src/components/auth/LoginForm.tsx

### Read
file_read(workspacePath, "src/components/auth/LoginForm.tsx")

### Findings

#### BUG: Missing error handling
Line 15: `const data = await res.json()` — no try-catch
Fix: Wrap in try-catch, handle network errors

#### BUG: No loading state reset on error
Line 20: `set({ error: err.message })` — missing `loading: false`
Fix: `set({ error: err.message, loading: false })`

#### SECURITY: No input validation
Line 8-9: Email and password used directly
Fix: Validate email format, check password length

#### PERFORMANCE: Unnecessary re-renders
Line 5: `const { login, loading, error } = useAuthStore()`
Fix: Use selectors: `const login = useAuthStore(s => s.login)`

#### TYPESCRIPT: Missing type for error
Line 18: `catch (err: any)`
Fix: `catch (err: unknown)` then check instanceof Error

### Positive
- Good use of Zustand for state
- Clean component structure
- Proper form handling with onSubmit

### Report
pane_send_message({
  from: YOUR_PANE_ID,
  to: orchestrator,
  content: "Review complete: 5 issues found (2 bugs, 1 security, 1 performance, 1 type)",
  type: "result"
})

memory_write(
  key="review-login-form",
  content="Found 5 issues: missing error handling, no loading reset, no input validation, unnecessary re-renders, any type",
  tags=["review","auth","bugs"]
)
```

## Pattern Building

```
pattern_write("code-review", `
  ## Code Review Pattern

  ### Context
  React + TypeScript + Zustand codebase

  ### Checklist
  1. Bugs: null handling, error handling, edge cases, race conditions
  2. Security: secrets, input validation, SQL injection, XSS
  3. Performance: re-renders, data structures, lazy loading
  4. TypeScript: strict mode, no any, proper interfaces
  5. React: hooks, useEffect cleanup, keys, error boundaries

  ### Report Format
  - List issues with line numbers
  - Explain why it's a problem
  - Suggest specific fix
  - Note positive aspects

  ### Quality: 0.95
`)
```
