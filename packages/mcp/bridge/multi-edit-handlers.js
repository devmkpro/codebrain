"use strict";

/**
 * Multi-Edit Handler (MiMo-inspired)
 * Batch multiple edit operations on a single file in one tool call.
 */

const fs = require("node:fs");

function createMultiEditHandlers(opts) {
  return {
    /** Apply multiple edits to a single file sequentially. */
    async fileMultiEdit({ path: filePath, edits }) {
      try {
        if (!filePath) return { ok: false, error: "File path required" };
        if (!Array.isArray(edits) || edits.length === 0) return { ok: false, error: "Edits array required" };
        if (!fs.existsSync(filePath)) return { ok: false, error: `File not found: ${filePath}` };

        let content = fs.readFileSync(filePath, "utf-8");
        const results = [];

        for (let i = 0; i < edits.length; i++) {
          const { oldString, newString, replaceAll = false } = edits[i];
          if (!oldString && oldString !== "") {
            results.push({ index: i, ok: false, error: "oldString required" });
            continue;
          }
          if (content.includes(oldString)) {
            if (replaceAll) {
              const count = content.split(oldString).length - 1;
              content = content.split(oldString).join(newString || "");
              results.push({ index: i, ok: true, replacements: count });
            } else {
              content = content.replace(oldString, newString || "");
              results.push({ index: i, ok: true, replacements: 1 });
            }
          } else {
            results.push({ index: i, ok: false, error: "oldString not found in file" });
          }
        }

        fs.writeFileSync(filePath, content, "utf-8");
        const totalReplacements = results.reduce((sum, r) => sum + (r.replacements || 0), 0);
        const failures = results.filter(r => !r.ok).length;
        return {
          ok: failures === 0, data: results,
          message: `${totalReplacements} replacement(s) across ${edits.length} edit(s). ${failures} failure(s).`,
          size: Buffer.byteLength(content, "utf-8"),
        };
      } catch (e) { return { ok: false, error: e.message }; }
    },
  };
}

module.exports = { createMultiEditHandlers };
