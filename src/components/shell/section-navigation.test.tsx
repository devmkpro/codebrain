import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSectionNavigation } from "./section-navigation";

afterEach(cleanup);

function SettingsFixture() {
  const [open, setOpen] = React.useState<string[]>([]);
  const { scrollRef, selectSection } = useSectionNavigation(setOpen);
  return <>
    <button onClick={() => selectSection("voice")}>Voz</button>
    <section ref={scrollRef} data-testid="settings-scroll">
      <section id="settings-voice"><button aria-expanded={open.includes("voice")}>Voz / BrainVoice</button>{open.includes("voice") && <div>Configuração de voz</div>}</section>
    </section>
  </>;
}

describe("settings section navigation", () => {
  it("opens Voz before scrolling its container, and selecting it again never collapses it", async () => {
    render(<SettingsFixture />);
    const scroll = screen.getByTestId("settings-scroll");
    const scrollTo = vi.fn();
    scroll.scrollTo = scrollTo;
    scroll.scrollTop = 100;
    vi.spyOn(scroll, "getBoundingClientRect").mockReturnValue({ top: 60 } as DOMRect);
    vi.spyOn(document.getElementById("settings-voice")!, "getBoundingClientRect").mockReturnValue({ top: 500 } as DOMRect);
    fireEvent.click(screen.getByRole("button", { name: "Voz" }));
    expect(screen.getByText("Configuração de voz")).toBeTruthy();
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 528, behavior: "smooth" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Voz / BrainVoice" }));
    fireEvent.click(screen.getByRole("button", { name: "Voz" }));
    await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Configuração de voz")).toBeTruthy();
  });
});
