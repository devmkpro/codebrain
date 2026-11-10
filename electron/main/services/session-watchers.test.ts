// @vitest-environment node
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../context", () => ({ safeSend: vi.fn() }));
vi.mock("electron-log/main.js", () => ({ default: { info: vi.fn(), warn: vi.fn() } }));
import { CodexSessionWatcher } from "./session-watchers";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

it("binds parallel Codex conversations by developer pane identity rather than newest file", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-codex-id-")); dirs.push(root);
  const captured = vi.fn();
  const watcher = new CodexSessionWatcher(captured, root);
  const time = Date.now();
  for (const paneId of ["pane-a", "pane-b"]) {
    fs.writeFileSync(path.join(root, `${paneId}.jsonl`), [
      JSON.stringify({ type: "session_meta", payload: { id: `session-${paneId}`, cwd: root, timestamp: new Date(time).toISOString() } }),
      JSON.stringify({ type: "response_item", payload: { role: "developer", content: [{ text: `## Workspace\nPane: \`${paneId}\`` }] } }),
    ].join("\n"));
    (watcher as any).panes.set(paneId, { paneId, agent: "codex", cwd: root, spawnedAt: time });
  }
  await (watcher as any).scanOnce();
  expect(captured.mock.calls.map(([value]) => [value.paneId, value.session.id]).sort()).toEqual([
    ["pane-a", "session-pane-a"], ["pane-b", "session-pane-b"],
  ]);
});
it("refuses ambiguous timing matches and ignores pane IDs quoted in user messages", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-codex-ambiguous-")); dirs.push(root);
  const captured = vi.fn(); const watcher = new CodexSessionWatcher(captured, root); const time = Date.now();
  fs.writeFileSync(path.join(root, "session.jsonl"), [
    JSON.stringify({ type: "session_meta", payload: { id: "session", cwd: root, timestamp: new Date(time).toISOString() } }),
    JSON.stringify({ type: "response_item", payload: { role: "user", content: [{ text: "Pane: `pane-a`" }] } }),
  ].join("\n"));
  for (const paneId of ["pane-a", "pane-b"]) (watcher as any).panes.set(paneId, { paneId, agent: "codex", cwd: root, spawnedAt: time });
  await (watcher as any).scanOnce(); expect(captured).not.toHaveBeenCalled();
});
