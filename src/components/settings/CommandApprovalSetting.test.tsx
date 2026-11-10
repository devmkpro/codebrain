import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CommandApprovalSetting } from "./CommandApprovalSetting";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("shows always allow by default and persists revocation and re-enabling without replacing other settings", async () => {
  const set = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("codeBrainApp", { appConfig: { get: async () => ({}), set } });
  render(<CommandApprovalSetting />);
  const toggle = screen.getByRole("switch", { name: "Sempre permitir comandos dos agentes" });
  await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"));
  expect(set).toHaveBeenLastCalledWith({ agentCommandApproval: "ask" });
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
  expect(set).toHaveBeenLastCalledWith({ agentCommandApproval: "always" });
});
it("keeps the existing permission and explains a failed save", async () => {
  vi.stubGlobal("codeBrainApp", { appConfig: { get: async () => ({ agentCommandApproval: "ask" }), set: async () => { throw new Error(); } } });
  render(<CommandApprovalSetting />);
  const toggle = screen.getByRole("switch");
  await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(toggle);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(toggle.getAttribute("aria-checked")).toBe("false");
});
