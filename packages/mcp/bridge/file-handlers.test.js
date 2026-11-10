// @vitest-environment node
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { createFileHandlers } = require("./file-handlers.js");
const { createMultiEditHandlers } = require("./multi-edit-handlers.js");

describe("file operations feedback regressions", () => {
  let fixture, workspace, home, handlers, multi, options;
  const write = (relative, content) => {
    const file = path.join(workspace, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
  };
  beforeEach(() => {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), "cb-file-ops-"));
    home = path.join(fixture, "home");
    workspace = path.join(home, "workspace");
    fs.mkdirSync(workspace, { recursive: true });
    vi.spyOn(os, "homedir").mockReturnValue(home);
    options = { getCurrentWorkspacePath: () => workspace, workspaceConfigStore: { getAccessMode: () => "read_external" } };
    handlers = createFileHandlers(options);
    multi = createMultiEditHandlers(options);
  });
  afterEach(() => { vi.restoreAllMocks(); fs.rmSync(fixture, { recursive: true, force: true }); });

  it("reads inclusive line ranges with accurate totals and continuation", async () => {
    write("unicode.txt", "ação\r\nsegunda 😀\r\nterceira\r\n");
    const result = await handlers.fileRead({ path: "unicode.txt", startLine: 2, endLine: 2 });
    expect(result).toMatchObject({ ok: true, content: "segunda 😀\r\n", startLine: 2, endLine: 2, totalLines: 3, nextLine: 3, nextColumn: 1, encoding: "utf8", bom: false });
  });

  it("bounds escaped JSON output instead of assuming the input byte cap is the output cap", async () => {
    write("large.tsx", Array.from({ length: 3000 }, (_, i) => `const n${i} = "ação\\\\😀";\n`).join(""));
    const result = await handlers.fileRead({ path: "large.tsx", maxChars: 4000 });
    expect(result.ok).toBe(true);
    expect(result.truncated).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(4000);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(4000);
    expect(result.nextLine).toBeGreaterThan(1);
    expect(result.content).not.toContain("�");
  });

  it("paginates an oversized Unicode line without losing or splitting characters", async () => {
    const original = "😀".repeat(1200) + "\nfinal\n";
    write("long.txt", original);
    let nextLine = 1, nextColumn = 1, collected = "", pages = 0;
    do {
      const page = await handlers.fileRead({ path: "long.txt", startLine: nextLine, startColumn: nextColumn, maxChars: 1024 });
      expect(page.ok).toBe(true);
      expect(JSON.stringify(page).length).toBeLessThanOrEqual(1024);
      expect(page.content).not.toContain("�");
      collected += page.content;
      nextLine = page.nextLine; nextColumn = page.nextColumn;
      expect(++pages).toBeLessThan(30);
    } while (nextLine !== null);
    expect(collected).toBe(original);
  });

  it("detects UTF-8/UTF-16 BOM and preserves accented text", async () => {
    write("utf8.txt", Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from("ação\nsegunda\n")]));
    write("utf16.txt", Buffer.concat([Buffer.from([255, 254]), Buffer.from("ação\nopção\n", "utf16le")]));
    expect(await handlers.fileRead({ path: "utf8.txt", endLine: 1 })).toMatchObject({ ok: true, content: "ação\n", bom: true, encoding: "utf8" });
    expect(await handlers.fileRead({ path: "utf16.txt", startLine: 2 })).toMatchObject({ ok: true, content: "opção\n", bom: true, encoding: "utf16le", totalLines: 2 });
  });

  it("reports empty files, invalid ranges and binary/invalid UTF-8 honestly", async () => {
    write("empty", ""); write("broken", Buffer.from([0xc3, 0x28]));
    expect(await handlers.fileRead({ path: "empty" })).toMatchObject({ ok: true, content: "", totalLines: 0, nextLine: null });
    expect((await handlers.fileRead({ path: "empty", startLine: 0 })).ok).toBe(false);
    expect((await handlers.fileRead({ path: "broken" })).ok).toBe(false);
  });

  it("supports budgeted line ranges and caps serialized output even at 9000 tokens", async () => {
    write("budget.ts", "first\nsecond\nthird\n");
    expect(await handlers.fileBudgetedRead({ path: "budget.ts", startLine: 2, endLine: 2, budgetTokens: 9000 })).toMatchObject({ ok: true, content: "second\n", totalLines: 3 });
    write("huge-budget.ts", Array.from({ length: 2000 }, (_, i) => `export const f${i} = "\\\\\\\\${"á".repeat(30)}";\n`).join(""));
    const result = await handlers.fileBudgetedRead({ path: "huge-budget.ts", budgetTokens: 9000 });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThan(25000);
  });

  it("distinguishes nonexistent search paths from successful empty searches", async () => {
    expect(await handlers.fileSearch({ path: "missing", content: "needle" })).toMatchObject({ ok: false, code: "PATH_NOT_FOUND" });
    expect(await handlers.fileSearch({ content: "needle" })).toMatchObject({ ok: true, count: 0 });
  });

  it("searches a single file with line numbers, bounded snippets and explicit case sensitivity", async () => {
    write("src/page.tsx", "heading\nneedle " + "😀".repeat(1000) + "\nNeedle again\n");
    const result = await handlers.fileSearch({ path: "src/page.tsx", pattern: "**/*.tsx", content: "needle" });
    expect(result).toMatchObject({ ok: true, count: 1 });
    expect(result.results[0]).toMatchObject({ path: "page.tsx", line: 2, column: 1 });
    expect(result.results[0].snippet.length).toBeLessThanOrEqual(500);
    expect(result.results[0].snippet).not.toContain("�");
    expect((await handlers.fileSearch({ path: "src/page.tsx", content: "needle", caseSensitive: false })).count).toBe(2);
  });

  it("ignores generated output and basic gitignore rules while allowing explicit inclusion", async () => {
    write(".gitignore", "ignored/\n*.log\n!keep.log\n");
    for (const file of ["src/source.ts", "public/build/generated.js", "ignored/private.txt", "debug.log", "keep.log"]) write(file, "needle\n");
    const result = await handlers.fileSearch({ content: "needle", limit: 100 });
    expect(result.results.map(item => item.path).sort()).toEqual(["keep.log", "src/source.ts"]);
    const included = await handlers.fileSearch({ content: "needle", includeIgnored: true, limit: 100 });
    expect(included.count).toBe(5);
  });

  it("appends without replacing prior records, including BOM encodings", async () => {
    write("feedback.txt", "existing\n");
    await Promise.all(Array.from({ length: 15 }, (_, i) => createFileHandlers(options).fileWrite({ path: "feedback.txt", content: `agent-${i}\n`, append: true })));
    const value = fs.readFileSync(path.join(workspace, "feedback.txt"), "utf8");
    expect(value.startsWith("existing\n")).toBe(true);
    for (let i = 0; i < 15; i++) expect(value.split(`agent-${i}\n`)).toHaveLength(2);
    write("utf16.log", Buffer.concat([Buffer.from([255, 254]), Buffer.from("ação\n", "utf16le")]));
    expect((await handlers.fileWrite({ path: "utf16.log", content: "opção\n", append: true })).ok).toBe(true);
    expect(fs.readFileSync(path.join(workspace, "utf16.log")).subarray(2).toString("utf16le")).toBe("ação\nopção\n");
  });

  it("resolves multi-edit paths relative to the workspace, preserving BOM and CRLF", async () => {
    write("src/edit.txt", Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from("ação\r\nold\r\n")]));
    const result = await multi.fileMultiEdit({ path: "src/edit.txt", edits: [{ oldString: "old", newString: "$& literal" }], returnDiff: true });
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(workspace, "src/edit.txt"), "utf8")).toBe("\uFEFFação\r\n$& literal\r\n");
    expect(result.diff).toContain("+$& literal");
  });

  it("preflights every edit before modifying a file", async () => {
    const file = write("edit.txt", "alpha\nbeta\n");
    const result = await multi.fileMultiEdit({ path: file, edits: [{ oldString: "alpha", newString: "changed" }, { oldString: "absent", newString: "bad" }] });
    expect(result).toMatchObject({ ok: false, applied: 0 });
    expect(fs.readFileSync(file, "utf8")).toBe("alpha\nbeta\n");
  });

  it("rejects empty/ambiguous edits, supports dry run and bounds the diff", async () => {
    const file = write("edit.txt", "repeat\nrepeat\n");
    expect((await multi.fileMultiEdit({ path: file, edits: [{ oldString: "", newString: "bad" }] })).ok).toBe(false);
    expect((await multi.fileMultiEdit({ path: file, edits: [{ oldString: "repeat", newString: "bad" }] })).ok).toBe(false);
    const preview = await multi.fileMultiEdit({ path: file, edits: [{ oldString: "repeat", newString: "new", replaceAll: true }], dryRun: true, returnDiff: true });
    expect(preview).toMatchObject({ ok: true, applied: 0, dryRun: true });
    expect(preview.diff).toContain("+new");
    expect(fs.readFileSync(file, "utf8")).toBe("repeat\nrepeat\n");
  });

  it("validates an entire batch before writing and rolls back publish failures", async () => {
    const a = write("a.txt", "alpha"), b = write("b.txt", "beta");
    const invalid = await multi.fileMultiEdit({ files: [{ path: a, edits: [{ oldString: "alpha", newString: "new-a" }] }, { path: b, edits: [{ oldString: "absent", newString: "new-b" }] }] });
    expect(invalid).toMatchObject({ ok: false, applied: 0 });
    expect(fs.readFileSync(a, "utf8")).toBe("alpha");
    const rename = fs.renameSync.bind(fs);
    let injected = false;
    vi.spyOn(fs, "renameSync").mockImplementation((src, dest) => { if (dest === b && !injected) { injected = true; throw new Error("injected publish failure"); } return rename(src, dest); });
    const result = await multi.fileMultiEdit({ files: [{ path: a, edits: [{ oldString: "alpha", newString: "new-a" }] }, { path: b, edits: [{ oldString: "beta", newString: "new-b" }] }] });
    expect(result).toMatchObject({ ok: false, applied: 0, rolledBack: true });
    expect(fs.readFileSync(a, "utf8")).toBe("alpha");
    expect(fs.readFileSync(b, "utf8")).toBe("beta");
    expect(fs.readdirSync(workspace).sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("does not expand home-prefix or external-write permissions, including multi-edit", async () => {
    const outside = path.join(fixture, "home-sibling", "outside.txt");
    fs.mkdirSync(path.dirname(outside)); fs.writeFileSync(outside, "outside");
    expect((await handlers.fileRead({ path: outside })).ok).toBe(false);
    const external = path.join(home, "external.txt"); fs.writeFileSync(external, "external");
    expect((await handlers.fileRead({ path: external })).ok).toBe(true);
    expect((await handlers.fileWrite({ path: external, content: "bad", append: true })).ok).toBe(false);
    expect((await multi.fileMultiEdit({ path: external, edits: [{ oldString: "external", newString: "bad" }] })).ok).toBe(false);
    expect(fs.readFileSync(external, "utf8")).toBe("external");
  });

  it("checks the physical target of directory symlinks before accessing files", async () => {
    const outside = path.join(fixture, "outside"); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, "secret.txt"), "untouched");
    fs.symlinkSync(outside, path.join(workspace, "link"), process.platform === "win32" ? "junction" : "dir");
    expect((await handlers.fileRead({ path: "link/secret.txt" })).ok).toBe(false);
    expect((await handlers.fileWrite({ path: "link/secret.txt", content: "bad" })).ok).toBe(false);
    expect((await multi.fileMultiEdit({ path: "link/secret.txt", edits: [{ oldString: "untouched", newString: "bad" }] })).ok).toBe(false);
    expect(fs.readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe("untouched");
  });

  it("continues a >30k single line at the Unicode column cursor without losing its tail", async () => {
    const original = 'ação 😀 "\\\\" '.repeat(3500) + "\r\nnext\r\n";
    write("one-huge-line", original);
    let cursor = { startLine: 1, startColumn: 1 }, collected = "", iterations = 0;
    do {
      const result = await handlers.fileRead({ path: "one-huge-line", maxChars: 4000, ...cursor });
      expect(result.ok).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(result, null, 2))).toBeLessThanOrEqual(4000);
      collected += result.content;
      cursor = { startLine: result.nextLine, startColumn: result.nextColumn };
      expect(++iterations).toBeLessThan(150);
    } while (cursor.startLine !== null);
    expect(collected).toBe(original);
  });

  it("maintains a resumable cursor even for tiny budgeted reads", async () => {
    const original = "😀😀\r\nsecond\n";
    write("tiny", original);
    let nextLine = 1, nextColumn = 1, output = "", count = 0;
    do {
      const page = await handlers.fileBudgetedRead({ path: "tiny", budgetTokens: 1, startLine: nextLine, startColumn: nextColumn });
      expect(page.ok).toBe(true); expect(page.budgetUsed).toBeLessThanOrEqual(1);
      output += page.content; nextLine = page.nextLine; nextColumn = page.nextColumn;
      expect(++count).toBeLessThan(15);
    } while (nextLine !== null);
    expect(output).toBe(original);
  });

  it("does not ignore regular files merely because they share a gitignored directory name", async () => {
    write(".gitignore", "cache/\n"); write("src/cache", "needle\n"); write("cache/output", "needle\n");
    const result = await handlers.fileSearch({ content: "needle" });
    expect(result.results.map(item => item.path)).toEqual(["src/cache"]);
  });

  it("preserves the destination and cleans staging when atomic overwrite publication fails", async () => {
    const file = write("write.txt", "user content");
    vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("injected failure"); });
    expect((await handlers.fileWrite({ path: file, content: "replacement" })).ok).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe("user content");
    expect(fs.readdirSync(workspace)).toEqual(["write.txt"]);
  });

  it("aborts multi-edit if an external writer changes the original during staging", async () => {
    const file = write("race.txt", "original");
    const sync = fs.fsyncSync.bind(fs); let changed = false;
    vi.spyOn(fs, "fsyncSync").mockImplementation(fd => { if (!changed) { changed = true; fs.writeFileSync(file, "concurrent user edit"); } return sync(fd); });
    const result = await multi.fileMultiEdit({ path: file, edits: [{ oldString: "original", newString: "our change" }] });
    expect(result).toMatchObject({ ok: false, code: "FILE_CHANGED", applied: 0 });
    expect(fs.readFileSync(file, "utf8")).toBe("concurrent user edit");
    expect(fs.readdirSync(workspace)).toEqual(["race.txt"]);
  });

  it("never overwrites a concurrent user edit while rolling back a failed batch", async () => {
    const a = write("a.txt", "alpha"), b = write("b.txt", "beta");
    const rename = fs.renameSync.bind(fs); let injected = false;
    vi.spyOn(fs, "renameSync").mockImplementation((src, dest) => {
      if (dest === b && !injected) { injected = true; fs.writeFileSync(a, "user changed after publish"); throw new Error("publish failed"); }
      return rename(src, dest);
    });
    const result = await multi.fileMultiEdit({ files: [{ path: a, edits: [{ oldString: "alpha", newString: "our a" }] }, { path: b, edits: [{ oldString: "beta", newString: "our b" }] }] });
    expect(result).toMatchObject({ ok: false, partial: true, rolledBack: false, applied: 1 });
    expect(result.unrestoredFiles).toEqual([a]);
    expect(fs.readFileSync(a, "utf8")).toBe("user changed after publish");
    expect(fs.readFileSync(b, "utf8")).toBe("beta");
  });

  it("bounds grep results and directory listings after escaping Unicode filenames", async () => {
    for (let i = 0; i < 70; i++) write(`src/file-${i}-${"á".repeat(50)}.txt`, '"needle" '.repeat(50) + "\n");
    const grep = await handlers.fileSearch({ content: "needle", limit: 100 });
    expect(grep.ok).toBe(true); expect(grep.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(grep, null, 2))).toBeLessThanOrEqual(20000);
    const directory = await handlers.fileRead({ path: "src", maxChars: 1024 });
    expect(directory).toMatchObject({ ok: true, directory: true, truncated: true, totalEntries: 70 });
    expect(Buffer.byteLength(JSON.stringify(directory, null, 2))).toBeLessThanOrEqual(1024);
  });

  it("reports time, timezone, shell and installed CLIs without claiming authentication", async () => {
    const getAvailableClis = vi.fn(() => ["codex", "kiro"]);
    const info = await createFileHandlers({ ...options, getAvailableClis }).systemInfo();
    expect(Number.isNaN(Date.parse(info.currentTime))).toBe(false);
    expect(info.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(info.shell).toBeTruthy();
    expect(info.availableClis).toEqual([{ id: "codex", installed: true, authentication: "not_verified" }, { id: "kiro", installed: true, authentication: "not_verified" }]);
    expect(getAvailableClis).toHaveBeenCalledOnce();
  });

  it("keeps append records intact across concurrent Node processes", async () => {
    write("shared.log", "initial\n");
    const script = '(async()=>{const h=require(process.argv[1]).createFileHandlers({getCurrentWorkspacePath:()=>process.argv[2]});for(let i=0;i<4;i++){const r=await h.fileWrite({path:"shared.log",content:process.argv[3]+":"+i+":"+"x".repeat(4000)+"\\n",append:true});if(!r.ok)throw Error(r.error)}})().catch(e=>{process.stderr.write(String(e));process.exitCode=1})';
    await Promise.all(Array.from({ length: 6 }, (_, worker) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["-e", script, require.resolve("./file-handlers.js"), workspace, String(worker)], { shell: false, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      let error = "";
      child.stderr.on("data", chunk => { error += String(chunk).slice(0, 1000); });
      child.on("error", reject);
      child.on("exit", code => code === 0 ? resolve() : reject(new Error(`fixture writer failed: ${code}: ${error}`)));
    })));
    const lines = fs.readFileSync(path.join(workspace, "shared.log"), "utf8").trimEnd().split("\n");
    expect(lines.shift()).toBe("initial"); expect(lines).toHaveLength(24);
    for (let worker = 0; worker < 6; worker++) for (let row = 0; row < 4; row++) expect(lines).toContain(`${worker}:${row}:${"x".repeat(4000)}`);
  }, 15000);

  it("decodes and edits UTF-16BE while preserving BOM and line endings", async () => {
    const bytes = Buffer.from("ação\r\noriginal\r\n", "utf16le").swap16();
    const file = write("be.txt", Buffer.concat([Buffer.from([254, 255]), bytes]));
    expect(await handlers.fileRead({ path: file, startLine: 2 })).toMatchObject({ ok: true, encoding: "utf16be", bom: true, content: "original\r\n" });
    expect((await multi.fileMultiEdit({ path: file, edits: [{ oldString: "original", newString: "opção" }] })).ok).toBe(true);
    const result = fs.readFileSync(file);
    expect([...result.subarray(0, 2)]).toEqual([254, 255]);
    expect(Buffer.from(result.subarray(2)).swap16().toString("utf16le")).toBe("ação\r\nopção\r\n");
  });

  it("returns a bounded diff and rejects oversized replacement expansion before writing", async () => {
    const original = "old\n".repeat(2000), file = write("diff.txt", original);
    const result = await multi.fileMultiEdit({ path: file, edits: [{ oldString: "old", newString: "new", replaceAll: true }], dryRun: true, returnDiff: true });
    expect(result).toMatchObject({ ok: true, diffTruncated: true, applied: 0 });
    expect(result.diff.length).toBeLessThanOrEqual(6000);
    expect(Buffer.byteLength(JSON.stringify(result, null, 2))).toBeLessThanOrEqual(20000);
    const invalid = await multi.fileMultiEdit({ path: file, edits: [{ oldString: "old", newString: "x".repeat(2 * 1024 * 1024), replaceAll: true }] });
    expect(invalid).toMatchObject({ ok: false, code: "FILE_TOO_LARGE", applied: 0 });
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  });
});
