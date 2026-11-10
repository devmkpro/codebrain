import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetRouter, getLocation } from "../../lib/router";
import { toLocation } from "../../lib/router-core";
import { useNavStore } from "../../stores/nav-store";
import { usePaneLauncherStore } from "../../stores/pane-launcher-store";
import { useTasksStore } from "../../stores/tasks-store";
import { CommandBar } from "./CommandBar";

vi.mock("./WorkspaceSwitcher", () => ({ WorkspaceSwitcher: () => <span>workspace</span> }));
afterEach(cleanup);

describe("CommandBar brand navigation", () => {
  it("makes the logo a non-drag button that always reveals Home and closes overlays", () => {
    __resetRouter(toLocation("/settings"));
    useNavStore.setState({ onHome: false, tabs: [{ workspacePath: "D:/repo", view: { kind: "workspace" } }], activeTabIndex: 0 } as any);
    usePaneLauncherStore.getState().show();
    useTasksStore.setState({ visible: true });
    render(<CommandBar />);
    const logo = screen.getByRole("button", { name: "Codebrain — Início" });
    expect(logo.className).toContain("app-region-no-drag");
    fireEvent.click(logo);
    expect(getLocation().path).toBe("/");
    expect((useNavStore.getState() as { onHome: boolean }).onHome).toBe(true);
    expect(usePaneLauncherStore.getState().open).toBe(false);
    expect((useTasksStore.getState() as { visible: boolean }).visible).toBe(false);
  });
});
