"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");

const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_JSON = 20000;
const DEFAULT_JSON = 16000;
const slash = value => value.split(path.sep).join("/");

function problem(code, message) { const error = new Error(message); error.code = code; throw error; }
function failure(error, extra = {}) {
  return { ok: false, code: error.code === "ENOENT" ? "PATH_NOT_FOUND" : error.code || "FILE_OPERATION_FAILED",
    error: Array.from(error.message || "File operation failed").slice(0, 700).join(""), ...extra };
}
function integer(value, fallback, min, max, field) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) problem("INVALID_ARGUMENT", `${field} must be an integer between ${min} and ${max}`);
  return value;
}
function boolean(value, fallback, field) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") problem("INVALID_ARGUMENT", `${field} must be boolean`);
  return value;
}
function fits(value, max = MAX_JSON) {
  const json = JSON.stringify(value, null, 2);
  return json.length <= max && Buffer.byteLength(json, "utf8") <= max;
}
function unicodePrefix(text, length) {
  let end = Math.min(length, text.length);
  if (end && /[\uD800-\uDBFF]/.test(text[end - 1]) && (end === text.length || /[\uDC00-\uDFFF]/.test(text[end] || ""))) end--;
  if (text[end - 1] === "\r" && text[end] === "\n") end--;
  return text.slice(0, end);
}
function lineParts(text) { return (text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) || []).filter(Boolean); }
function normalizedEncoding(value) {
  const aliases = { "utf-8": "utf8", "utf-16le": "utf16le", "ucs2": "utf16le", "ucs-2": "utf16le", "utf-16be": "utf16be", binary: "latin1" };
  const encoding = aliases[String(value).toLowerCase()] || String(value).toLowerCase();
  if (!["utf8", "utf16le", "utf16be", "latin1", "ascii"].includes(encoding)) problem("INVALID_ENCODING", "Supported text encodings: utf8, utf16le, utf16be, latin1, ascii");
  return encoding;
}
function detect(buffer, requested) {
  let bomEncoding = null, bomBytes = 0;
  if (buffer[0] === 239 && buffer[1] === 187 && buffer[2] === 191) { bomEncoding = "utf8"; bomBytes = 3; }
  else if (buffer[0] === 255 && buffer[1] === 254) { bomEncoding = "utf16le"; bomBytes = 2; }
  else if (buffer[0] === 254 && buffer[1] === 255) { bomEncoding = "utf16be"; bomBytes = 2; }
  const encoding = requested === undefined ? bomEncoding || "utf8" : normalizedEncoding(requested);
  if (bomEncoding && encoding !== bomEncoding) problem("ENCODING_MISMATCH", "Requested encoding conflicts with the file BOM");
  return { encoding, bom: bomBytes > 0, bomEncoding, bomBytes };
}
function decode(buffer, requested) {
  const metadata = detect(buffer, requested);
  let body = buffer.subarray(metadata.bomBytes), text;
  try {
    if (metadata.encoding === "utf16be") body = Buffer.from(body).swap16();
    text = ["utf8", "utf16le", "utf16be"].includes(metadata.encoding)
      ? new TextDecoder(metadata.encoding === "utf8" ? "utf-8" : "utf-16le", { fatal: true, ignoreBOM: true }).decode(body)
      : body.toString(metadata.encoding);
  } catch { problem("INVALID_ENCODING", "File is not valid text in the selected encoding; supply its actual encoding"); }
  if (text.includes("\0")) problem("BINARY_FILE", "Binary files are not supported by text file operations");
  return { ...metadata, text, lines: lineParts(text), buffer };
}
function encode(text, encoding, bomEncoding = null) {
  let bytes = Buffer.from(text, encoding === "utf16be" ? "utf16le" : encoding);
  if (encoding === "utf16be") bytes.swap16();
  const bom = { utf8: [239, 187, 191], utf16le: [255, 254], utf16be: [254, 255] }[bomEncoding];
  return bom ? Buffer.concat([Buffer.from(bom), bytes]) : bytes;
}
function boundedContent(base, text, max) {
  let low = 0, high = Math.min(text.length, max), best = "";
  while (low <= high) {
    const mid = Math.floor((low + high) / 2), prefix = unicodePrefix(text, mid);
    if (fits({ ...base, content: prefix }, max)) { best = prefix; low = mid + 1; } else high = mid - 1;
  }
  return best;
}

function within(file, root) { const relative = path.relative(root, file); return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`)); }
function physicalTarget(file) {
  let ancestor = file;
  const tail = [];
  while (true) {
    try { return path.join(fs.realpathSync(ancestor), ...tail); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      // A dangling symlink is not a safe nonexistent path.
      try { if (fs.lstatSync(ancestor).isSymbolicLink()) problem("UNSAFE_PATH", "Dangling symlinks are not supported"); }
      catch (statError) { if (statError.code !== "ENOENT") throw statError; }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      tail.unshift(path.basename(ancestor)); ancestor = parent;
    }
  }
}

function createFileOps(opts = {}) {
  const workspace = () => path.resolve(opts.getCurrentWorkspacePath?.() || process.cwd());
  function resolve(file, kind = "read") {
    if (typeof file !== "string" || !file || file.includes("\0")) problem("INVALID_PATH", "A nonempty file path is required");
    const ws = workspace(), home = path.resolve(os.homedir()), full = path.resolve(ws, file);
    const realWs = physicalTarget(ws), realHome = physicalTarget(home), target = physicalTarget(full);
    if ((!within(full, ws) && !within(full, home)) || (!within(target, realWs) && !within(target, realHome))) problem("ACCESS_DENIED", "Path is outside the workspace and permitted home directory");
    if (kind === "write") {
      if ((!within(full, ws) || !within(target, realWs)) && opts.workspaceConfigStore && opts.workspaceConfigStore.getAccessMode(ws) !== "write_external") {
        problem("ACCESS_DENIED", "workspace access denied: write_external required to edit files outside the workspace");
      }
      try { if (fs.lstatSync(full).isSymbolicLink()) problem("UNSAFE_PATH", "Writing through a file symlink is not supported"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    return full;
  }
  function readText(file, requested) {
    const stat = fs.statSync(file);
    if (!stat.isFile()) problem("NOT_A_FILE", "Path is not a regular file");
    if (stat.size > MAX_FILE_BYTES) problem("FILE_TOO_LARGE", "Text operations support files up to 16 MiB; split or inspect a smaller source file");
    const buffer = fs.readFileSync(file);
    if (buffer.length > MAX_FILE_BYTES) problem("FILE_TOO_LARGE", "File grew beyond the text operation limit");
    return { ...decode(buffer, requested), stat };
  }
  function page(data, args, extras = {}, contentLimit = Number.MAX_SAFE_INTEGER) {
    const max = integer(args.maxChars, DEFAULT_JSON, 1024, MAX_JSON, "maxChars");
    const start = integer(args.startLine, 1, 1, Number.MAX_SAFE_INTEGER, "startLine");
    const end = integer(args.endLine, data.lines.length || start, start, Number.MAX_SAFE_INTEGER, "endLine");
    const column = integer(args.startColumn, 1, 1, Number.MAX_SAFE_INTEGER, "startColumn");
    let firstOffset = 0, points = 1;
    for (const character of data.lines[start - 1] || "") { if (points === column) break; firstOffset += character.length; points++; }
    if (data.lines[start - 1] && column > points) problem("INVALID_ARGUMENT", "startColumn is past the selected line");
    let wanted = "";
    for (let index = start - 1; index < Math.min(end, data.lines.length) && wanted.length <= max; index++) {
      wanted += (index === start - 1 ? data.lines[index].slice(firstOffset) : data.lines[index]).slice(0, max + 2 - wanted.length);
    }
    function result(content) {
      let index = start - 1, offset = firstOffset, remaining = content.length, last = null;
      while (remaining > 0 && index < data.lines.length) {
        last = index + 1;
        const available = data.lines[index].length - offset;
        if (remaining >= available) { remaining -= available; index++; offset = 0; }
        else { offset += remaining; remaining = 0; }
      }
      const nextLine = index < data.lines.length ? index + 1 : null;
      return { ok: true, content, size: data.stat.size, totalSize: data.stat.size, encoding: data.encoding, bom: data.bom,
        bomEncoding: data.bomEncoding, startLine: start, startColumn: column, endLine: last, totalLines: data.lines.length,
        nextLine, nextColumn: nextLine === null ? null : Array.from(data.lines[index].slice(0, offset)).length + 1,
        truncated: nextLine !== null, ...extras };
    }
    let low = 0, high = Math.min(wanted.length, contentLimit), best = result("");
    while (low <= high) {
      const mid = Math.floor((low + high) / 2), candidate = result(unicodePrefix(wanted, mid));
      if (fits(candidate, max)) { best = candidate; low = mid + 1; } else high = mid - 1;
    }
    if (!fits(best, max)) problem("OUTPUT_LIMIT", "Metadata exceeds the requested output limit");
    return best;
  }

  async function read(args = {}) {
    try {
      const full = resolve(args.path), stat = fs.statSync(full);
      if (stat.isDirectory()) {
        const max = integer(args.maxChars, DEFAULT_JSON, 1024, MAX_JSON, "maxChars");
        const entries = fs.readdirSync(full, { withFileTypes: true });
        const result = { ok: true, directory: true, entries: [], totalEntries: entries.length, truncated: false };
        for (const entry of entries) {
          const item = { name: entry.name, type: entry.isSymbolicLink() ? "symlink" : entry.isDirectory() ? "directory" : "file" };
          if (!fits({ ...result, entries: [...result.entries, item], truncated: true }, max)) { result.truncated = true; break; }
          result.entries.push(item);
        }
        return result;
      }
      return page(readText(full, args.encoding), args);
    } catch (error) { return failure(error); }
  }

  async function budgetedRead(args = {}) {
    try {
      const tokens = integer(args.budgetTokens, 4000, 1, 100000, "budgetTokens");
      const full = resolve(args.path), data = readText(full, args.encoding);
      const range = args.startLine !== undefined || args.endLine !== undefined || args.startColumn !== undefined;
      const max = integer(args.maxChars, DEFAULT_JSON, 1024, MAX_JSON, "maxChars");
      if (range || data.text.length <= tokens * 4) {
        const result = page(data, { ...args, maxChars: max }, { mode: "range", budgetTokens: tokens, budgetUsed: tokens }, tokens * 4);
        return { ...result, budgetUsed: Math.ceil(result.content.length / 4) };
      }
      const headers = [];
      for (let i = 0; i < data.lines.length; i++) {
        if (/^(#{1,6}\s|\/\/\s*={3,}|(?:export\s+)?(?:async\s+)?function\s+\w|(?:export\s+)?class\s+\w|(?:export\s+)?(?:const|let|var)\s+\w+\s*=)/.test(data.lines[i])) headers.push(`L${i + 1}: ${data.lines[i].replace(/[\r\n]+$/, "")}`);
      }
      if (!headers.length) {
        const result = page(data, { ...args, maxChars: max }, { mode: "range", budgetTokens: tokens, budgetUsed: tokens }, tokens * 4);
        return { ...result, budgetUsed: Math.ceil(result.content.length / 4) };
      }
      const base = { ok: true, mode: "structure", truncated: true, sections: headers.length, totalLines: data.lines.length,
        size: data.stat.size, encoding: data.encoding, bom: data.bom, nextLine: null, nextColumn: null,
        budgetTokens: tokens, budgetUsed: tokens, hint: "Use startLine/endLine for a contiguous range and resumable pagination." };
      const content = boundedContent(base, unicodePrefix(headers.join("\n"), tokens * 4), max);
      return { ...base, content, budgetUsed: Math.ceil(content.length / 4) };
    } catch (error) { return failure(error); }
  }

  function snapshot(file) {
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile()) problem("NOT_A_FILE", "Path is not a regular file");
      if (stat.size > MAX_FILE_BYTES) problem("FILE_TOO_LARGE", "Atomic overwrite/edit supports existing files up to 16 MiB; append does not read the whole file");
      fs.accessSync(file, fs.constants.W_OK);
      return { buffer: fs.readFileSync(file), mode: stat.mode & 0o777, ino: stat.ino, dev: stat.dev };
    }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }
  function unchanged(file, original) {
    resolve(file, "write");
    const current = snapshot(file);
    if (original === null ? current !== null : !current || current.ino !== original.ino || current.dev !== original.dev || !current.buffer.equals(original.buffer)) problem("FILE_CHANGED", "File changed during preparation; nothing further was written");
  }
  function stage(file, bytes, mode) {
    const temporary = path.join(path.dirname(file), `.cb-fileops-${randomUUID()}.tmp`);
    let fd;
    try {
      fd = fs.openSync(temporary, "wx", mode === undefined ? 0o666 : mode);
      let offset = 0;
      while (offset < bytes.length) { const count = fs.writeSync(fd, bytes, offset, bytes.length - offset); if (!count) problem("WRITE_FAILED", "Could not complete staged write"); offset += count; }
      fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      return temporary;
    } catch (error) { if (fd !== undefined) fs.closeSync(fd); fs.rmSync(temporary, { force: true }); throw error; }
  }

  async function write(args = {}) {
    let temporary;
    try {
      if (typeof args.content !== "string") problem("INVALID_ARGUMENT", "content must be a string");
      const append = boolean(args.append, false, "append"), full = resolve(args.path, "write");
      if (boolean(args.createDirs, true, "createDirs")) fs.mkdirSync(path.dirname(full), { recursive: true });
      resolve(full, "write");
      if (Buffer.byteLength(args.content, "utf8") > MAX_FILE_BYTES) problem("FILE_TOO_LARGE", "Writes support up to 16 MiB per call");
      if (append) {
        const stat = fs.existsSync(full) ? fs.statSync(full) : null;
        if (stat && !stat.isFile()) problem("NOT_A_FILE", "Path is not a regular file");
        const prefix = Buffer.alloc(4);
        if (stat) { const fd = fs.openSync(full, "r"); try { fs.readSync(fd, prefix, 0, 4, 0); } finally { fs.closeSync(fd); } }
        const info = detect(prefix, args.encoding), bytes = encode(args.content, info.encoding);
        resolve(full, "write");
        const fd = fs.openSync(full, "a");
        let count = 0;
        try { count = fs.writeSync(fd, bytes); if (count !== bytes.length) problem("PARTIAL_APPEND", "Filesystem performed a partial append; inspect bytesWritten before retrying"); fs.fsyncSync(fd); }
        catch (error) { return failure(error, { bytesWritten: count, partial: count > 0 }); }
        finally { fs.closeSync(fd); }
        return { ok: true, path: full, mode: "append", size: fs.statSync(full).size, bytesWritten: count, encoding: info.encoding };
      }
      const original = snapshot(full), encoding = normalizedEncoding(args.encoding || "utf8"), bytes = encode(args.content, encoding);
      temporary = stage(full, bytes, original?.mode);
      unchanged(full, original);
      fs.renameSync(temporary, full); temporary = undefined;
      return { ok: true, path: full, mode: "write", size: bytes.length, bytesWritten: bytes.length, encoding };
    } catch (error) { return failure(error); }
    finally { if (temporary) fs.rmSync(temporary, { force: true }); }
  }

  function glob(pattern) {
    let regex = "";
    for (let i = 0; i < pattern.length; i++) {
      const char = pattern[i];
      if (char === "*" && pattern[i + 1] === "*") {
        i++;
        if (pattern[i + 1] === "/") { i++; regex += "(?:.*/)?"; } else regex += ".*";
      } else if (char === "*") regex += "[^/]*";
      else if (char === "?") regex += "[^/]";
      else regex += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    return regex;
  }
  async function search(args = {}) {
    try {
      const base = resolve(args.path || workspace()), stat = fs.statSync(base);
      if (!stat.isFile() && !stat.isDirectory()) problem("NOT_A_FILE", "Search path must be a regular file or directory");
      const limit = integer(args.limit, 20, 1, 100, "limit");
      const caseSensitive = boolean(args.caseSensitive, true, "caseSensitive");
      const includeIgnored = boolean(args.includeIgnored, false, "includeIgnored");
      if (args.pattern !== undefined && (typeof args.pattern !== "string" || args.pattern.length > 500)) problem("INVALID_ARGUMENT", "pattern must be a glob of at most 500 characters");
      if (args.content !== undefined && (typeof args.content !== "string" || !args.content || args.content.length > 10000)) problem("INVALID_ARGUMENT", "content must be nonempty literal text of at most 10000 characters");
      const pattern = args.pattern ? new RegExp(`^${glob(args.pattern.replace(/\\/g, "/"))}$`, "i") : null;
      const needle = caseSensitive ? args.content : args.content?.toLowerCase();
      const root = stat.isFile() ? path.dirname(base) : base;
      const result = { ok: true, results: [], count: 0, scannedFiles: 0, skippedFiles: 0, truncated: false, caseSensitive, gitignoreMode: includeIgnored ? "disabled" : "basic", warnings: [] };
      let visited = 0, nodes = 0, scannedBytes = 0, stop = false;
      const mandatory = new Set([".git", "node_modules"]);
      const generated = new Set(["dist", "build", "out", "coverage", ".next", ".nuxt", "vendor", "target"]);
      function rulesAt(dir) {
        if (includeIgnored) return [];
        const file = path.join(dir, ".gitignore");
        if (!fs.existsSync(file)) return [];
        try {
          resolve(file);
          if (fs.statSync(file).size > 65536) { result.warnings.push("A .gitignore exceeds 64 KiB and was skipped"); return []; }
          return fs.readFileSync(file, "utf8").split(/\r?\n/).slice(0, 1000).filter(line => line && !line.startsWith("#")).map(line => {
            const negative = line.startsWith("!");
            let value = negative ? line.slice(1) : line;
            const directory = value.endsWith("/"); value = value.replace(/\/$/, "");
            const anchored = value.startsWith("/"); value = value.replace(/^\//, "");
            return { base: dir, negative, directory, regex: new RegExp(`${!anchored && !value.includes("/") ? "(?:^|/)" : "^"}${glob(value)}(?:/.*)?$`) };
          });
        } catch { result.warnings.push("A .gitignore could not be read"); return []; }
      }
      function ignored(file, entry, rules) {
        if (mandatory.has(entry.name)) return true;
        if (includeIgnored) return false;
        if (entry.name.startsWith(".") || (entry.isDirectory() && generated.has(entry.name))) return true;
        let excluded = false;
        for (const rule of rules) {
          const relative = slash(path.relative(rule.base, file));
          if (!relative.startsWith("../") && (!rule.directory || entry.isDirectory()) && rule.regex.test(relative)) excluded = !rule.negative;
        }
        return excluded;
      }
      function push(item) {
        const candidate = { ...result, results: [...result.results, item], count: result.count + 1, truncated: true };
        if (result.results.length >= limit || !fits(candidate)) { result.truncated = true; stop = true; return; }
        result.results.push(item); result.count++;
      }
      function inspect(file) {
        if (stop) return;
        if (++visited > 10000) { result.truncated = true; stop = true; return; }
        const relative = slash(path.relative(root, file)), name = path.basename(file);
        if (pattern && !pattern.test(relative) && !pattern.test(name)) return;
        resolve(file);
        result.scannedFiles++;
        if (needle === undefined) { push({ path: relative, fullPath: file, name }); return; }
        const stat = fs.statSync(file);
        if (stat.size > 2 * 1024 * 1024) { result.skippedFiles++; return; }
        if (scannedBytes + stat.size > 32 * 1024 * 1024) { result.truncated = true; stop = true; return; }
        scannedBytes += stat.size;
        let data;
        try { data = readText(file); } catch (error) { if (["BINARY_FILE", "INVALID_ENCODING", "FILE_TOO_LARGE"].includes(error.code)) { result.skippedFiles++; return; } throw error; }
        for (let i = 0; i < data.lines.length && !stop; i++) {
          const line = data.lines[i].replace(/[\r\n]+$/, "");
          const position = (caseSensitive ? line : line.toLowerCase()).indexOf(needle);
          if (position < 0) continue;
          const points = Array.from(line), column = Array.from(line.slice(0, position)).length;
          const snippetStart = Math.max(0, column - 60), snippet = points.slice(snippetStart, snippetStart + 240).join("");
          push({ path: relative, fullPath: file, name, line: i + 1, column: column + 1, snippet, snippetStartColumn: snippetStart + 1, snippetTruncated: snippetStart > 0 || snippetStart + 240 < points.length });
        }
      }
      function walk(dir, depth, inherited) {
        if (stop) return;
        if (depth > 30) { result.truncated = true; return; }
        const rules = [...inherited, ...rulesAt(dir)];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (stop) break;
          if (++nodes > 20000) { result.truncated = true; stop = true; break; }
          const file = path.join(dir, entry.name);
          if (entry.isSymbolicLink()) { result.skippedFiles++; continue; }
          if (ignored(file, entry, rules)) continue;
          resolve(file);
          if (entry.isDirectory()) walk(file, depth + 1, rules);
          else if (entry.isFile()) inspect(file);
        }
      }
      if (stat.isFile()) inspect(base);
      else {
        const inherited = [];
        const ws = workspace();
        if (within(base, ws) && base !== ws) {
          let ancestor = ws;
          while (ancestor !== base) {
            inherited.push(...rulesAt(ancestor));
            const next = path.relative(ancestor, base).split(path.sep)[0];
            ancestor = path.join(ancestor, next);
          }
        }
        walk(base, 0, inherited);
      }
      result.warnings = result.warnings.slice(0, 5);
      while (!fits(result) && result.results.length) { result.results.pop(); result.count--; result.truncated = true; }
      return result;
    } catch (error) { return failure(error); }
  }

  // Search and edit share this resolver, encoding layer and atomic publisher.
  return { workspace, resolve, readText, page, read, budgetedRead, write, search, snapshot, unchanged, stage };
}

module.exports = { createFileOps, failure, problem, fits, encode, lineParts, unicodePrefix, MAX_FILE_BYTES, MAX_JSON, slash, within };
