# test

Run tests for the Codebrain application.

## Usage
```
/test [options]
```

## Options
- `--unit` — Run unit tests only
- `--integration` — Run integration tests only
- `--watch` — Watch mode (re-run on changes)
- `--coverage` — Generate coverage report

## Examples
```
/test
/test --unit
/test --integration --coverage
/test --watch
```

## What It Does

```
npm run test
# Runs Vitest test suite
```

## Test Structure

```
src/
  __tests__/
    components/        # Component tests
    stores/            # Store tests
    utils/             # Utility tests
packages/
  mcp/
    __tests__/         # MCP tool tests
  memory/
    __tests__/         # Memory store tests
```

## Writing Tests

### Component Test
```tsx
// src/__tests__/components/LoginForm.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import LoginForm from "../../components/auth/LoginForm";

describe("LoginForm", () => {
  it("renders email and password inputs", () => {
    render(<LoginForm />);
    expect(screen.getByPlaceholderText("Email")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Password")).toBeInTheDocument();
  });

  it("calls login on submit", async () => {
    const login = vi.fn();
    render(<LoginForm />);
    fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "test@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "pass123" } });
    fireEvent.click(screen.getByText("Login"));
    expect(login).toHaveBeenCalledWith({ email: "test@example.com", password: "pass123" });
  });
});
```

### Store Test
```tsx
// src/__tests__/stores/auth-store.test.tsx
import { useAuthStore } from "../../stores/auth-store";

describe("auth-store", () => {
  it("sets user on successful login", async () => {
    const { login } = useAuthStore.getState();
    await login({ email: "test@example.com", password: "pass123" });
    expect(useAuthStore.getState().user).toBeTruthy();
  });
});
```

## See Also
- `/build` — Build application
- `/lint` — Run linter
