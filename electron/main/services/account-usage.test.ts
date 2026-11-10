// @vitest-environment node

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aggregateClaudeUsage,
  buildClaudeWindows,
  collectClaudeUsage,
  parseClaudeUsageLine,
  parseCodexRateLimits,
  parseOauthUsage,
  readCodexRateLimits,
} from "./account-usage";

const NOW = Date.parse("2026-11-09T12:00:00.000Z");
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

const claudeLine = (overrides: Record<string, unknown> = {}, usage: Record<string, number> = {}) =>
  JSON.stringify({
    type: "assistant",
    requestId: "req_1",
    timestamp: hoursAgo(1),
    message: {
      id: "msg_1",
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_creation_input_tokens: 30,
        cache_read_input_tokens: 9999,
        ...usage,
      },
    },
    ...overrides,
  });

describe("parseClaudeUsageLine", () => {
  it("soma entrada, saída e escrita de cache, sem leitura de cache", () => {
    expect(parseClaudeUsageLine(claudeLine())).toMatchObject({ key: "msg_1:req_1", tokens: 60 });
  });

  it("ignora linha sem consumo, JSON quebrado e sem timestamp", () => {
    expect(parseClaudeUsageLine('{"type":"user"}')).toBeNull();
    expect(parseClaudeUsageLine('{"usage": ')).toBeNull();
    expect(parseClaudeUsageLine(claudeLine({ timestamp: undefined }))).toBeNull();
  });
});

describe("aggregateClaudeUsage", () => {
  it("usa o snapshot final maior e descarta consumo futuro", () => {
    const at = NOW - 1000;
    expect(
      aggregateClaudeUsage(
        [
          { key: "a", at, tokens: 1 },
          { key: "a", at, tokens: 10 },
          { key: "b", at: NOW + 1000, tokens: 999 },
        ],
        NOW
      )
    ).toEqual({ "5h": 10, "7d": 10 });
  });
  it("conta a mesma resposta uma vez e separa as janelas", () => {
    const entries = [
      { key: "a", at: NOW - 3_600_000, tokens: 100 },
      { key: "a", at: NOW - 3_600_000, tokens: 100 },
      { key: "b", at: NOW - 6 * 3_600_000, tokens: 50 },
      { key: "c", at: NOW - 8 * 24 * 3_600_000, tokens: 999 },
    ];
    expect(aggregateClaudeUsage(entries, NOW)).toEqual({ "5h": 100, "7d": 150 });
  });
});

describe("parseOauthUsage", () => {
  it("lê as duas janelas e limita o percentual", () => {
    const parsed = parseOauthUsage({
      five_hour: { utilization: 130, resets_at: "2026-11-09T15:00:00.000Z" },
      seven_day: { utilization: 12.5, resets_at: null },
    });
    expect(parsed["5h"]).toEqual({
      usedPct: 100,
      resetsAt: Date.parse("2026-11-09T15:00:00.000Z"),
    });
    expect(parsed["7d"]).toEqual({ usedPct: 12.5, resetsAt: null });
  });

  it("devolve vazio para resposta sem os campos", () => {
    expect(parseOauthUsage({})).toEqual({});
  });
});

describe("buildClaudeWindows", () => {
  it("marca estimado quando não há percentual", () => {
    const [fiveHour] = buildClaudeWindows({ "5h": 5, "7d": 7 }, null);
    expect(fiveHour).toMatchObject({ id: "5h", tokens: 5, usedPct: null, source: "estimado" });
  });
});

const codexEvent = (limits: unknown, timestamp = hoursAgo(1)) =>
  JSON.stringify({
    timestamp,
    type: "event_msg",
    payload: { type: "token_count", rate_limits: limits },
  });

const FUTURE_SECONDS = Math.floor((NOW + 3_600_000) / 1000);

describe("parseCodexRateLimits", () => {
  it("usa o último evento com limites", () => {
    const text = [
      codexEvent({ primary: { used_percent: 10, window_minutes: 300, resets_at: FUTURE_SECONDS } }),
      codexEvent({ primary: { used_percent: 40, window_minutes: 300, resets_at: FUTURE_SECONDS } }),
      codexEvent(null),
    ].join("\n");
    expect(parseCodexRateLimits(text, NOW)?.[0]).toMatchObject({
      id: "5h",
      usedPct: 40,
      source: "medido",
    });
  });

  it("classifica pela duração: primary semanal não é a janela de 5 horas", () => {
    const windows = parseCodexRateLimits(
      codexEvent({
        primary: { used_percent: 19, window_minutes: 10080, resets_at: FUTURE_SECONDS },
        secondary: null,
      }),
      NOW
    );
    expect(windows).toHaveLength(1);
    expect(windows?.[0]).toMatchObject({ id: "7d", usedPct: 19, resetsAt: FUTURE_SECONDS * 1000 });
  });

  it("zera a janela que já virou", () => {
    const past = Math.floor((NOW - 1000) / 1000);
    const windows = parseCodexRateLimits(
      codexEvent({ primary: { used_percent: 90, window_minutes: 300, resets_at: past } }),
      NOW
    );
    expect(windows?.[0]).toMatchObject({ usedPct: 0, resetsAt: null, source: "estimado" });
  });

  it("tolera trecho que começa no meio de uma linha", () => {
    expect(parseCodexRateLimits('"token_count","rate_limits":{}}', NOW)).toBeNull();
  });
});

describe("leitura em disco", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-usage-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeTranscript(lines: string[]) {
    const project = path.join(dir, "projects", "p1");
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, "s.jsonl"), lines.join("\n"));
  }

  it("devolve tokens com percentual nulo quando o endpoint falha", async () => {
    fs.writeFileSync(
      path.join(dir, ".credentials.json"),
      JSON.stringify({ claudeAiOauth: { accessToken: "t" } })
    );
    writeTranscript([claudeLine({ timestamp: new Date().toISOString() })]);
    const fetchFn = vi.fn().mockRejectedValue(new Error("rede"));
    const windows = await collectClaudeUsage(dir, { fetchFn: fetchFn as unknown as typeof fetch });
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(windows[0]).toMatchObject({ tokens: 60, usedPct: null, source: "estimado" });
  });

  it("usa o percentual medido e envia o token só no cabeçalho", async () => {
    fs.writeFileSync(
      path.join(dir, ".credentials.json"),
      JSON.stringify({ claudeAiOauth: { accessToken: "segredo" } })
    );
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ five_hour: { utilization: 33, resets_at: null } }),
    });
    const windows = await collectClaudeUsage(dir, { fetchFn: fetchFn as unknown as typeof fetch });
    expect(fetchFn.mock.calls[0][1].headers).toMatchObject({
      Authorization: "Bearer segredo",
      "anthropic-beta": "oauth-2025-04-20",
    });
    expect(windows[0]).toMatchObject({ usedPct: 33, source: "medido" });
  });

  it("não chama o endpoint sem credencial", async () => {
    const fetchFn = vi.fn();
    await collectClaudeUsage(dir, { fetchFn: fetchFn as unknown as typeof fetch });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("acha os limites na sessão mais nova do Codex", async () => {
    const day = path.join(dir, "sessions", "2026", "11", "09");
    fs.mkdirSync(day, { recursive: true });
    fs.writeFileSync(
      path.join(day, "a.jsonl"),
      codexEvent({ primary: { used_percent: 55, window_minutes: 300, resets_at: FUTURE_SECONDS } })
    );
    expect((await readCodexRateLimits(dir, NOW))[0]).toMatchObject({ usedPct: 55 });
  });

  it("devolve vazio sem pasta de sessões", async () => {
    expect(await readCodexRateLimits(dir, NOW)).toEqual([]);
  });
});
