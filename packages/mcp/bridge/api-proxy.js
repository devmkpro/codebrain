"use strict";

/**
 * API Proxy — Transparent HTTP proxy that intercepts API calls from agent CLIs,
 * extracts token usage from responses, and reports to the CostTracker.
 *
 * Supports:
 * - Anthropic Messages API (non-streaming + streaming SSE)
 * - Google Gemini API (streaming + non-streaming, via generateContent)
 * - MIMO (Anthropic-compatible)
 *
 * How it works:
 * 1. Agent CLI is configured with ANTHROPIC_BASE_URL or GEMINI_BASE_URL
 *    pointing to http://127.0.0.1:<port>
 * 2. CLI sends API requests to the proxy instead of the real API
 * 3. Proxy detects provider format from URL path
 * 4. Forwards to the real API endpoint
 * 5. Extracts usage data from responses and reports via callback
 */

const http = require("http");
const https = require("https");
const { URL } = require("url");

const LOG_PREFIX = "[API Proxy]";

/**
 * @typedef {Object} TokenUsage
 * @property {string} paneId
 * @property {string} model
 * @property {number} inputTokens
 * @property {number} outputTokens
 */

/**
 * @typedef {Object} ApiProxyOptions
 * @property {function(TokenUsage): void} onTokenUsage - Called when token usage is detected
 * @property {string} [anthropicTargetUrl] - Real Anthropic API URL
 * @property {string} [geminiTargetUrl] - Real Gemini API URL
 * @property {number} [port=0] - Port to listen on (0 = random)
 */

class ApiProxy {
  /**
   * @param {ApiProxyOptions} opts
   */
  constructor(opts = {}) {
    this.onTokenUsage = opts.onTokenUsage || (() => {});
    // Default fallback target (used when no token-specific route is registered)
    this._defaultAnthropicTarget = opts.anthropicTargetUrl || "https://api.anthropic.com";
    this.geminiTargetUrl = opts.geminiTargetUrl || null;
    this.requestedPort = opts.port || 0;
    this.server = null;
    this.port = null;
    this.url = null;
    // Per-token routing: Map<tokenPrefix(20 chars), targetUrl>
    // Eliminates the shared-state race condition when multiple panes use different providers.
    this._tokenTargetMap = new Map();
    // Fallback for OAuth users (no stable token key)
    this._oauthTarget = null;
    // Stores thoughtSignature from Gemini response parts, keyed by tool call ID.
    this._thoughtSignatures = new Map();
  }

  /**
   * Start the proxy server.
   * @returns {Promise<{port: number, url: string}>}
   */
  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this._handleRequest(req, res));

      this.server.on("error", (err) => {
        console.error(`${LOG_PREFIX} Server error:`, err.message);
        reject(err);
      });

      this.server.listen(this.requestedPort, "127.0.0.1", () => {
        const addr = this.server.address();
        this.port = addr.port;
        this.url = `http://127.0.0.1:${this.port}`;
        console.log(`${LOG_PREFIX} Started on port ${this.port}`);
        resolve({ port: this.port, url: this.url });
      });
    });
  }

  /**
   * Stop the proxy server.
   * @returns {Promise<void>}
   */
  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log(`${LOG_PREFIX} Stopped`);
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Register a per-token Anthropic target URL.
   * Replaces the shared setTargetUrl() to avoid race conditions when multiple
   * panes use different Anthropic-compatible providers simultaneously.
   *
   * @param {string|null} tokenOrKey - API key or auth token (null = OAuth user)
   * @param {string} targetUrl - Real API base URL for this token
   */
  registerAnthropicTarget(tokenOrKey, targetUrl) {
    if (!targetUrl) return;
    if (tokenOrKey) {
      const prefix = String(tokenOrKey).slice(0, 20);
      const prev = this._tokenTargetMap.get(prefix);
      if (prev !== targetUrl) {
        console.log(`${LOG_PREFIX} Registered Anthropic route: [${prefix}...] → ${targetUrl}`);
        this._tokenTargetMap.set(prefix, targetUrl);
      }
    } else {
      // OAuth users: no stable token, use a shared OAuth slot
      if (this._oauthTarget !== targetUrl) {
        console.log(`${LOG_PREFIX} Registered Anthropic OAuth route → ${targetUrl}`);
        this._oauthTarget = targetUrl;
      }
    }
  }

  /**
   * Resolve the Anthropic target URL for an incoming request.
   * Looks up by auth header prefix, falling back to OAuth slot or default.
   * @param {http.IncomingMessage} req
   * @returns {string}
   */
  _resolveAnthropicTarget(req) {
    const auth = req.headers["x-api-key"] || req.headers["authorization"] || "";
    const token = auth.replace(/^Bearer /i, "").trim();
    if (token) {
      const prefix = token.slice(0, 20);
      if (this._tokenTargetMap.has(prefix)) return this._tokenTargetMap.get(prefix);
    }
    // OAuth or unknown token: use OAuth slot or default
    return this._oauthTarget || this._defaultAnthropicTarget;
  }

  /**
   * @deprecated Use registerAnthropicTarget() instead.
   * Kept for backward compatibility — sets the default fallback target only.
   */
  setTargetUrl(url) {
    if (url) {
      console.log(`${LOG_PREFIX} setTargetUrl (deprecated, sets default): ${url}`);
      this._defaultAnthropicTarget = url;
    }
  }

  /** @deprecated Use constructor opts instead. */
  get anthropicTargetUrl() { return this._defaultAnthropicTarget; }
  set anthropicTargetUrl(v) { this._defaultAnthropicTarget = v; }

  /**
   * Update the Gemini target URL.
   * @param {string} url
   */
  setGeminiTargetUrl(url) {
    if (url && url !== this.geminiTargetUrl) {
      console.log(`${LOG_PREFIX} Gemini target: ${this.geminiTargetUrl || '(none)'} → ${url}`);
      this.geminiTargetUrl = url;
    }
  }

  /**
   * Detect if a request URL path is for Gemini API.
   * Gemini URLs look like: /v1beta/models/{model}:generateContent or :streamGenerateContent
   * @param {string} urlPath
   * @returns {boolean}
   */
  _isGeminiRequest(urlPath) {
    return /\/models\/.*:(generateContent|streamGenerateContent|countTokens)/.test(urlPath);
  }

  /**
   * Detect if a request is OpenAI-compatible (used by OpenClaude's Gemini adapter).
   * @param {string} urlPath
   * @returns {boolean}
   */
  _isOpenAIRequest(urlPath) {
    return /^\/?v1\/(models|chat\/completions|completions|embeddings)/.test(urlPath) || /^\/chat\/completions/.test(urlPath);
  }

  /**
   * Handle OpenAI-compatible /v1/chat/completions from Gemini adapter.
   * Translates OpenAI format → Gemini native format, forwards to Gemini API,
   * and translates the response back to OpenAI format.
   */
  _handleOpenAIChatProxy(req, res) {
    const bodyChunks = [];
    req.on("data", (chunk) => bodyChunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(bodyChunks);

      let openaiReq = {};
      try { openaiReq = JSON.parse(body.toString()); } catch {}

      const model = openaiReq.model || "gemini-2.5-flash";
      const isStreaming = openaiReq.stream === true;

      // Translate OpenAI → Gemini native format
      const geminiBody = this._openaiToGeminiRequest(openaiReq);

      // Build Gemini API URL: /v1beta/models/{model}:generateContent or :streamGenerateContent
      const action = isStreaming ? "streamGenerateContent" : "generateContent";
      const querySuffix = isStreaming ? "?alt=sse" : "";
      const geminiPath = `/v1beta/models/${model}:${action}${querySuffix}`;

      // Extract API key from Authorization: Bearer <key>
      const headers = { ...req.headers };
      delete headers["host"];
      delete headers["content-length"]; // Will be recalculated
      const authHeader = headers["authorization"] || "";
      let apiKey = "";
      if (authHeader.startsWith("Bearer ")) {
        apiKey = authHeader.slice(7);
        delete headers["authorization"];
        headers["x-goog-api-key"] = apiKey;
        headers["content-type"] = "application/json";
      }

      const geminiBodyStr = JSON.stringify(geminiBody);
      headers["content-length"] = Buffer.byteLength(geminiBodyStr);

      // Use configured Gemini target URL (supports custom endpoints like regional clusters)
      const geminiTarget = new URL(this.geminiTargetUrl || "https://generativelanguage.googleapis.com");
      const options = {
        hostname: geminiTarget.hostname,
        port: geminiTarget.port || 443,
        path: geminiPath,
        method: "POST",
        headers,
      };

      console.log(`${LOG_PREFIX}   OpenAI→Gemini: ${geminiPath} (model=${model}, stream=${isStreaming}, msgs=${openaiReq.messages?.length || 0}, tools=${openaiReq.tools?.length || 0})`);

      const proxyReq = https.request(options, (proxyRes) => {
        console.log(`${LOG_PREFIX}   OpenAI→Gemini ← ${proxyRes.statusCode} ${proxyRes.statusMessage}`);
        if (proxyRes.statusCode === 401 || proxyRes.statusCode === 403) {
          console.warn(`${LOG_PREFIX}   ⚠ Auth error! key=${apiKey.slice(0, 10)}...`);
        }
        // On error status, capture and log the error body
        if (proxyRes.statusCode >= 400) {
          const errChunks = [];
          proxyRes.on("data", (c) => errChunks.push(c));
          proxyRes.on("end", () => {
            const errBody = Buffer.concat(errChunks).toString();
            console.error(`${LOG_PREFIX}   ⚠ Gemini error ${proxyRes.statusCode}: ${errBody.slice(0, 1000)}`);
            // Forward error to client
            res.writeHead(proxyRes.statusCode, { "Content-Type": proxyRes.headers["content-type"] || "application/json" });
            res.end(errBody);
          });
          return;
        }
        if (isStreaming) {
          this._handleGeminiToOpenAIStream(proxyRes, res, model);
        } else {
          this._handleGeminiToOpenAIJson(proxyRes, res, model);
        }
      });

      proxyReq.on("error", (err) => {
        console.error(`${LOG_PREFIX} OpenAI→Gemini error:`, err.message);
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { type: "proxy_error", message: err.message } }));
      });

      proxyReq.write(geminiBodyStr);
      proxyReq.end();
    });
  }

  /**
   * Convert OpenAI chat completion request to Gemini generateContent format.
   *
   * Key Gemini constraints:
   * - Roles are strictly "user" or "model" (not "assistant" or "tool")
   * - Consecutive same-role messages must be merged into a single content block
   * - functionResponse parts go inside "user" content blocks
   * - Empty content blocks are not allowed
   */
  _openaiToGeminiRequest(openaiReq) {
    const contents = [];
    let systemInstruction = undefined;

    for (const msg of openaiReq.messages || []) {
      if (msg.role === "system") {
        systemInstruction = { parts: [{ text: msg.content || "" }] };
        continue;
      }

      const role = msg.role === "assistant" ? "model" : "user";
      const parts = [];

      // Handle tool_calls in assistant messages (OpenAI format)
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (tc.function) {
            let args = {};
            try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
            const part = { functionCall: { name: tc.function.name, args } };
            // Re-inject thoughtSignature at the PART level (Gemini 3 requirement)
            // Check both our stored map and the extra_content.google.thought_signature
            // that OpenAI-compatible format uses
            const sig = this._thoughtSignatures.get(tc.id) ||
                        tc.extra_content?.google?.thought_signature;
            if (sig) {
              part.thoughtSignature = sig;
              this._thoughtSignatures.delete(tc.id);
              console.log(`${LOG_PREFIX}   ✓ Re-injected thoughtSignature for "${tc.function.name}"`);
            }
            parts.push(part);
          }
        }
      }

      // Handle tool role messages (tool results)
      if (msg.role === "tool") {
        parts.push({
          functionResponse: {
            name: msg.name || "unknown",
            response: { result: msg.content || "" },
          },
        });
      } else {
        // Text content
        if (typeof msg.content === "string" && msg.content) {
          parts.push({ text: msg.content });
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === "text" && part.text) parts.push({ text: part.text });
          }
        }
        // Also handle null content on assistant messages with tool_calls
        // (functionCall parts already added above)
      }

      if (parts.length === 0) continue; // Skip empty messages

      // Merge with previous content block if same role (Gemini requires role alternation)
      const lastContent = contents.length > 0 ? contents[contents.length - 1] : null;
      if (lastContent && lastContent.role === role) {
        lastContent.parts.push(...parts);
      } else {
        contents.push({ role, parts });
      }
    }

    // Validate: ensure we have at least one content block
    if (contents.length === 0) {
      contents.push({ role: "user", parts: [{ text: " " }] });
    }

    const generationConfig = {};
    if (openaiReq.temperature !== undefined) generationConfig.temperature = openaiReq.temperature;
    if (openaiReq.max_tokens !== undefined) generationConfig.maxOutputTokens = openaiReq.max_tokens;
    if (openaiReq.top_p !== undefined) generationConfig.topP = openaiReq.top_p;

    const geminiReq = { contents, generationConfig };
    if (systemInstruction) geminiReq.systemInstruction = systemInstruction;

    // Translate OpenAI tools → Gemini functionDeclarations
    if (openaiReq.tools && openaiReq.tools.length > 0) {
      const functionDeclarations = [];
      for (const tool of openaiReq.tools) {
        if (tool.type === "function" && tool.function) {
          const declaration = {
            name: tool.function.name,
            description: tool.function.description || "",
          };
          // Clean schema for Gemini compatibility
          if (tool.function.parameters) {
            declaration.parameters = this._cleanSchemaForGemini(tool.function.parameters);
          }
          functionDeclarations.push(declaration);
        }
      }
      if (functionDeclarations.length > 0) {
        geminiReq.tools = [{ functionDeclarations }];
      }
    }

    return geminiReq;
  }

  /**
   * Clean an OpenAI JSON Schema for Gemini compatibility.
   * Gemini only supports a subset of JSON Schema keywords. This function
   * strips all unsupported keywords recursively while preserving supported ones.
   *
   * Gemini-supported keywords:
   *   type, description, properties, required, enum, items (single schema),
   *   minimum, maximum, minLength, maxLength, minItems, maxItems, format, nullable
   *
   * Everything else is stripped to avoid 400 "Unknown name" errors.
   */
  _cleanSchemaForGemini(schema) {
    if (!schema || typeof schema !== "object") return schema;
    if (Array.isArray(schema)) return schema.map((s) => this._cleanSchemaForGemini(s));

    // Whitelist of keywords Gemini accepts
    const GEMINI_ALLOWED = new Set([
      "type", "description", "properties", "required", "enum",
      "items", "minimum", "maximum", "minLength", "maxLength",
      "minItems", "maxItems", "format", "nullable", "default",
      "example", "title", "pattern",
    ]);

    // Handle oneOf/anyOf/allOf by using the first variant
    for (const combo of ["oneOf", "anyOf", "allOf"]) {
      if (schema[combo] && Array.isArray(schema[combo]) && schema[combo].length > 0) {
        return this._cleanSchemaForGemini(schema[combo][0]);
      }
    }

    const cleaned = {};
    for (const [key, value] of Object.entries(schema)) {
      if (!GEMINI_ALLOWED.has(key)) continue;
      if (key === "properties" && typeof value === "object" && value !== null) {
        cleaned.properties = {};
        for (const [propName, propSchema] of Object.entries(value)) {
          cleaned.properties[propName] = this._cleanSchemaForGemini(propSchema);
        }
      } else if (key === "items" && typeof value === "object") {
        cleaned.items = this._cleanSchemaForGemini(value);
      } else {
        cleaned[key] = value;
      }
    }
    return cleaned;
  }

  /**
   * Handle non-streaming Gemini response → convert to OpenAI format.
   */
  _handleGeminiToOpenAIJson(proxyRes, res, model) {
    const chunks = [];
    proxyRes.on("data", (chunk) => chunks.push(chunk));
    proxyRes.on("end", () => {
      const body = Buffer.concat(chunks);
      try {
        const geminiJson = JSON.parse(body.toString());
        const openaiResp = this._geminiToOpenAIResponse(geminiJson, model);
        const openaiBody = JSON.stringify(openaiResp);

        // Report token usage
        if (openaiResp.usage) {
          this._report(model, openaiResp.usage.prompt_tokens || 0, openaiResp.usage.completion_tokens || 0);
        }

        res.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(openaiBody) });
        res.end(openaiBody);
      } catch (err) {
        // Forward raw response on parse error
        console.error(`${LOG_PREFIX} Gemini→OpenAI parse error:`, err.message);
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        res.end(body);
      }
    });
  }

  /**
   * Handle streaming Gemini SSE response → convert to OpenAI SSE format.
   * Supports text content and function call (tool_calls) streaming.
   */
  _handleGeminiToOpenAIStream(proxyRes, res, model) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    let inputTokens = 0;
    let outputTokens = 0;
    let sseBuffer = "";
    const chatId = "chatcmpl-" + Date.now().toString(36);
    let callIndex = 0;
    let hasToolCalls = false;
    let finishReason = null;

    proxyRes.on("data", (chunk) => {
      sseBuffer += chunk.toString();
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const jsonStr = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed;
        try {
          const geminiChunk = JSON.parse(jsonStr);

          // Extract usage from the last chunk
          if (geminiChunk.usageMetadata) {
            inputTokens = geminiChunk.usageMetadata.promptTokenCount || inputTokens;
            outputTokens = geminiChunk.usageMetadata.candidatesTokenCount || outputTokens;
          }

          const candidate = geminiChunk.candidates?.[0];
          const parts = candidate?.content?.parts || [];

          for (const part of parts) {

            // Text content
            if (part.text) {
              const openaiChunk = {
                id: chatId,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{ index: 0, delta: { content: part.text }, finish_reason: null }],
              };
              res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
            }

            // Function call — emit as OpenAI tool_calls delta
            if (part.functionCall) {
              hasToolCalls = true;
              const tcId = "call_" + Date.now().toString(36) + "_" + callIndex;

              // Capture thoughtSignature (at PART level, not inside functionCall!)
              // Only the first functionCall in parallel calls has a signature.
              if (part.thoughtSignature) {
                this._thoughtSignatures.set(tcId, part.thoughtSignature);
                console.log(`${LOG_PREFIX}   ✓ Captured thoughtSignature for ${tcId} (${part.functionCall.name})`);
              } else if (callIndex === 0) {
                // First FC but no signature — might be in thought part before this
                console.log(`${LOG_PREFIX}   ⚠ First functionCall has NO thoughtSignature`);
              }

              // First chunk: role + tool call header
              const toolCallDelta = {
                index: callIndex,
                id: tcId,
                type: "function",
                function: {
                  name: part.functionCall.name || "",
                  arguments: "",
                },
              };
              // Include thoughtSignature in OpenAI-compatible format
              // so the CLI preserves it when sending back the conversation
              if (part.thoughtSignature) {
                toolCallDelta.extra_content = {
                  google: { thought_signature: part.thoughtSignature },
                };
              }
              const headerChunk = {
                id: chatId,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{
                  index: 0,
                  delta: {
                    role: "assistant",
                    content: null,
                    tool_calls: [toolCallDelta],
                  },
                  finish_reason: null,
                }],
              };
              res.write(`data: ${JSON.stringify(headerChunk)}\n\n`);

              // Arguments chunk
              const argsStr = JSON.stringify(part.functionCall.args || {});
              const argsChunk = {
                id: chatId,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{
                  index: 0,
                  delta: {
                    tool_calls: [{
                      index: callIndex,
                      function: { arguments: argsStr },
                    }],
                  },
                  finish_reason: null,
                }],
              };
              res.write(`data: ${JSON.stringify(argsChunk)}\n\n`);
              callIndex++;
            }
          }

          // Track finish reason
          if (candidate?.finishReason) {
            const finishMap = { "STOP": "stop", "MAX_TOKENS": "length" };
            finishReason = finishMap[candidate.finishReason] || "stop";
          }
        } catch {}
      }
    });

    proxyRes.on("end", () => {
      // Process remaining buffer
      if (sseBuffer.trim()) {
        const jsonStr = sseBuffer.trim().startsWith("data: ") ? sseBuffer.trim().slice(6) : sseBuffer.trim();
        try {
          const geminiChunk = JSON.parse(jsonStr);
          if (geminiChunk.usageMetadata) {
            inputTokens = geminiChunk.usageMetadata.promptTokenCount || inputTokens;
            outputTokens = geminiChunk.usageMetadata.candidatesTokenCount || outputTokens;
          }
        } catch {}
      }

      // Send finish chunk with appropriate finish_reason
      const finalFinishReason = hasToolCalls ? "tool_calls" : (finishReason || "stop");
      const finishChunk = {
        id: chatId,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, delta: {}, finish_reason: finalFinishReason }],
      };
      res.write(`data: ${JSON.stringify(finishChunk)}\n\n`);

      // Send final usage chunk
      if (inputTokens > 0 || outputTokens > 0) {
        const usageChunk = {
          id: chatId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [],
          usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
        };
        res.write(`data: ${JSON.stringify(usageChunk)}\n\n`);
        this._report(model, inputTokens, outputTokens);
      }
      res.write("data: [DONE]\n\n");
      res.end();
    });
  }

  /**
   * Convert Gemini generateContent response to OpenAI chat completion format.
   * Handles both text responses and function call responses.
   */
  _geminiToOpenAIResponse(geminiResp, model) {
    const candidate = geminiResp.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const finishMap = { "STOP": "stop", "MAX_TOKENS": "length", "SAFETY": "content_filter" };
    const usage = geminiResp.usageMetadata || {};

    // Separate text parts from function call parts
    let textContent = "";
    const toolCalls = [];
    let callIndex = 0;

    for (const part of parts) {
      if (part.text) {
        textContent += part.text;
      }
      if (part.functionCall) {
        const tcId = "call_" + Date.now().toString(36) + "_" + callIndex;
        const fcName = part.functionCall.name || ("fn_" + callIndex);
        // Capture thoughtSignature (at PART level, not inside functionCall!)
        if (part.thoughtSignature) {
          this._thoughtSignatures.set(tcId, part.thoughtSignature);
          console.log(`${LOG_PREFIX}   ✓ Captured thoughtSignature for ${tcId} (${fcName})`);
        }
        const toolCall = {
          id: tcId,
          type: "function",
          function: {
            name: fcName,
            arguments: JSON.stringify(part.functionCall.args || {}),
          },
        };
        // Include thoughtSignature in OpenAI-compatible format
        if (part.thoughtSignature) {
          toolCall.extra_content = {
            google: { thought_signature: part.thoughtSignature },
          };
        }
        toolCalls.push(toolCall);
        callIndex++;
      }
    }

    const hasToolCalls = toolCalls.length > 0;
    const message = { role: "assistant", content: textContent || null };
    if (hasToolCalls) message.tool_calls = toolCalls;

    return {
      id: "chatcmpl-" + Date.now().toString(36),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message,
        finish_reason: hasToolCalls ? "tool_calls" : (finishMap[candidate?.finishReason] || "stop"),
      }],
      usage: {
        prompt_tokens: usage.promptTokenCount || 0,
        completion_tokens: usage.candidatesTokenCount || 0,
        total_tokens: usage.totalTokenCount || 0,
      },
    };
  }

  /**
   * Handle OpenAI-compatible /v1/models health check.
   * Returns a minimal model list so CLI validation passes.
   */
  _handleOpenAIModelsRequest(req, res) {
    const models = [
      "gemini-3.5-flash",
      "gemini-3.1-pro-preview", "gemini-3.1-pro-preview-customtools",
      "gemini-3.1-flash-lite-preview", "gemini-3.1-flash-lite",
      "gemini-3-flash-preview", "gemini-3-pro-preview",
      "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite",
      "gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-2.0-flash-001", "gemini-2.0-flash-lite-001",
      "gemini-flash-latest", "gemini-flash-lite-latest", "gemini-pro-latest",
      "gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts",
      "gemini-2.5-computer-use-preview-10-2025",
      "gemini-3.1-flash-tts-preview",
    ].map(id => ({ id, object: "model", created: Date.now(), owned_by: "google" }));

    const body = JSON.stringify({ object: "list", data: models });
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
    console.log(`${LOG_PREFIX} Served /v1/models health check (${models.length} models)`);
  }

  /**
   * Handle an incoming HTTP request from the agent CLI.
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  _handleRequest(req, res) {
    const isGemini = this._isGeminiRequest(req.url || "");
    const isOpenAI = this._isOpenAIRequest(req.url || "");

    // Diagnostic logging: show what we're receiving and forwarding
    const authHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (/auth|key|token|api/i.test(k)) authHeaders[k] = typeof v === "string" ? v.slice(0, 20) + "..." : "[array]";
    }
    // Check for API key in query params
    const urlObj = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const hasKeyParam = urlObj.searchParams.has("key");
    console.log(`${LOG_PREFIX} → ${req.method} ${req.url} | gemini=${isGemini} | openai=${isOpenAI} | authHeaders=${JSON.stringify(authHeaders)} | keyParam=${hasKeyParam}`);

    // Handle OpenAI-compatible /v1/models health check locally
    if (isOpenAI && /^\/?(v1\/)?models(\?|$)/.test(req.url || "")) {
      this._handleOpenAIModelsRequest(req, res);
      return;
    }

    // Detect OpenAI chat completion requests (from Gemini adapter)
    // CLI sends both /v1/chat/completions and /chat/completions
    const isOpenAIChat = isOpenAI && /^\/?(v1\/)?chat\/completions/.test(req.url || "");

    // For OpenAI-compatible chat completions from the Gemini adapter:
    // Forward to Gemini's OpenAI-compatible endpoint (NOT the native /v1beta path).
    // Also translate auth: Bearer token → x-goog-api-key header.
    if (isOpenAIChat) {
      this._handleOpenAIChatProxy(req, res);
      return;
    }

    // Choose the correct target URL — per-token routing for Anthropic to avoid race conditions
    let targetBaseUrl;
    if (isGemini) {
      targetBaseUrl = this.geminiTargetUrl || "https://generativelanguage.googleapis.com";
    } else {
      targetBaseUrl = this._resolveAnthropicTarget(req);
    }

    const target = new URL(targetBaseUrl);
    const isHttps = target.protocol === "https:";
    const transport = isHttps ? https : http;

    // Preserve base path: e.g. baseUrl="https://mimo.com/anthropic" + req.url="/v1/messages"
    // → path="/anthropic/v1/messages"
    const basePath = target.pathname.replace(/\/+$/, ""); // strip trailing slashes
    const reqPath = req.url || "/";
    const fullPath = basePath + reqPath;

    // Forward all headers (strip host)
    const headers = { ...req.headers };
    delete headers["host"];

    const options = {
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: fullPath,
      method: req.method,
      headers,
    };

    console.log(`${LOG_PREFIX}   Forwarding → ${isHttps ? "https" : "http"}://${options.hostname}:${options.port}${fullPath}`);
    console.log(`${LOG_PREFIX}   Forward headers: ${Object.keys(headers).join(", ")}`);

    // Collect request body
    const bodyChunks = [];
    req.on("data", (chunk) => bodyChunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(bodyChunks);

      // Extract model from request body
      let requestModel = "";
      let bodyIsStreaming = false;
      if (body.length > 0) {
        try {
          const parsed = JSON.parse(body.toString());
          // Anthropic format: { model: "claude-...", stream: true }
          if (parsed.model) requestModel = parsed.model;
          if (parsed.stream === true) bodyIsStreaming = true;
          // Gemini format: { contents: [...], generationConfig: { ... } }
          // Model is in the URL path, not body
        } catch {}
      }

      // For Gemini, extract model from URL path (/v1beta/models/{model}:...)
      if (isGemini && !requestModel) {
        const modelMatch = (req.url || "").match(/\/models\/([^:]+)/);
        if (modelMatch) requestModel = modelMatch[1];
      }

      // Check Accept header for streaming
      const accept = req.headers["accept"] || "";
      if (accept.includes("text/event-stream")) bodyIsStreaming = true;
      // Gemini streaming uses alt=sse query parameter
      if ((req.url || "").includes("alt=sse")) bodyIsStreaming = true;

      // Forward to real API
      const proxyReq = transport.request(options, (proxyRes) => {
        console.log(`${LOG_PREFIX}   ← Response: ${proxyRes.statusCode} ${proxyRes.statusMessage} (model=${requestModel})`);
        if (proxyRes.statusCode === 401 || proxyRes.statusCode === 403) {
          console.warn(`${LOG_PREFIX}   ⚠ Auth error from upstream! Headers sent: ${JSON.stringify(Object.keys(headers))}`);
        }
        if (isGemini) {
          this._handleGeminiResponse(proxyRes, res, requestModel, bodyIsStreaming);
        } else if (bodyIsStreaming) {
          this._handleAnthropicStreamingResponse(proxyRes, res, requestModel);
        } else {
          this._handleAnthropicJsonResponse(proxyRes, res, requestModel);
        }
      });

      proxyReq.on("error", (err) => {
        console.error(`${LOG_PREFIX} Proxy request error:`, err.message);
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { type: "proxy_error", message: err.message } }));
      });

      if (body.length > 0) {
        proxyReq.write(body);
      }
      proxyReq.end();
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Anthropic API handlers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle a non-streaming Anthropic JSON response.
   */
  _handleAnthropicJsonResponse(proxyRes, res, model) {
    const chunks = [];
    proxyRes.on("data", (chunk) => chunks.push(chunk));
    proxyRes.on("end", () => {
      const body = Buffer.concat(chunks);
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      res.end(body);

      try {
        const json = JSON.parse(body.toString());
        this._extractAnthropicUsage(json, model);
        // Log helpful message when MIMO returns "Not supported model"
        if (proxyRes.statusCode === 400) {
          const errMsg = json?.error?.message || json?.message || "";
          if (/not supported model/i.test(errMsg)) {
            console.warn(
              `${LOG_PREFIX} ⚠ Model "${model}" not supported by this MIMO region. ` +
              `Try switching to SGP or CN region in Settings → Providers → MIMO.`
            );
          }
        }
      } catch {}
    });
  }

  /**
   * Handle a streaming Anthropic SSE response.
   */
  _handleAnthropicStreamingResponse(proxyRes, res, model) {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    let accumulated = { inputTokens: 0, outputTokens: 0, model };
    let sseBuffer = "";

    proxyRes.on("data", (chunk) => {
      res.write(chunk);
      sseBuffer += chunk.toString();
      const events = this._parseSseEvents(sseBuffer);
      sseBuffer = events.remaining;
      for (const event of events.parsed) {
        this._processAnthropicSseEvent(event, accumulated);
      }
    });

    proxyRes.on("end", () => {
      res.end();
      // Process remaining buffer
      if (sseBuffer.trim()) {
        const events = this._parseSseEvents(sseBuffer + "\n\n");
        for (const event of events.parsed) {
          this._processAnthropicSseEvent(event, accumulated);
        }
      }
      if (accumulated.inputTokens > 0 || accumulated.outputTokens > 0) {
        this._report(accumulated.model || model, accumulated.inputTokens, accumulated.outputTokens);
      }
    });
  }

  /**
   * Extract token usage from a non-streaming Anthropic response.
   */
  _extractAnthropicUsage(json, model) {
    let inputTokens = 0;
    let outputTokens = 0;
    // Prefer the REQUEST model — MIMO/other Anthropic-compatible providers may return
    // an internal model name (e.g. "claude-sonnet-4-6") instead of the requested name.
    // Only fall back to the response model if the request model was empty.
    let detectedModel = model;

    if (json.usage) {
      inputTokens = json.usage.input_tokens || 0;
      outputTokens = json.usage.output_tokens || 0;
    }
    if (json.message?.usage) {
      inputTokens = inputTokens || json.message.usage.input_tokens || 0;
      outputTokens = outputTokens || json.message.usage.output_tokens || 0;
    }
    // Only use the response model if we don't have one from the request body
    if (!detectedModel && json.model) detectedModel = json.model;
    if (!detectedModel && json.message?.model) detectedModel = json.message.model;

    if (inputTokens > 0 || outputTokens > 0) {
      this._report(detectedModel, inputTokens, outputTokens);
    }
  }

  /**
   * Process an Anthropic SSE event.
   */
  _processAnthropicSseEvent(event, accumulated) {
    try {
      const json = JSON.parse(event.data);

      if (event.event === "message_start" && json.message) {
        if (json.message.usage?.input_tokens) {
          accumulated.inputTokens += json.message.usage.input_tokens;
        }
        if (json.message.model && !accumulated.model) {
          accumulated.model = json.message.model;
        }
      }

      if (event.event === "message_delta" && json.usage) {
        if (json.usage.output_tokens) accumulated.outputTokens += json.usage.output_tokens;
      }

      // Generic usage fallback
      if (json.usage) {
        if (json.usage.input_tokens && accumulated.inputTokens === 0) {
          accumulated.inputTokens += json.usage.input_tokens;
        }
        if (json.usage.output_tokens && accumulated.outputTokens === 0) {
          accumulated.outputTokens += json.usage.output_tokens;
        }
      }
    } catch {}
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Gemini API handlers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle a Gemini API response (streaming or non-streaming).
   * Gemini streaming returns a series of JSON objects separated by newlines.
   * Each object may contain usageMetadata.
   *
   * Non-streaming response:
   *   { candidates: [...], usageMetadata: { promptTokenCount, candidatesTokenCount, totalTokenCount } }
   *
   * Streaming response (alt=sse):
   *   Each SSE data: line contains a JSON chunk, the last one has usageMetadata.
   */
  _handleGeminiResponse(proxyRes, res, model, isStreaming) {
    if (isStreaming) {
      this._handleGeminiStreamingResponse(proxyRes, res, model);
    } else {
      this._handleGeminiJsonResponse(proxyRes, res, model);
    }
  }

  /**
   * Handle a non-streaming Gemini JSON response.
   */
  _handleGeminiJsonResponse(proxyRes, res, model) {
    const chunks = [];
    proxyRes.on("data", (chunk) => chunks.push(chunk));
    proxyRes.on("end", () => {
      const body = Buffer.concat(chunks);
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      res.end(body);

      try {
        const json = JSON.parse(body.toString());
        this._extractGeminiUsage(json, model);
      } catch {}
    });
  }

  /**
   * Handle a streaming Gemini response.
   * Gemini streaming sends newline-delimited JSON objects.
   * The last chunk contains the usageMetadata.
   */
  _handleGeminiStreamingResponse(proxyRes, res, model) {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    let inputTokens = 0;
    let outputTokens = 0;
    let detectedModel = model;
    let jsonBuffer = "";

    proxyRes.on("data", (chunk) => {
      res.write(chunk);
      jsonBuffer += chunk.toString();

      // Try to parse complete JSON objects from the buffer
      // Gemini streaming may send SSE format (data: {...}) or plain JSON lines
      const lines = jsonBuffer.split("\n");
      jsonBuffer = lines.pop() || ""; // Keep incomplete last line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Handle SSE format: "data: {json}"
        const jsonStr = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed;

        try {
          const chunk = JSON.parse(jsonStr);
          const usage = chunk.usageMetadata;
          if (usage) {
            inputTokens = usage.promptTokenCount || inputTokens;
            outputTokens = usage.candidatesTokenCount || outputTokens;
            if (usage.promptTokenCount > 0 || usage.candidatesTokenCount > 0) {
              // Keep updating — last chunk with usage wins
            }
          }
          // Detect model from response
          if (chunk.modelVersion) detectedModel = chunk.modelVersion;
        } catch {}
      }
    });

    proxyRes.on("end", () => {
      res.end();
      // Process any remaining buffer
      if (jsonBuffer.trim()) {
        const jsonStr = jsonBuffer.trim().startsWith("data: ")
          ? jsonBuffer.trim().slice(6)
          : jsonBuffer.trim();
        try {
          const chunk = JSON.parse(jsonStr);
          if (chunk.usageMetadata) {
            inputTokens = chunk.usageMetadata.promptTokenCount || inputTokens;
            outputTokens = chunk.usageMetadata.candidatesTokenCount || outputTokens;
          }
        } catch {}
      }

      if (inputTokens > 0 || outputTokens > 0) {
        this._report(detectedModel || model, inputTokens, outputTokens);
      }
    });
  }

  /**
   * Extract token usage from a non-streaming Gemini response.
   */
  _extractGeminiUsage(json, model) {
    const usage = json.usageMetadata;
    if (!usage) return;

    const inputTokens = usage.promptTokenCount || 0;
    const outputTokens = usage.candidatesTokenCount || 0;
    const detectedModel = json.modelVersion || model;

    if (inputTokens > 0 || outputTokens > 0) {
      this._report(detectedModel, inputTokens, outputTokens);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Shared utilities
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Report token usage via callback.
   * @param {string} model
   * @param {number} inputTokens
   * @param {number} outputTokens
   */
  _report(model, inputTokens, outputTokens) {
    this.onTokenUsage({
      paneId: "unknown", // Pane attribution handled by mcp.ts callback
      model,
      inputTokens,
      outputTokens,
    });
    console.log(
      `${LOG_PREFIX} Token usage: model=${model} input=${inputTokens} output=${outputTokens}`
    );
  }

  /**
   * Parse SSE events from a buffer string.
   * @param {string} buffer
   * @returns {{parsed: Array<{event: string, data: string}>, remaining: string}}
   */
  _parseSseEvents(buffer) {
    const parsed = [];
    const parts = buffer.split("\n\n");
    const remaining = parts.pop() || "";

    for (const part of parts) {
      if (!part.trim()) continue;

      let event = "message";
      let data = "";

      for (const line of part.split("\n")) {
        if (line.startsWith("event: ")) {
          event = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          data = line.slice(6);
        } else if (line === "data:") {
          data = "";
        }
      }

      if (data) {
        parsed.push({ event, data });
      }
    }

    return { parsed, remaining };
  }
}

module.exports = { ApiProxy };
