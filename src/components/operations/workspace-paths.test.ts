import { describe, expect, it } from "vitest";
import { operationWorkspacePaths } from "./workspace-paths";

describe("operations discovery paths", () => {
  it("includes registered projects and the active project, not arbitrary old tabs", () => {
    expect(operationWorkspacePaths(["D:/registered"], "D:/active")).toEqual(["D:/registered", "D:/active"]);
    expect(operationWorkspacePaths(["D:/registered"])).toEqual(["D:/registered"]);
  });
  it("deduplicates Windows separators and case", () => {
    expect(operationWorkspacePaths(["D:\\project\\", "d:/project"], "D:/PROJECT")).toEqual(["D:/PROJECT"]);
  });
});
