import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderList } from "./ProviderList";

afterEach(cleanup);

describe("ProviderList", () => {
  it("allows editing native and endpoint providers but only deletes endpoints", () => {
    const onEdit = vi.fn();
    render(
      <ProviderList
        providers={[
          { id: "codex-oauth", label: "Codex", type: "codex", isVirtual: true, models: ["gpt-5.6-sol"] },
          { id: "openrouter-user", label: "OpenRouter", type: "openai-compat", models: ["openai/gpt-5.6-sol"] },
        ]}
        onAdd={vi.fn()}
        onEdit={onEdit}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Editar Codex" }));
    fireEvent.click(screen.getByRole("button", { name: "Editar OpenRouter" }));

    expect(onEdit).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Remover Codex" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remover OpenRouter" })).toBeTruthy();
  });
});
