"use strict";

const fs = require("node:fs");
const { createFileOps, failure, problem, fits, encode, lineParts, unicodePrefix } = require("./file-ops.js");

function changePreview(file, before, after) {
  const a = lineParts(before).map(line => line.replace(/[\r\n]+$/, ""));
  const b = lineParts(after).map(line => line.replace(/[\r\n]+$/, ""));
  let start = 0, tail = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (tail < a.length - start && tail < b.length - start && a[a.length - tail - 1] === b[b.length - tail - 1]) tail++;
  const removed = a.slice(start, a.length - tail), added = b.slice(start, b.length - tail);
  const clip = lines => unicodePrefix(lines.slice(0, 60).join("\n"), 2200);
  const oldPreview = clip(removed), newPreview = clip(added);
  const diff = `--- ${file}\n+++ ${file}\n@@ -${start + 1},${removed.length} +${start + 1},${added.length} @@\n` +
    oldPreview.split("\n").map(line => `-${line}`).join("\n") + "\n" + newPreview.split("\n").map(line => `+${line}`).join("\n");
  return { diff, removedLines: removed.length, addedLines: added.length,
    diffTruncated: removed.length > 60 || added.length > 60 || oldPreview.length < removed.join("\n").length || newPreview.length < added.join("\n").length };
}

function createMultiEditHandlers(opts) {
  const ops = createFileOps(opts);
  return {
    async fileMultiEdit(args = {}) {
      const plans = [], published = [];
      let failedFile, failedEdit;
      try {
        if (args.dryRun !== undefined && typeof args.dryRun !== "boolean") problem("INVALID_ARGUMENT", "dryRun must be boolean");
        if (args.returnDiff !== undefined && typeof args.returnDiff !== "boolean") problem("INVALID_ARGUMENT", "returnDiff must be boolean");
        if (args.files !== undefined && (args.path !== undefined || args.edits !== undefined)) problem("INVALID_ARGUMENT", "Supply either path/edits or files, not both");
        const files = args.files === undefined ? [{ path: args.path, edits: args.edits }] : args.files;
        if (!Array.isArray(files) || !files.length || files.length > 20) problem("INVALID_ARGUMENT", "Provide 1 to 20 files");
        const seen = new Set(), data = [];
        let totalEdits = 0, totalBytes = 0;
        for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
          const input = files[fileIndex];
          if (!input || typeof input !== "object") problem("INVALID_ARGUMENT", "Each file requires path and edits");
          failedFile = input.path;
          const full = ops.resolve(input.path, "write");
          const canonical = fs.realpathSync(full), key = process.platform === "win32" ? canonical.toLowerCase() : canonical;
          if (seen.has(key)) problem("DUPLICATE_FILE", "Each file may appear only once in a batch");
          seen.add(key);
          if (!Array.isArray(input.edits) || !input.edits.length || (totalEdits += input.edits.length) > 100) problem("INVALID_ARGUMENT", "Provide at most 100 nonempty edits across the batch");
          const source = ops.readText(full), original = ops.snapshot(full);
          if (!original || !original.buffer.equals(source.buffer)) problem("FILE_CHANGED", "File changed while reading; retry after inspection");
          totalBytes += original.buffer.length;
          if (totalBytes > 32 * 1024 * 1024) problem("FILE_TOO_LARGE", "Batch source files exceed 32 MiB");
          let content = source.text;
          for (let index = 0; index < input.edits.length; index++) {
            failedEdit = index;
            const edit = input.edits[index];
            if (!edit || typeof edit.oldString !== "string" || !edit.oldString || (edit.newString !== undefined && typeof edit.newString !== "string") || (edit.replaceAll !== undefined && typeof edit.replaceAll !== "boolean")) problem("INVALID_EDIT", "Each edit requires nonempty oldString, string newString and optional boolean replaceAll");
            if (edit.oldString.length > 2 * 1024 * 1024 || (edit.newString?.length || 0) > 2 * 1024 * 1024) problem("INVALID_EDIT", "An edit exceeds the 2 MiB limit");
            const positions = [];
            let cursor = 0, found;
            while ((found = content.indexOf(edit.oldString, cursor)) !== -1) {
              positions.push(found); cursor = found + edit.oldString.length;
              if (!edit.replaceAll && positions.length > 1) problem("AMBIGUOUS_MATCH", "oldString matches more than once; provide a unique anchor or explicitly use replaceAll");
              if (positions.length > 100000) problem("TOO_MANY_MATCHES", "Edit matches too many occurrences");
            }
            if (!positions.length) problem("OLD_STRING_NOT_FOUND", "oldString not found in file; inspect the relevant lines before retrying");
            const matchedLines = positions.slice(0, 10).map(position => (content.slice(0, position).match(/\r\n|\r|\n/g) || []).length + 1);
            const replacement = edit.newString === undefined ? "" : edit.newString;
            if (content.length + positions.length * (replacement.length - edit.oldString.length) > 16 * 1024 * 1024) problem("FILE_TOO_LARGE", "Replacement expansion exceeds the file size limit");
            content = edit.replaceAll ? content.split(edit.oldString).join(replacement)
              : content.slice(0, positions[0]) + replacement + content.slice(positions[0] + edit.oldString.length);
            if (Buffer.byteLength(content) > 16 * 1024 * 1024) problem("FILE_TOO_LARGE", "Edited file exceeds 16 MiB");
            data.push({ fileIndex, index, ok: true, replacements: positions.length, matchedLines, matchedLinesTruncated: positions.length > 10 });
          }
          const bytes = encode(content, source.encoding, source.bomEncoding);
          if (bytes.length > 16 * 1024 * 1024) problem("FILE_TOO_LARGE", "Encoded edited file exceeds 16 MiB");
          plans.push({ full, original, bytes, source: source.text, content, edits: input.edits.length });
          failedEdit = undefined;
        }
        const totalReplacements = data.reduce((sum, item) => sum + item.replacements, 0);
        const result = { ok: true, dryRun: args.dryRun === true, applied: args.dryRun ? 0 : totalEdits, wouldApply: totalEdits,
          totalReplacements, data, size: plans.reduce((sum, plan) => sum + plan.bytes.length, 0),
          files: plans.map(plan => ({ path: plan.full, size: plan.bytes.length, changed: !plan.bytes.equals(plan.original.buffer) })),
          atomic: "per-file", batchValidated: true,
          message: `${totalReplacements} replacement(s) across ${totalEdits} validated edit(s).` };
        if (args.returnDiff) {
          const previews = plans.map(plan => changePreview(plan.full, plan.source, plan.content)), fullDiff = previews.map(preview => preview.diff).join("\n");
          result.diff = unicodePrefix(fullDiff, 6000);
          result.diffTruncated = previews.some(preview => preview.diffTruncated) || result.diff.length < fullDiff.length;
          result.diffStats = previews.map(({ removedLines, addedLines }) => ({ removedLines, addedLines }));
        }
        if (!fits(result)) {
          for (const item of result.data) { item.matchedLines = []; item.matchedLinesTruncated = true; }
          while (!fits(result) && result.diff?.length) { result.diff = unicodePrefix(result.diff, Math.floor(result.diff.length / 2)); result.diffTruncated = true; }
        }
        if (!fits(result)) problem("OUTPUT_LIMIT", "Batch metadata exceeds the safe response limit; use a smaller batch");
        // ALL files and edits pass preflight before the first staged write.
        if (args.dryRun) return result;
        for (const plan of plans) if (!plan.bytes.equals(plan.original.buffer)) { failedFile = plan.full; plan.temporary = ops.stage(plan.full, plan.bytes, plan.original.mode); }
        for (const plan of plans) ops.unchanged(plan.full, plan.original);
        for (const plan of plans) {
          if (!plan.temporary) continue;
          failedFile = plan.full;
          ops.unchanged(plan.full, plan.original);
          fs.renameSync(plan.temporary, plan.full); plan.temporary = undefined;
          published.push(plan);
        }
        return result;
      } catch (error) {
        const unrestored = [];
        for (const plan of published.slice().reverse()) {
          let temporary;
          try {
            ops.resolve(plan.full, "write");
            if (!fs.readFileSync(plan.full).equals(plan.bytes)) throw new Error("concurrent change");
            temporary = ops.stage(plan.full, plan.original.buffer, plan.original.mode);
            fs.renameSync(temporary, plan.full); temporary = undefined;
          } catch { unrestored.push(plan.full); }
          finally { if (temporary) fs.rmSync(temporary, { force: true }); }
        }
        return failure(error, { applied: unrestored.reduce((sum, file) => sum + (published.find(plan => plan.full === file)?.edits || 0), 0),
          ...(failedFile ? { failedFile: String(failedFile).slice(0, 500) } : {}), ...(failedEdit !== undefined ? { failedEdit } : {}),
          ...(published.length ? { rolledBack: unrestored.length === 0, partial: unrestored.length > 0, unrestoredFiles: unrestored.map(file => file.slice(0, 500)) } : {}) });
      } finally {
        for (const plan of plans) if (plan.temporary) fs.rmSync(plan.temporary, { force: true });
      }
    },
  };
}

module.exports = { createMultiEditHandlers };
