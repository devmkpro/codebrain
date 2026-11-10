// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createMemoryHandlers } from "./memory-handlers.js";

it("forwards search filters and explicit false without overriding workspace", async () => {
  const search = vi.fn(() => ({ ok: true, memories: [], count: 0 }));
  const api = createMemoryHandlers({ memoryStore: { search }, getCurrentWorkspacePath: () => "D:/active" });
  await api.memorySearch({ query: "brief", tags: ["ui"], exclude_tags: ["obsolete"], include_auto: false, limit: 7 });
  expect(search).toHaveBeenCalledWith({ query: "brief", type: undefined, workspace: "D:/active", limit: 7, tags: ["ui"], exclude_tags: ["obsolete"], include_auto: false });
});

it("keeps include_auto omitted for the legacy background-style query and honors explicit workspace", async () => {
  const search = vi.fn(() => ({ ok: true, memories: [], count: 0 }));
  const api = createMemoryHandlers({ memoryStore: { search }, getCurrentWorkspacePath: () => "D:/active" });
  await api.memorySearch({ query: "file-changed", workspace: "D:/explicit", include_auto: undefined });
  expect(search).toHaveBeenCalledWith(expect.objectContaining({ query: "file-changed", workspace: "D:/explicit", include_auto: undefined }));
});
