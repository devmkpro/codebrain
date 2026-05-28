"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");

/**
 * Review Agent Runner — spawns a dedicated agent to review a GitLab MR.
 *
 * Architecture:
 *   1. Fetch MR metadata + parsed diff (via gitlabGetMr)
 *   2. Write a custom system prompt file (review instructions + diff + MR context)
 *   3. Spawn a hidden agent with systemPromptFile (bypasses codebrain-system.md)
 *   4. Send minimal trigger via writePane (no newline issues)
 *   5. Agent analyzes diff and calls mcp__codebrain__gitlab_comment_mr directly
 *   6. Return result summary
 */

function createReviewRunHandlers(opts) {
  // ── Deduplication: skip duplicate webhook events for the same MR ──
  // GitLab sends multiple webhooks for the same MR update (push + MR update).
  // We debounce by MR key, skipping reviews within 120s of the last one.
  const recentReviews = new Map(); // key: "projectId:mrId" → timestamp
  const DEDUP_WINDOW_MS = 120000; // 2 minutes

  /**
   * Build the complete review prompt (system prompt + diff + MR context).
   * This is written to a temp file and passed as --system-prompt-file.
   */
  function buildReviewPromptFile({ mr, projectId, maxComments, model, paneId }) {
    // Load review-specific system prompt
    let systemPrompt = "";
    try {
      const promptPath = path.join(__dirname, "../../..", "prompts", "mr-reviewer.md");
      systemPrompt = fs.readFileSync(promptPath, "utf-8");
    } catch {
      systemPrompt = "You are a senior code reviewer. Analyze the diff, identify real issues, and call mcp__codebrain__gitlab_comment_mr to post your findings.";
    }

    // Build file sections from parsed hunks
    let fileSections = "";
    const files = (mr.files || []).slice(0, 30);
    for (const file of files) {
      fileSections += `\n### ${file.newPath}${file.newFile ? " (NEW)" : ""}${file.deletedFile ? " (DELETED)" : ""}\n`;
      if (file.hunks && file.hunks.length > 0) {
        for (const hunk of file.hunks.slice(0, 20)) {
          fileSections += `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`;
          for (const change of hunk.content) {
            const prefix = change.type === "add" ? "+" : change.type === "del" ? "-" : " ";
            fileSections += `${prefix} ${change.content}\n`;
          }
        }
      } else {
        fileSections += "(diff unavailable)\n";
      }
    }

    // Compose full prompt: system prompt + MR context + diff
    const fullPrompt = `${systemPrompt}

---

## MR Review Context

**Project ID:** ${projectId}
**MR IID:** ${mr.id}
**Title:** ${mr.title}
**Author:** ${mr.author}
**Source branch:** ${mr.sourceBranch}
**Target branch:** ${mr.targetBranch}
**Files changed:** ${mr.filesChanged}
**Description:**
${(mr.description || "(none)").slice(0, 1000)}

You MUST call the MCP tool \`mcp__codebrain__gitlab_comment_mr\` with:
- projectId: "${projectId}"
- mrId: ${mr.id}

Post up to ${maxComments || 15} findings as a single formatted comment.

---

## Diff (${files.length} files)

${fileSections}
`;

    // Write to temp file
    const tmpDir = path.join(os.homedir(), ".codebrain", "tmp");
    try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}
    const promptFile = path.join(tmpDir, `review-prompt-${paneId}.txt`);
    fs.writeFileSync(promptFile, fullPrompt, "utf-8");
    return promptFile;
  }

  /**
   * Run a review on a specific MR.
   * The spawned agent will call mcp__codebrain__gitlab_comment_mr directly via MCP.
   */
  async function reviewRun({ projectId, mrId, model, maxComments = 15, timeout = 600000 }) {
    // 1. Validate inputs
    if (!projectId) return { ok: false, error: "projectId is required" };
    if (!mrId) return { ok: false, error: "mrId is required" };

    // 2. Deduplication — skip if this MR was reviewed recently
    const dedupKey = `${projectId}:${mrId}`;
    const lastReview = recentReviews.get(dedupKey) || 0;
    if (Date.now() - lastReview < DEDUP_WINDOW_MS) {
      console.log(`[ReviewRun] Skipping MR !${mrId} — reviewed ${Math.round((Date.now() - lastReview) / 1000)}s ago (dedup window: ${DEDUP_WINDOW_MS / 1000}s)`);
      return { ok: true, data: { mrId, projectId, skipped: true, reason: "duplicate" } };
    }
    recentReviews.set(dedupKey, Date.now());
    // Cleanup old entries
    if (recentReviews.size > 100) {
      for (const [key, ts] of recentReviews) {
        if (Date.now() - ts > DEDUP_WINDOW_MS * 2) recentReviews.delete(key);
      }
    }

    // 3. Fetch MR data with parsed diff
    const mrResult = await opts.bridge.gitlabGetMr({ projectId, mrId });
    if (!mrResult.ok) return { ok: false, error: `Failed to fetch MR: ${mrResult.error}` };

    const mr = mrResult.data;
    if (mr.draft) return { ok: false, error: "MR is a draft — skipping review" };

    // 3. Generate unique pane ID for this review
    const reviewModel = model || "mimo-v2.5-pro";
    const label = `review-mr${mrId}-${Date.now()}`;
    const cwd = opts.getCurrentWorkspacePath?.() || process.cwd();

    // Generate a temp ID for the prompt file name (real paneId assigned by spawnPaneInternal)
    const tempId = `review-${mrId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // 4. Write custom system prompt file (includes diff + MR context + MCP instructions)
    const promptFile = buildReviewPromptFile({ mr, projectId, maxComments, model: reviewModel, paneId: tempId });

    // 5. Spawn review agent with custom system prompt (bypasses codebrain-system.md)
    // NOTE: hidden=false — hidden panes don't work with OpenClaude CLI (no API calls)
    let paneId;
    try {
      const spawnResult = await opts.bridge.spawnPane({
        agent: "openclaude",
        model: reviewModel,
        label,
        cwd,
        systemPromptFile: promptFile,
      });
      if (!spawnResult.ok) return { ok: false, error: `Failed to spawn review agent: ${spawnResult.error}` };
      paneId = spawnResult.paneId;

      // Set longer idle timeout for review agent — LLM processing between API calls
      // can take 10-20 seconds. Default 3s is too aggressive and causes premature idle.
      try { opts.ptyManager?.setIdleTimeout(paneId, 15000); } catch {}
    } catch (err) {
      return { ok: false, error: `Failed to spawn review agent: ${err.message}` };
    }

    // 6. Wait for agent to initialize (OpenClaude needs time to start MCP server)
    //    Sending the trigger too early causes it to be lost or ignored
    const INIT_DELAY_MS = 8000; // 8s for CLI + MCP server startup
    await new Promise(r => setTimeout(r, INIT_DELAY_MS));

    // 7. Send minimal trigger — the diff and instructions are in the system prompt
    //    Using a short message avoids newline sanitization issues in PTY
    console.log(`[ReviewRun] Sending trigger to pane ${paneId} after ${INIT_DELAY_MS}ms init delay`);
    try {
      await opts.bridge.writePane(paneId, "Analyze the MR diff now and call mcp__codebrain__gitlab_comment_mr to post your findings.", true);
      await opts.bridge.waitPaneIdle(paneId, timeout);
    } catch (err) {
      // Kill pane on error too
      try { opts.ptyManager?.kill(paneId); } catch {}
      try { opts.bridge.roleMap?.delete(paneId); } catch {}
      try { fs.unlinkSync(promptFile); } catch {} // cleanup temp file
      return { ok: false, error: `Review agent timed out or failed: ${err.message}`, paneId };
    }

    // 8. Read output for logging/debugging
    let output = "";
    try {
      const readResult = await opts.bridge.readPane(paneId, 500);
      output = (readResult.lines || []).join("\n");
    } catch (err) {
      console.error(`[ReviewRun] Failed to read output: ${err.message}`);
    }

    // 9. Hybrid: Check if MCP tool was called; if not, parse JSON fallback
    const postedComment = /posted|comment|findings|review/i.test(output);
    let fallbackPosted = false;

    // Try to extract REVIEW_FINDINGS_JSON from output
    // Use brace-counting to extract complete JSON (regex fails on nested objects)
    let parsedFindings = null;
    const jsonPrefix = output.indexOf("REVIEW_FINDINGS_JSON:");
    if (jsonPrefix >= 0) {
      const afterPrefix = output.slice(jsonPrefix + "REVIEW_FINDINGS_JSON:".length).trim();
      if (afterPrefix.startsWith("{")) {
        let depth = 0;
        let endIdx = -1;
        for (let i = 0; i < afterPrefix.length; i++) {
          if (afterPrefix[i] === "{") depth++;
          else if (afterPrefix[i] === "}") { depth--; if (depth === 0) { endIdx = i + 1; break; } }
        }
        if (endIdx > 0) {
          try { parsedFindings = JSON.parse(afterPrefix.slice(0, endIdx)); } catch {}
        }
      }
    }
    if (parsedFindings) {
      try {
        const findings = parsedFindings;
        const findingCount = findings.findings?.length || 0;
        console.log(`[ReviewRun] MR !${mrId}: found JSON fallback with ${findingCount} findings`);

        if (findingCount > 0) {
          // Always post via bridge — the agent MAY have also called the MCP tool,
          // but we can't reliably detect that from output text (tool name appears in prompts).
          // Duplicate comments are acceptable; missing reviews are not.
          const severityIcons = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵" };
          let body = `## Code Review — MR !${mrId}\n\n`;
          for (const f of findings.findings) {
            const icon = severityIcons[f.severity] || "⚪";
            body += `### ${icon} ${(f.severity || "medium").toUpperCase()} (${f.category || "issue"}) \`${f.file || "?"}:${f.line || "?"}\`\n\n`;
            body += `${f.description || f.title || "Issue found"}\n\n`;
            if (f.suggestion) body += `> **Suggestion:** ${f.suggestion}\n\n`;
            body += `---\n\n`;
          }
          body += `*Model: ${reviewModel} | ${findingCount} finding(s)*\n`;

          // Post via bridge
          const commentResult = await opts.bridge.gitlabCommentMr({
            projectId: String(projectId),
            mrId: mrId,
            body,
          });
          fallbackPosted = commentResult?.ok === true;
          console.log(`[ReviewRun] MR !${mrId}: fallback comment posted=${fallbackPosted} (${findingCount} findings)`);
        } else {
          console.log(`[ReviewRun] MR !${mrId}: 0 findings in JSON, nothing to post`);
        }
      } catch (parseErr) {
        console.warn(`[ReviewRun] MR !${mrId}: failed to parse REVIEW_FINDINGS_JSON: ${parseErr.message}`);
      }
    } else {
      console.log(`[ReviewRun] MR !${mrId}: no REVIEW_FINDINGS_JSON found in output`);
    }

    console.log(`[ReviewRun] MR !${mrId}: agent completed, output length=${output.length}, comment mentioned=${postedComment}, fallback posted=${fallbackPosted}`);

    // 10. MANDATORY: Kill the review agent pane — it must not stay open
    try {
      if (opts.ptyManager?.hasPane(paneId)) {
        opts.ptyManager.kill(paneId);
        console.log(`[ReviewRun] Killed review pane ${paneId}`);
      }
    } catch (err) {
      console.warn(`[ReviewRun] Failed to kill pane ${paneId}: ${err.message}`);
    }
    // Also clean up roleMap/paneLabels
    try { opts.bridge.roleMap?.delete(paneId); } catch {}

    // 11. Cleanup temp prompt file
    try { fs.unlinkSync(promptFile); } catch {}

    return {
      ok: true,
      data: {
        mrId,
        projectId,
        title: mr.title,
        filesChanged: mr.filesChanged,
        agentPaneId: paneId,
        model: reviewModel,
        output: output.slice(0, 5000),
        outputLength: output.length,
        fallbackPosted,
      },
    };
  }

  return { reviewRun };
}

module.exports = { createReviewRunHandlers };
