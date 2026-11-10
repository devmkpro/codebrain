// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createCliModelCatalog,
  MODEL_CATALOG_TTL_MS,
  parseModelCatalog,
} from "./cli-model-catalog";

describe("CLI model discovery", () => {
  it("Codex reads the installed dynamic catalog and hides hidden models", async () => {
    const run = vi.fn(async (_binary, args) =>
      args.join(" ") === "debug --help"
        ? "  models   Render catalog"
        : JSON.stringify({
            models: [
              { slug: "gpt-5.9" },
              { slug: "gpt-5.10" },
              { slug: "internal", visibility: "hide" },
            ],
          })
    );
    const result = await createCliModelCatalog({ run, cacheFile: null }).refresh(
      "codex",
      "codex.exe"
    );
    expect(result).toMatchObject({
      models: ["gpt-5.10", "gpt-5.9"],
      source: "codex-debug-models",
      stale: false,
    });
    expect(run.mock.calls.map((call) => call[1])).toEqual([
      ["debug", "--help"],
      ["debug", "models"],
    ]);
  });
  it.each([
    [
      "kiro",
      "--list-models",
      ["chat", "--list-models", "--format", "json"],
      '{"models":[{"model_id":"claude-5.10"}]}',
    ],
    ["cursor", "--list-models", ["--list-models"], "gpt-5.10 - GPT new\ngpt-5.9 - GPT old"],
    [
      "opencode",
      "opencode models [provider]  List available models",
      ["models", "--refresh"],
      "openai/gpt-5.9\nopenai/gpt-5.10",
    ],
    ["grok", "  models  List available models", ["models"], "grok-4.9\ngrok-4.10"],
  ])("%s executes only its advertised listing command", async (cli, help, command, output) => {
    const run = vi.fn(async (_binary, args) =>
      args.includes("--help") ? (args[0] === "models" ? "--refresh" : help) : output
    );
    const result = await createCliModelCatalog({ run, cacheFile: null }).refresh(cli, "binary");
    expect(result.stale).toBe(false);
    expect(run).toHaveBeenLastCalledWith("binary", command);
    expect(result.models[0]).toContain("10");
  });
  it("Claude discovers rolling aliases from help without reading OAuth credentials", async () => {
    const run = vi.fn(
      async () => " --model <model>  alias (e.g. 'fable', 'opus', or 'sonnet')\n --tools <tools>"
    );
    expect(
      (await createCliModelCatalog({ run, cacheFile: null }).refresh("claude", "claude")).models
    ).toEqual(["fable", "opus", "sonnet"]);
    expect(run).toHaveBeenCalledOnce();
  });
  it("Copilot uses installed --model choices when advertised", async () => {
    const run = vi.fn(async () => '--model <id> (choices: "gpt-5.9", "gpt-5.10")');
    expect(
      (await createCliModelCatalog({ run, cacheFile: null }).refresh("copilot", "copilot")).models
    ).toEqual(["gpt-5.10", "gpt-5.9"]);
  });
  it.each(["gemini", "kimi", "hermes", "muse", "commandcode", "antigravity"])(
    "%s can discover models when its installed help explicitly advertises --list-models",
    async (cli) => {
      const run = vi.fn(async (_binary, args) =>
        args.includes("--help") ? "--list-models  List available models and exit" : "m-5.9\nm-5.10"
      );
      const result = await createCliModelCatalog({ run, cacheFile: null }).refresh(cli, "binary");
      expect(result).toMatchObject({ models: ["m-5.10", "m-5.9"], stale: false });
      expect(run).toHaveBeenLastCalledWith("binary", ["--list-models"]);
    }
  );
  it.each(["gemini", "kimi", "hermes", "muse", "commandcode", "antigravity", "openclaude"])(
    "%s without a documented listing returns an honest unavailable result",
    async (cli) => {
      const run = vi.fn(async () => "--model <name> Select a model\nlogin Sign in");
      const result = await createCliModelCatalog({ run, cacheFile: null }).refresh(cli, "binary");
      expect(result).toMatchObject({ models: [], stale: true, source: "unavailable" });
      expect(result.error).toContain("não tem listagem");
      expect(run).toHaveBeenCalledOnce();
    }
  );
  it("deduplicates in-flight work, applies TTL and preserves stale data with failure backoff", async () => {
    let time = 100_000;
    let fails = false;
    const run = vi.fn(async (_binary, args) => {
      if (fails) throw new Error("never expose provider stderr or secret");
      return args.includes("--help") ? "--list-models" : "gpt-5.10";
    });
    const api = createCliModelCatalog({ run, now: () => time, cacheFile: null });
    await Promise.all([api.refresh("cursor", "cursor"), api.refresh("cursor", "cursor")]);
    expect(run).toHaveBeenCalledTimes(2);
    await api.refresh("cursor", "cursor");
    expect(run).toHaveBeenCalledTimes(2);
    time += MODEL_CATALOG_TTL_MS + 1;
    fails = true;
    const stale = await api.refresh("cursor", "cursor");
    expect(stale).toMatchObject({ models: ["gpt-5.10"], stale: true, fetchedAt: 100_000 });
    expect(stale.error).not.toContain("secret");
    await api.refresh("cursor", "cursor");
    expect(run).toHaveBeenCalledTimes(3);
  });
  it("persists cache across service recreation without persisting raw process output", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-model-catalog-"));
    try {
      const cacheFile = path.join(dir, "cache.json");
      const run = vi.fn(async (_binary, args) =>
        args.includes("--help") ? "--list-models" : "gpt-5.10"
      );
      await createCliModelCatalog({ run, cacheFile }).refresh("cursor", "cursor");
      const freshRun = vi.fn();
      expect(
        (await createCliModelCatalog({ run: freshRun, cacheFile }).refresh("cursor", "cursor"))
          .models
      ).toEqual(["gpt-5.10"]);
      expect(freshRun).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("parses timestamps from the CLI catalog", () => {
    expect(
      parseModelCatalog(
        '{"models":[{"id":"a","created":1700000000},{"id":"b","created":1800000000}]}',
        "codex"
      ).models
    ).toEqual(["b", "a"]);
  });
});
