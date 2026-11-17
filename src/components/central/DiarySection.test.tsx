import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitDigest, GitDigestConfig } from "../../types/git-digest";
import { DiarySection } from "./DiarySection";
import { layoutNeuralMap } from "./NeuralMap";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const status = { encryption: { available: true }, running: null, lastError: null, lastRunAt: null };
const baseConfig = (connections: GitDigestConfig["connections"] = []): GitDigestConfig => ({
  version: 1,
  connections,
  summarizer: { providerId: "cli:claude", model: "claude-sonnet" },
  schedule: { enabled: true, time: "18:00", catchUpDays: 3 },
  includeDiffs: false,
});

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const digest = (): GitDigest => ({
  date: today(),
  generatedAt: new Date().toISOString(),
  stats: { commits: 1, projects: 1, files: 1, additions: 3, deletions: 1 },
  projects: [{ key: "c:7", connectionId: "c", connectionLabel: "GL", path: "grupo/app", name: "app", webUrl: "",
    commits: [{ sha: "a".repeat(40), shortSha: "aaaaaaaa", title: "feat: mapa", message: "", authorName: "Ana", committedAt: "", webUrl: "", refs: ["main"], additions: 3, deletions: 1, files: [{ path: "src/map.ts", status: "modified", additions: 3, deletions: 1 }] }] }],
  summary: { headline: "Mapa neural no ar", text: "Fez o mapa.", providerId: "cli:claude", model: "claude-sonnet" },
  themes: [{ id: "c:7#m0", projectKey: "c:7", title: "Mapa", detail: "Desenho do mapa", commits: ["aaaaaaaa"], files: ["src/map.ts"] }],
  map: {
    nodes: [
      { id: "day", kind: "day", label: today(), weight: 1, parent: null },
      { id: "p:c:7", kind: "project", label: "app", weight: 1, parent: "day", projectKey: "c:7", commits: ["aaaaaaaa"] },
      { id: "t:c:7#m0", kind: "theme", label: "Mapa", weight: 1, parent: "p:c:7", projectKey: "c:7", detail: "Desenho do mapa", commits: ["aaaaaaaa"] },
      { id: "f:c:7::src/map.ts", kind: "file", label: "map.ts", weight: 4, parent: "t:c:7#m0", projectKey: "c:7", detail: "src/map.ts" },
    ],
    edges: [
      { from: "day", to: "p:c:7", kind: "tree" },
      { from: "p:c:7", to: "t:c:7#m0", kind: "tree" },
      { from: "t:c:7#m0", to: "f:c:7::src/map.ts", kind: "tree" },
    ],
  },
  warnings: [],
});

function stub(config: GitDigestConfig, day: GitDigest | null) {
  const bridge = {
    getConfig: vi.fn().mockResolvedValue({ ok: true, config, status }),
    list: vi.fn().mockResolvedValue({ ok: true, items: day ? [{ date: day.date, generatedAt: day.generatedAt, commits: 1, projects: 1, headline: day.summary.headline }] : [] }),
    get: vi.fn().mockResolvedValue({ ok: true, digest: day }),
    providers: vi.fn().mockResolvedValue({ ok: true, providers: [{ id: "cli:claude", label: "Claude · login existente", models: ["claude-sonnet", "claude-opus"], transport: "cli" }] }),
    upsertConnection: vi.fn(),
    saveSettings: vi.fn().mockImplementation(async (args) => ({ ok: true, config: { ...config, ...args } })),
    generate: vi.fn(),
    onUpdated: vi.fn().mockReturnValue(() => undefined),
  };
  vi.stubGlobal("codeBrainApp", { gitDigest: bridge });
  return bridge;
}

describe("DiarySection", () => {
  it("sem conexão abre o formulário com token mascarado e salva harness e modelo padrão", async () => {
    const bridge = stub(baseConfig(), null);
    render(<DiarySection />);
    const token = await screen.findByLabelText("Personal access token");
    expect(token.getAttribute("type")).toBe("password");
    await waitFor(() => expect(screen.getByLabelText("Modelo")).toBeTruthy());
    await waitFor(() => expect((screen.getByLabelText("Modelo") as HTMLSelectElement).tagName).toBe("SELECT"));
    fireEvent.change(screen.getByLabelText("Modelo"), { target: { value: "claude-opus" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar preferências" }));
    await waitFor(() => expect(bridge.saveSettings).toHaveBeenCalled());
    expect(bridge.saveSettings.mock.calls[0][0].summarizer).toEqual({ providerId: "cli:claude", model: "claude-opus" });
  });

  it("desenha o mapa do dia e mostra os commits ao escolher um arquivo", async () => {
    stub(baseConfig([{ id: "conn-1", label: "GL", baseUrl: "https://gitlab.com", enabled: true, scope: "all", projects: [], authorEmails: [], hasToken: true }]), digest());
    render(<DiarySection />);
    expect(await screen.findByText("Mapa neural no ar", undefined, { timeout: 5000 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Arquivo src/map.ts" }));
    expect(await screen.findByText("feat: mapa", undefined, { timeout: 5000 })).toBeTruthy();
  });
});

describe("layoutNeuralMap", () => {
  it("põe cada nível no seu anel", () => {
    const placed = layoutNeuralMap(digest().map.nodes);
    const distance = (id: string) => Math.round(Math.hypot(placed.get(id)!.x, placed.get(id)!.y));
    expect(distance("day")).toBe(0);
    expect(distance("p:c:7")).toBe(180);
    expect(distance("t:c:7#m0")).toBe(360);
    expect(distance("f:c:7::src/map.ts")).toBe(480);
  });

  it("dá a projeto pequeno uma fatia mínima do círculo", () => {
    const nodes: GitDigest["map"]["nodes"] = [
      { id: "day", kind: "day", label: "d", weight: 1, parent: null },
      { id: "p:big", kind: "project", label: "big", weight: 1, parent: "day" },
      { id: "p:small", kind: "project", label: "small", weight: 1, parent: "day" },
      ...Array.from({ length: 30 }, (_, index) => ({ id: `f:${index}`, kind: "file" as const, label: `${index}`, weight: 1, parent: "p:big" })),
      { id: "f:s", kind: "file", label: "s", weight: 1, parent: "p:small" },
    ];
    const placed = layoutNeuralMap(nodes);
    const gap = Math.abs(placed.get("p:big")!.angle - placed.get("p:small")!.angle);
    // Proporcional puro daria ~3% da volta ao pequeno; com a metade igual, os dois ficam bem separados.
    expect(gap).toBeGreaterThan(Math.PI * 0.9);
  });
});
