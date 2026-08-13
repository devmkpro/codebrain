import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { compactMcpRoute, McpRouteStatus } from "./McpRouteStatus";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("McpRouteStatus", () => {
  it("shows the live MCP route and copies the full endpoint", async () => {
    const copyToClipboard = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("codeBrainApp", {
      mcp: {
        status: vi.fn().mockResolvedValue({
          active: true,
          port: 61010,
          route: "http://127.0.0.1:61010/mcp",
          toolCount: 289,
        }),
      },
      app: { copyToClipboard },
    });

    render(<McpRouteStatus />);

    expect(await screen.findByText("MCP online")).toBeTruthy();
    const route = screen.getByRole("button", { name: "rota 127.0.0.1:61010/mcp" });
    fireEvent.click(route);

    await waitFor(() => {
      expect(copyToClipboard).toHaveBeenCalledWith("http://127.0.0.1:61010/mcp");
    });
  });

  it("compacts valid URLs without hiding a non-standard route", () => {
    expect(compactMcpRoute("http://127.0.0.1:61011/mcp")).toBe("127.0.0.1:61011/mcp");
    expect(compactMcpRoute("stdio://codebrain")).toBe("stdio://codebrain");
    expect(compactMcpRoute(null)).toBe("rota indisponível");
  });
});
