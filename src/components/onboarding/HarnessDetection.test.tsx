import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HarnessDetection } from "./HarnessDetection";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("detects automatically on mount without a card click, including installed Kiro", async () => {
  const redetect = vi.fn().mockResolvedValue([]);
  const registry = vi.fn().mockResolvedValue([
    { id: "kiro", label: "Kiro CLI", version: "detected version", found: true, verified: true },
    { id: "experimental", label: "Experimental", found: true, verified: false },
    { id: "missing", label: "Missing", found: false, verified: true },
  ]);
  const installCli = vi.fn();
  vi.stubGlobal("codeBrainApp", { cli: { redetect, registry, installCli } });
  render(<HarnessDetection />);
  await screen.findByText("Kiro CLI");
  expect(redetect).toHaveBeenCalledTimes(1);
  expect(registry).toHaveBeenCalledTimes(1);
  expect(screen.getByText("2 de 3 detectados")).toBeTruthy();
  expect(screen.getByText("Experimental · experimental")).toBeTruthy();
  expect(installCli).not.toHaveBeenCalled();
});

it("refreshes on focus and shows probe errors with a retry", async () => {
  const registry = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockRejectedValueOnce(new Error("detector indisponível"))
    .mockResolvedValue([{ id: "kiro", label: "Kiro CLI", found: true, verified: true }]);
  vi.stubGlobal("codeBrainApp", { cli: { redetect: vi.fn().mockResolvedValue([]), registry } });
  render(<HarnessDetection />);
  await screen.findByText("0 de 0 detectados");
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "tentar novamente" }));
  await screen.findByText("Kiro CLI");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("removes the automatic focus subscription when the onboarding closes", async () => {
  const registry = vi.fn().mockResolvedValue([]);
  vi.stubGlobal("codeBrainApp", { cli: { registry } });
  const { unmount } = render(<HarnessDetection />);
  await waitFor(() => expect(registry).toHaveBeenCalledTimes(1));
  unmount();
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(registry).toHaveBeenCalledTimes(1);
});
