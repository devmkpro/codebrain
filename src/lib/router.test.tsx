import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetRouter, back, forward, getLocation, navigate, RouterProvider } from "./router";

beforeEach(() => {
  __resetRouter();
  window.history.replaceState(null, "", "#/");
});
afterEach(cleanup);

describe("router window synchronization", () => {
  it("adopts a deep link entered after import but before a delayed provider mount", () => {
    window.history.replaceState(null, "", "#/central?s=tarefas");
    const view = render(<RouterProvider><div>shell</div></RouterProvider>);
    expect(getLocation()).toEqual({ path: "/central", query: { s: "tarefas" } });
    view.unmount();
    render(<RouterProvider><div>remounted shell</div></RouterProvider>);
    expect(window.location.hash).toBe("#/central?s=tarefas");
  });

  it("keeps back and forward hashes synchronized without adding history entries", () => {
    navigate("/central", { query: { s: "tarefas" } });
    navigate("/settings");
    back();
    expect(window.location.hash).toBe("#/central?s=tarefas");
    forward();
    expect(window.location.hash).toBe("#/settings");
  });
});
