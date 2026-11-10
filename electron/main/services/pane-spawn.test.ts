// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureClaudeSettings, paneMissionMetadata, paneSpawnBrief, spawnPaneInternal } from "./pane-spawn";
import { ensureClaudeWorkspaceSettings } from "./claude-metadata";
vi.mock("./claude-metadata", () => ({ ensureClaudeWorkspaceSettings: vi.fn() }));

vi.mock("../context", () => ({ safeSend: vi.fn() }));
vi.mock("electron-log/main.js", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../pty-manager", () => ({ resolveCommand: (agent: string, args: string[]) => ({ binary: agent === "shell" ? "C:\\Windows\\System32\\cmd.exe" : "kiro-cli.exe", args, fellBackToOpenClaude: false }) }));
vi.mock("./spawn/provider-resolver", () => ({ resolveProvider: (_ctx: unknown, input: any) => ({ agent: input.agent, model: input.model }) }));
vi.mock("./spawn/prompt-builder", () => ({ buildSystemPrompt: vi.fn() }));
vi.mock("./spawn/harness-spawn", () => ({ prepareGenericHarness: (_entry: unknown, input: any) => input.args }));
vi.mock("./accounts", () => ({ getAccount: () => undefined, accountEnv: () => ({}) }));
vi.mock("./catalog", () => ({ installedSkillNames: () => [] }));
vi.mock("./external-mcp", () => ({ readExternalMcpServers: () => ({}), externalMcpOverrides: () => [], mergeMcpFile: vi.fn() }));
vi.mock("./spawn/codebrain-adapter", () => ({
  prepareCodebrainAdapter: () => ({ codebrainContext: "PRIVATE_GENERATED_CONTEXT", codebrainCatalogPath: "private-catalog.json", warnings: [] }),
  attachCodebrainContext: vi.fn(), writeSharedCodebrainGuide: vi.fn(),
}));

let ctx: any;
beforeEach(() => {
  vi.clearAllMocks();
  ctx = {
    currentWorkspacePath: process.cwd(), paneConfigs: new Map(), paneRegistry: new Map(), providerHealth: new Map(),
    memoryStore: { createMission: vi.fn(() => ({ ok: true, id: "mission_fixture" })), actorRegister: vi.fn(() => ({ ok: true })) },
    configStore: { get: () => ({}) }, cliDetector: { getAllAsync: vi.fn().mockResolvedValue({}) },
    hooksManager: { runPreSpawnHooks: vi.fn().mockResolvedValue(undefined), fire: vi.fn() },
    ptyManager: { spawn: vi.fn().mockResolvedValue("fixture"), submitWhenReady: vi.fn().mockResolvedValue({ ok: false, promptSubmitted: false, waitedMs: 60_000, error: "Not ready" }) },
  };
});

describe("spawn orchestration offline", () => {
  it("delegates workspace metadata to the shared installed-app resolver", () => {
    ensureClaudeSettings("fixture-workspace");
    expect(ensureClaudeWorkspaceSettings).toHaveBeenCalledWith("fixture-workspace");
  });
  it("retains a failed task submission separately from the generated payload and lightweight list", async () => {
    const result = await spawnPaneInternal(ctx, { paneId: "fixture", agent: "kiro", cwd: process.cwd(), initialPrompt: "Inspect fixtures", env: { PRIVATE_TOKEN: "never-export" } });
    expect(result).toMatchObject({ ok: true, paneId: "fixture", promptSubmitted: false, promptError: "Not ready" });
    expect(ctx.ptyManager.submitWhenReady).toHaveBeenCalledTimes(1);
    expect(ctx.ptyManager.submitWhenReady.mock.calls[0][1]).toBe("PRIVATE_GENERATED_CONTEXT\n\nInspect fixtures");
    const brief = paneSpawnBrief(ctx, "fixture");
    expect(brief).toMatchObject({ prompt: "Inspect fixtures", delivery: { promptSubmitted: false, state: "not_submitted" } });
    expect(JSON.stringify(brief)).not.toMatch(/PRIVATE_GENERATED_CONTEXT|never-export/);
    expect(paneMissionMetadata(ctx, "fixture")).toMatchObject({ hasInitialPrompt: true, initialPromptId: "brief_fixture", promptSubmitted: false });
    expect(paneMissionMetadata(ctx, "fixture")).not.toHaveProperty("spawnBrief");
    expect(paneMissionMetadata(ctx, "fixture")).not.toHaveProperty("initialPrompt");
  });

  it("retains a deferred harness brief without submitting before its contract is installed", async () => {
    const result = await spawnPaneInternal(ctx, { paneId: "fixture", agent: "kiro", cwd: process.cwd(), spawnBrief: "Task saved before harness contract" });
    expect(ctx.ptyManager.submitWhenReady).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, promptSubmitted: false, hasInitialPrompt: true });
    expect(paneSpawnBrief(ctx, "fixture")).toMatchObject({ prompt: "Task saved before harness contract", delivery: { state: "pending", promptSubmitted: false } });
    expect(ctx.ptyManager.spawn.mock.calls[0][0].spawnBrief).toBe(ctx.paneConfigs.get("fixture").spawnBrief);
  });

  it("reports an opened pane truthfully when the initial transport throws", async () => {
    ctx.ptyManager.submitWhenReady.mockRejectedValue(new Error("native pipe failed"));
    const result = await spawnPaneInternal(ctx, { paneId: "fixture", agent: "kiro", cwd: process.cwd(), initialPrompt: "Inspect fixtures" });
    expect(result).toMatchObject({ ok: true, paneId: "fixture", promptSubmitted: false });
    expect(result.promptError).toBeTruthy();
    expect(paneSpawnBrief(ctx, "fixture")).toMatchObject({ delivery: { state: "uncertain", promptSubmitted: false } });
  });

  it("reports the actual cmd shell without changing its selection or exposing args/env", async () => {
    const result = await spawnPaneInternal(ctx, { paneId: "fixture", agent: "shell", cwd: process.cwd(), args: ["/q"] });
    expect(result).toMatchObject({ ok: true, shell: { kind: "cmd", commandSyntax: "cmd", executable: "C:\\Windows\\System32\\cmd.exe" } });
    expect(paneMissionMetadata(ctx, "fixture")).toMatchObject({ shell: { kind: "cmd" } });
    expect(ctx.ptyManager.spawn.mock.calls[0][1]).toMatchObject({ binary: "C:\\Windows\\System32\\cmd.exe", args: ["/q"] });
    expect(paneSpawnBrief(ctx, "fixture")).toBeUndefined();
  });

  it("requires a transport receipt, not just readiness ok, to report promptSubmitted", async () => {
    ctx.ptyManager.submitWhenReady.mockResolvedValueOnce({ ok: true, waitedMs: 800 });
    const unknown = await spawnPaneInternal(ctx, { paneId: "fixture", agent: "kiro", cwd: process.cwd(), initialPrompt: "Inspect fixtures" });
    expect(unknown).toMatchObject({ ok: true, promptSubmitted: false });
    expect(unknown.promptError).toContain("não foi confirmado");
    ctx.ptyManager.submitWhenReady.mockResolvedValueOnce({ ok: true, promptSubmitted: true, deliveryState: "submitted", waitedMs: 950 });
    const confirmed = await spawnPaneInternal(ctx, { paneId: "fixture2", agent: "kiro", cwd: process.cwd(), initialPrompt: "Inspect fixtures" });
    expect(confirmed).toMatchObject({ ok: true, promptSubmitted: true, promptDeliveryState: "submitted" });
    expect(paneSpawnBrief(ctx, "fixture2")).toMatchObject({ delivery: { promptSubmitted: true, state: "submitted" } });
  });
});
