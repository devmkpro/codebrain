import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/router", () => ({ useRouter: () => ({ navigate: vi.fn() }) }));

import { WhatsNewModal, LATEST_RELEASE_VERSION } from "./WhatsNewModal";

describe("WhatsNewModal", () => {
  afterEach(cleanup);

  it("renders nothing when closed", () => {
    const { container } = render(<WhatsNewModal open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("sells the cost reduction with the measured numbers", () => {
    render(<WhatsNewModal open onClose={() => {}} currentVersion="1.21.0" />);

    expect(screen.getByText(/mais barato que o Claude Code/)).toBeTruthy();
    // The three bars of the comparison, straight from the measurement.
    expect(screen.getByText("188.631")).toBeTruthy();
    expect(screen.getByText("51.408")).toBeTruthy();
    expect(screen.getByText("15.757")).toBeTruthy();
    expect(screen.getByText("Codebrain 1.21")).toBeTruthy();
  });

  it("reports the version it is announcing", () => {
    render(<WhatsNewModal open onClose={() => {}} currentVersion="1.21.0" />);
    expect(screen.getByText("Codebrain v1.21.0")).toBeTruthy();
  });

  it("keeps LATEST_RELEASE_VERSION in sync with the generated notes", () => {
    // Regression guard: a release whose commits are all filtered out by
    // gen-releases.mjs would silently leave this pointing at an older version.
    expect(LATEST_RELEASE_VERSION).toBe("1.21.0");
  });
});
