import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarketplaceSection } from "./MarketplaceSection";

const online = { id: "anthropic:pdf", name: "PDF", description: "Read PDF documents", source: "Anthropic", sourceId: "anthropic", sourceUrl: "https://github.com/anthropics/skills/tree/main/skills/pdf", installed: false };
const local = { id: "local:claude:local", name: "Local custom", description: "Private skill", source: ".claude/skills", scope: "claude", installed: true };
const sources = [{ id: "anthropic", name: "Anthropic", url: "https://github.com/anthropics/skills", status: "online" }];

describe("MarketplaceSection", () => {
  let registryIndex: ReturnType<typeof vi.fn>;
  let installFromRegistry: ReturnType<typeof vi.fn>;
  let uninstallSkill: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    registryIndex = vi.fn().mockResolvedValue({ ok: true, index: { skills: [online] }, installed: [local], sources });
    installFromRegistry = vi.fn().mockResolvedValue({ ok: true });
    uninstallSkill = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("codeBrainApp", { skill: { registryIndex, installFromRegistry, uninstallSkill } });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("opens online discovery and separates the installed inventory", async () => {
    render(<MarketplaceSection />);
    expect(await screen.findByRole("button", { name: "Descobrir (1)" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "PDF" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Local custom" })).toBeNull();
    expect(screen.getByText("Anthropic · online")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ver origem de PDF" }).getAttribute("href")).toBe(online.sourceUrl);
    fireEvent.click(screen.getByRole("button", { name: "Instalados (1)" }));
    expect(screen.getByRole("heading", { name: "Local custom" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "PDF" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remover Local custom" })).toBeNull();
  });

  it("searches names, descriptions, sources and shows a useful empty result", async () => {
    render(<MarketplaceSection />);
    await screen.findByRole("heading", { name: "PDF" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar skills" }), { target: { value: "Anthropic" } });
    expect(screen.getByRole("heading", { name: "PDF" })).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar skills" }), { target: { value: "unknown" } });
    expect(screen.queryByRole("heading", { name: "PDF" })).toBeNull();
    expect(screen.getByText("Nenhuma skill corresponde à busca.")).toBeTruthy();
  });

  it("installs the remote identifier and refreshes actual persisted state", async () => {
    render(<MarketplaceSection />);
    const button = await screen.findByRole("button", { name: "Instalar PDF" });
    registryIndex.mockResolvedValue({ ok: true, index: { skills: [{ ...online, installed: true }] }, installed: [local, { ...online, id: "local:codebrain:anthropic--pdf", scope: "codebrain", localId: "anthropic--pdf" }], sources });
    fireEvent.click(button);
    await screen.findByText("PDF: instalada no CodeBrain.");
    expect(installFromRegistry).toHaveBeenCalledExactlyOnceWith({ id: "anthropic:pdf" });
    expect((screen.getByRole("button", { name: "Instalar PDF" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Instalados (2)" }));
    expect(screen.getByRole("button", { name: "Remover PDF" })).toBeTruthy();
  });

  it.each([undefined, { ok: false, error: "Download failed" }])("never claims installation succeeded after an absent or failed response", async response => {
    installFromRegistry.mockResolvedValue(response);
    render(<MarketplaceSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Instalar PDF" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("PDF: instalada no CodeBrain.")).toBeNull();
    expect(screen.getByRole("button", { name: "Instalados (1)" })).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("button", { name: "Instalar PDF" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("removes only CodeBrain inventory entries using the correct API and local identifier", async () => {
    registryIndex.mockResolvedValue({ ok: true, index: { skills: [online] }, installed: [{ ...local, scope: "codebrain", localId: "my-skill" }], sources });
    render(<MarketplaceSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Instalados (1)" }));
    registryIndex.mockResolvedValue({ ok: true, index: { skills: [online] }, installed: [], sources });
    fireEvent.click(screen.getByRole("button", { name: "Remover Local custom" }));
    await screen.findByRole("button", { name: "Instalados (0)" });
    expect(uninstallSkill).toHaveBeenCalledExactlyOnceWith({ id: "my-skill" });
  });

  it("reports an offline catalog while still allowing installed inventory inspection", async () => {
    registryIndex.mockResolvedValue({ ok: false, index: { skills: [] }, installed: [local], sources: [{ ...sources[0], status: "unavailable" }], error: "Sem conexão" });
    render(<MarketplaceSection />);
    expect((await screen.findByRole("alert")).textContent).toBe("Sem conexão");
    expect(screen.getByText("Anthropic · indisponível")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Instalados (1)" }));
    expect(screen.getByRole("heading", { name: "Local custom" })).toBeTruthy();
  });

  it("labels cached results and allows retrying after a network error", async () => {
    registryIndex.mockResolvedValue({ ok: true, index: { skills: [online] }, installed: [], sources: [{ ...sources[0], status: "cached", fetchedAt: "2026-11-09T12:00:00.000Z" }] });
    render(<MarketplaceSection />);
    expect(await screen.findByText(/Anthropic · cache de/)).toBeTruthy();
    registryIndex.mockRejectedValueOnce(new Error("Network unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Atualizar marketplace" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Network unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Atualizar marketplace" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
