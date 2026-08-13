import { describe, expect, it } from "vitest";
import { paneDropSide } from "./pane-drag";

const rect = { left: 100, top: 50, width: 800, height: 600 };

describe("pane drag placement", () => {
  it("places a center drop side by side", () => {
    expect(paneDropSide(rect, 500, 350)).toBe("right");
  });

  it.each([
    [110, 350, "left"],
    [890, 350, "right"],
    [500, 60, "top"],
    [500, 640, "bottom"],
  ] as const)("honors explicit edge placement", (x, y, side) => {
    expect(paneDropSide(rect, x, y)).toBe(side);
  });
});
