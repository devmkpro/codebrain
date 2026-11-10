// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createSpawnBrief, shellMetadata } from "./spawn-metadata";

describe("safe, bounded spawn metadata", () => {
  it("retains only the explicit task, bounds it, and redacts recognizable credentials", () => {
    const brief = createSpawnBrief("p1", "Review API_KEY=secret-value Authorization: Bearer very-secret-token\n" + "task ".repeat(4000));
    expect(brief).toMatchObject({ id: "brief_p1", truncated: true, delivery: { promptSubmitted: false, state: "pending" } });
    expect(brief!.prompt.length).toBeLessThanOrEqual(12_000);
    expect(brief!.prompt).not.toContain("secret-value");
    expect(brief!.prompt).not.toContain("very-secret-token");
    expect(createSpawnBrief("p1", "  ")).toBeUndefined();
  });

  it("uses the actual executable, not the OS/default-shell assumption", () => {
    expect(shellMetadata("shell", "C:\\Windows\\System32\\cmd.exe")).toMatchObject({ kind: "cmd", commandSyntax: "cmd" });
    expect(shellMetadata("shell", "C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toMatchObject({ kind: "pwsh", commandSyntax: "powershell" });
    expect(shellMetadata("shell", "C:\\Windows\\System32\\OpenSSH\\ssh.exe")).toMatchObject({ kind: "unknown", commandSyntax: "unknown" });
    expect(shellMetadata("kiro", "kiro-cli")).toBeUndefined();
  });
});
