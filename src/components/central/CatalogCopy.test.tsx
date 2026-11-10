import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogSection } from "./CatalogSection";
import { catalogCopyModeMessage } from "./logic";
import type { CatalogItem } from "./types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ids = [
  "openclaude",
  "claude",
  "codex",
  "gemini",
  "kimi",
  "cursor",
  "copilot",
  "kiro",
  "opencode",
  "grok",
  "antigravity",
  "hermes",
  "muse",
  "commandcode",
];

function setup(kind: CatalogItem["kind"], mode?: string, copied = ["destination/SKILL.md"]) {
  const copyTo = vi.fn().mockResolvedValue({ ok: true, copied, mode });
  const accounts = vi.fn();
  vi.stubGlobal("codeBrainApp", {
    cli: {
      registry: vi.fn().mockResolvedValue(
        ids.map((id) => ({
          id,
          label: id,
          found: false,
          verified: false,
          capabilities: { skills: id === "claude", multiAccount: false },
        }))
      ),
    },
    accounts: { list: accounts },
    agentCatalog: {
      copyTo,
      scan: vi.fn().mockResolvedValue({
        ok: true,
        items: [
          { kind, name: "reviewer", installedIn: [{ cli: "bundled", path: "resources/reviewer" }] },
        ],
      }),
    },
  });
  render(<CatalogSection workspace="D:/project" />);
  return { copyTo, accounts };
}

async function targetSelect() {
  const select = await screen.findByLabelText("Copiar para outro harness ou Codebrain");
  await waitFor(() => expect(select.querySelectorAll("option")).toHaveLength(15));
  return select as HTMLSelectElement;
}

describe("cópia portável do catálogo", () => {
  it("oferece registry14 e host para agentes sem consultar contas ou exigir capacidades", async () => {
    const { copyTo, accounts } = setup("agent", "codebrain-files");
    const select = await targetSelect();
    expect(Array.from(select.options, (option) => option.value)).toEqual(["codebrain", ...ids]);
    fireEvent.change(select, { target: { value: "kiro" } });
    expect(screen.getByText(/Compatibilidade por arquivos Codebrain disponível/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "copiar" }));
    await screen.findByText(/codebrain-files: arquivos portáveis/);
    expect(copyTo).toHaveBeenCalledWith({
      name: "reviewer",
      kind: "agent",
      cli: "kiro",
      workspace: "D:/project",
    });
    expect(accounts).not.toHaveBeenCalled();
  });

  it.each([
    ["skill", "native-skill", /native-skill: skill no formato nativo/],
    ["agent", "skill-persona", /skill-persona: agente adaptado como skill, não como agente nativo/],
  ] as const)("mostra o modo real %s/%s", async (kind, mode, message) => {
    const { copyTo } = setup(kind, mode);
    fireEvent.change(await targetSelect(), { target: { value: "claude" } });
    fireEvent.click(screen.getByRole("button", { name: "copiar" }));
    await screen.findByText(message);
    expect(copyTo).toHaveBeenCalledWith(expect.objectContaining({ kind, cli: "claude" }));
  });

  it("envia Codebrain como host e não declara cópia nova quando o backend preservou existentes", async () => {
    const { copyTo } = setup("agent", "codebrain-files", []);
    const select = await targetSelect();
    expect(select.value).toBe("codebrain");
    expect(screen.getByRole("option", { name: "Codebrain (host)" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "copiar" }));
    await screen.findByText(/Nenhum arquivo novo em codebrain; arquivos existentes preservados/);
    expect(copyTo).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "agent", cli: "codebrain" })
    );
    expect(screen.queryByText(/Copiado para codebrain/)).toBeNull();
  });

  it("não inventa suporte nativo quando o modo está ausente ou desconhecido", () => {
    for (const mode of [undefined, null, "future-mode"]) {
      expect(catalogCopyModeMessage(mode)).toMatch(/instalação nativa não confirmada/);
    }
  });
});
