import { describe, expect, it } from "vitest";
import { ensureWorkspaceUnlinked } from "./workspace-unlink";

describe("ensureWorkspaceUnlinked", () => {
  it("accepts a successful response", () => {
    expect(() => ensureWorkspaceUnlinked({ ok: true })).not.toThrow();
  });

  it("keeps an IPC error actionable", () => {
    expect(() => ensureWorkspaceUnlinked({ ok: false, error: "Sem permissao" })).toThrow("Sem permissao");
  });

  it("handles a missing IPC response without reading ok", () => {
    expect(() => ensureWorkspaceUnlinked(undefined)).toThrow("Reinicie o Codebrain");
  });
});
