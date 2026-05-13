# Codebrain — Squad Quick Start

> How to quickly launch a multi-agent squad to solve complex tasks.

---

## 1. Initial Prompt

Start by giving the high-level goal and explicitly asking to use the **Orchestrator**.

Example:
> "Act as an orchestrator. Read /docs and /prompts. Implement a new user registration flow with email verification."

## 2. Orchestrator Initialization

The orchestrator (Claude) will:
1.  Analyze the workspace.
2.  Set up the task list using `todo_manager`.
3.  **Spawn the 3 workers** using `pane_spawn`:
    *   **Backend** (Logic/API)
    *   **Frontend** (UI/Components)
    *   **UI Tester** (Browser Automation)

## 3. Delegation

The orchestrator will send detailed tasks to each worker via `pane_write`.

**Rule for prompts**: Always include context, naming conventions, and file paths.

Example worker prompt:
> "Implement the POST /api/register endpoint. Follow the pattern in controllers/UserController.ts. Ensure validation for unique email. Use the existing AuthService for hashing."

## 4. Collaboration

Workers communicate via `pane_send_message`.

*   **Backend** $\rightarrow$ **Frontend**: "Endpoint ready. Returns { ok: true }."
*   **Frontend** $\rightarrow$ **UI Tester**: "Registration page is live at localhost:3000/register."
*   **UI Tester** $\rightarrow$ **Orchestrator**: "Tests passed. No console errors."

## 5. Completion

1.  **UI Tester** runs final verification (console, network, UI).
2.  **Orchestrator** synthesizes results.
3.  Orchestrator marks all tasks as done and reports to you.

---

### Tips

*   **Watch the Grid**: You can see all agents working in real-time.
*   **Yellow Notifications**: These indicate inter-agent communication.
*   **Console/Network**: The UI Tester catches silent errors that a human might miss.
