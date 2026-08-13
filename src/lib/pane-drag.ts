export const CODEBRAIN_PANE_DRAG_TYPE = "application/x-codebrain-pane";

export type PaneDropSide = "top" | "right" | "bottom" | "left";

interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Center defaults to a horizontal split; edges allow precise placement. */
export function paneDropSide(rect: RectLike, clientX: number, clientY: number): PaneDropSide {
  const x = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
  const y = Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height)));
  const candidates: Array<{ side: PaneDropSide; distance: number }> = [
    { side: "top", distance: y },
    { side: "right", distance: 1 - x },
    { side: "bottom", distance: 1 - y },
    { side: "left", distance: x },
  ];
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0].distance <= 0.28 ? candidates[0].side : "right";
}
