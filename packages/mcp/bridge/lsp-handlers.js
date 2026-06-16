"use strict";

/**
 * LSP Integration Handlers (MiMo-inspired)
 * Language Server Protocol for semantic code navigation:
 * goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol,
 * goToImplementation, prepareCallHierarchy, incomingCalls, outgoingCalls.
 *
 * NOTE: LSP requires a running language server process per language.
 * This handler provides the MCP interface; actual LSP communication
 * is delegated to the LSP server manager in the main process.
 */

const path = require("path");
const fs = require("fs");

function createLSPHandlers(opts) {
  // Language server registry: language → { pid, capabilities }
  const lspServers = new Map();

  function detectLanguage(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const map = {
      ".ts": "typescript", ".tsx": "typescript", ".js": "javascript", ".jsx": "javascript",
      ".py": "python", ".rs": "rust", ".go": "go", ".java": "java", ".c": "c", ".cpp": "cpp",
      ".h": "c", ".hpp": "cpp", ".cs": "csharp", ".rb": "ruby", ".php": "php", ".lua": "lua",
      ".sh": "bash", ".json": "json", ".yaml": "yaml", ".yml": "yaml", ".md": "markdown",
    };
    return map[ext] || null;
  }

  async function lspRequest(method, params) {
    // For now, return a structured response indicating LSP is not yet connected.
    // Full LSP integration requires spawning language servers from the main process.
    return { ok: false, error: `LSP not connected. Use lsp_start first. Method: ${method}`, method, params };
  }

  return {
    /** Start a language server for a given language/workspace. */
    async lspStart({ language, workspace }) {
      try {
        if (lspServers.has(language)) return { ok: true, message: `${language} LSP already running`, server: lspServers.get(language) };
        // Detect available LSP servers
        const servers = {
          typescript: { cmd: "typescript-language-server", args: ["--stdio"] },
          javascript: { cmd: "typescript-language-server", args: ["--stdio"] },
          python: { cmd: "pyright-langserver", args: ["--stdio"] },
          rust: { cmd: "rust-analyzer" },
          go: { cmd: "gopls" },
        };
        const serverConfig = servers[language];
        if (!serverConfig) return { ok: false, error: `No LSP server configured for language: ${language}` };
        // Store config (actual process spawning deferred to main process integration)
        const info = { language, config: serverConfig, workspace, status: "configured", startedAt: Date.now() };
        lspServers.set(language, info);
        return { ok: true, message: `LSP configured for ${language}. Actual server process will be started by main process.`, server: info };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Stop a language server. */
    async lspStop({ language }) {
      try {
        if (!lspServers.has(language)) return { ok: true, message: `${language} LSP not running` };
        lspServers.delete(language);
        return { ok: true, message: `${language} LSP stopped` };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** List running language servers. */
    async lspServers() {
      try {
        const servers = [];
        for (const [lang, info] of lspServers) servers.push({ language: lang, ...info });
        return { ok: true, data: servers };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Go to definition of a symbol. */
    async lspGoToDefinition({ file, line, character }) {
      try {
        if (!fs.existsSync(file)) return { ok: false, error: `File not found: ${file}` };
        const lang = detectLanguage(file);
        if (!lang) return { ok: false, error: `Cannot detect language for ${file}` };
        if (!lspServers.has(lang)) return { ok: false, error: `Start ${lang} LSP first with lsp_start` };
        return await lspRequest("textDocument/definition", { textDocument: { uri: `file://${file}` }, position: { line, character } });
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Find all references to a symbol. */
    async lspFindReferences({ file, line, character }) {
      try {
        const lang = detectLanguage(file);
        if (!lang || !lspServers.has(lang)) return { ok: false, error: `LSP not available for ${file}` };
        return await lspRequest("textDocument/references", { textDocument: { uri: `file://${file}` }, position: { line, character }, context: { includeDeclaration: true } });
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Hover info (type, docs) for a symbol. */
    async lspHover({ file, line, character }) {
      try {
        const lang = detectLanguage(file);
        if (!lang || !lspServers.has(lang)) return { ok: false, error: `LSP not available for ${file}` };
        return await lspRequest("textDocument/hover", { textDocument: { uri: `file://${file}` }, position: { line, character } });
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Get document symbols (outline) for a file. */
    async lspDocumentSymbol({ file }) {
      try {
        const lang = detectLanguage(file);
        if (!lang || !lspServers.has(lang)) return { ok: false, error: `LSP not available for ${file}` };
        return await lspRequest("textDocument/documentSymbol", { textDocument: { uri: `file://${file}` } });
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Search for symbols across the workspace. */
    async lspWorkspaceSymbol({ query }) {
      try {
        return await lspRequest("workspace/symbol", { query });
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Go to implementation of a symbol. */
    async lspGoToImplementation({ file, line, character }) {
      try {
        const lang = detectLanguage(file);
        if (!lang || !lspServers.has(lang)) return { ok: false, error: `LSP not available for ${file}` };
        return await lspRequest("textDocument/implementation", { textDocument: { uri: `file://${file}` }, position: { line, character } });
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Prepare call hierarchy for a symbol. */
    async lspPrepareCallHierarchy({ file, line, character }) {
      try {
        const lang = detectLanguage(file);
        if (!lang || !lspServers.has(lang)) return { ok: false, error: `LSP not available for ${file}` };
        return await lspRequest("textDocument/prepareCallHierarchy", { textDocument: { uri: `file://${file}` }, position: { line, character } });
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Get incoming calls to a function. */
    async lspIncomingCalls({ file, line, character }) {
      try {
        const lang = detectLanguage(file);
        if (!lang || !lspServers.has(lang)) return { ok: false, error: `LSP not available for ${file}` };
        return await lspRequest("callHierarchy/incomingCalls", { item: { uri: `file://${file}`, range: { start: { line, character }, end: { line, character } } } });
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Get outgoing calls from a function. */
    async lspOutgoingCalls({ file, line, character }) {
      try {
        const lang = detectLanguage(file);
        if (!lang || !lspServers.has(lang)) return { ok: false, error: `LSP not available for ${file}` };
        return await lspRequest("callHierarchy/outgoingCalls", { item: { uri: `file://${file}`, range: { start: { line, character }, end: { line, character } } } });
      } catch (e) { return { ok: false, error: e.message }; }
    },
  };
}

module.exports = { createLSPHandlers };
