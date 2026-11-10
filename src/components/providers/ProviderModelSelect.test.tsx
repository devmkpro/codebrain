import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderModelSelect } from "./ProviderModelSelect";

afterEach(cleanup);

describe("shared provider/model selector", () => {
  it.each([
    "claude",
    "codex",
    "openclaude",
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
  ])("%s lists newest versions first without moving the selected older model", (host) => {
    const models = ["m-5.9", "auto", "m-5.10"];
    render(
      <ProviderModelSelect
        providers={[{ id: host, label: host, host, models, modelsMode: "manual" }]}
        label="Modelo"
        value={{ providerId: host, model: "m-5.9" }}
        onChange={vi.fn()}
      />
    );
    const selector = screen.getAllByRole("combobox")[1] as HTMLSelectElement;
    expect([...selector.options].map((option) => option.value)).toEqual([
      "m-5.10",
      "m-5.9",
      "auto",
    ]);
    expect(selector.value).toBe("m-5.9");
    expect(models).toEqual(["m-5.9", "auto", "m-5.10"]);
  });
  it("uses API dates for model IDs that do not encode a version", () => {
    render(
      <ProviderModelSelect
        providers={[
          {
            id: "api",
            label: "API",
            models: ["older", "newer"],
            modelsMetadata: [
              { id: "older", created: 1700000000 },
              { id: "newer", release: "2026-11-09" },
            ],
          },
        ]}
        label="Modelo"
        value={{ providerId: "api", model: "older" }}
        onChange={vi.fn()}
      />
    );
    const selector = screen.getAllByRole("combobox")[1] as HTMLSelectElement;
    expect([...selector.options].map((option) => option.value)).toEqual(["newer", "older"]);
  });
});
