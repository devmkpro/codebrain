"use strict";

/**
 * MR/PR Review bridge handlers — List, detail, review, and comment on
 * merge requests / pull requests via GitHub (gh) or GitLab (glab) CLI.
 *
 * Auto-detects the provider from the git remote origin URL.
 */

const { execSync } = require("child_process");

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detect the git provider from the remote origin URL.
 * @param {string} cwd - Working directory of the git repo
 * @returns {{ provider: 'github'|'gitlab', cli: 'gh'|'glab', repo: string }}
 */
function detectGitProvider(cwd) {
  let remoteUrl;
  try {
    remoteUrl = execSync("git remote get-url origin", {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    throw new Error(`Failed to get git remote origin in ${cwd}: ${err.message}`);
  }

  if (!remoteUrl) {
    throw new Error("No remote 'origin' found in this repository");
  }

  if (remoteUrl.includes("github.com")) {
    return { provider: "github", cli: "gh", repo: extractRepoSlug(remoteUrl) };
  }

  if (remoteUrl.includes("gitlab.com") || remoteUrl.includes("gitlab")) {
    return { provider: "gitlab", cli: "glab", repo: extractRepoSlug(remoteUrl) };
  }

  // Default to GitHub for enterprise hosts (most common)
  return { provider: "github", cli: "gh", repo: extractRepoSlug(remoteUrl) };
}

/**
 * Extract owner/repo slug from a git remote URL.
 * Supports: https://github.com/owner/repo.git, git@github.com:owner/repo.git, etc.
 */
function extractRepoSlug(url) {
  // Remove trailing .git
  const clean = url.replace(/\.git$/, "");

  // SSH format: git@host:owner/repo
  const sshMatch = clean.match(/git@[^:]+:(.+)/);
  if (sshMatch) {
    const slug = sshMatch[1];
    const parts = slug.split("/");
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    return slug;
  }

  // HTTPS format: https://host/owner/repo
  try {
    const parsed = new URL(clean.startsWith("http") ? clean : `https://${clean}`);
    const parts = parsed.pathname.replace(/^\//, "").split("/");
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  } catch {}

  return clean;
}

/**
 * Run a CLI command and return stdout.
 * @param {string} cmd
 * @param {string} cwd
 * @returns {string}
 */
function runCli(cmd, cwd) {
  try {
    return execSync(cmd, {
      cwd,
      encoding: "utf-8",
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024, // 10MB for large diffs
    }).trim();
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().trim() : "";
    const stdout = err.stdout ? err.stdout.toString().trim() : "";
    throw new Error(`CLI error (${cmd}): ${stderr || stdout || err.message}`);
  }
}

/**
 * Run a CLI command that returns JSON and parse it.
 * @param {string} cmd
 * @param {string} cwd
 * @returns {any}
 */
function runCliJson(cmd, cwd) {
  const raw = runCli(cmd, cwd);
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse JSON from: ${cmd}\nOutput: ${raw.slice(0, 500)}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════

function createMRHandlers() {
  return {
    /**
     * List MRs/PRs for the repository.
     */
    async mrList({ cwd, state = "open", limit = 20 }) {
      if (!cwd) return { ok: false, error: "cwd (workspace path) is required" };

      try {
        const { provider, cli } = detectGitProvider(cwd);

        if (cli === "gh") {
          const ghState = state === "open" ? "open" : state === "closed" ? "closed" : "all";
          const data = runCliJson(
            `gh pr list --state ${ghState} --limit ${limit} --json number,title,author,headRefName,createdAt,url`,
            cwd
          );
          const mrs = (data || []).map((pr) => ({
            id: pr.number,
            title: pr.title,
            author: pr.author?.login || "unknown",
            branch: pr.headRefName,
            created_at: pr.createdAt,
            url: pr.url,
          }));
          return { ok: true, provider, count: mrs.length, mrs };
        }

        // GitLab (glab)
        const glabState = state === "open" ? "opened" : state === "closed" ? "closed" : "all";
        const data = runCliJson(
          `glab mr list --state ${glabState} --per-page ${limit} -F json`,
          cwd
        );
        const mrs = (Array.isArray(data) ? data : []).map((mr) => ({
          id: mr.iid || mr.id,
          title: mr.title,
          author: mr.author?.username || mr.author?.name || "unknown",
          branch: mr.source_branch,
          created_at: mr.created_at,
          url: mr.web_url,
        }));
        return { ok: true, provider, count: mrs.length, mrs };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    /**
     * Get full details of a single MR/PR including diff.
     */
    async mrDetail({ cwd, id, include_diff = true }) {
      if (!cwd) return { ok: false, error: "cwd (workspace path) is required" };
      if (id === undefined || id === null) return { ok: false, error: "id (MR/PR number) is required" };

      try {
        const { provider, cli } = detectGitProvider(cwd);

        if (cli === "gh") {
          const pr = runCliJson(
            `gh pr view ${id} --json number,title,body,author,headRefName,baseRefName,files,additions,deletions,comments,url,state`,
            cwd
          );

          let diff = null;
          if (include_diff) {
            try {
              diff = runCli(`gh pr diff ${id}`, cwd);
            } catch {
              diff = "(diff unavailable)";
            }
          }

          const files_changed = (pr.files || []).map((f) => ({
            path: f.path,
            additions: f.additions,
            deletions: f.deletions,
            status: f.changeType?.toLowerCase() || "modified",
          }));

          const comments = (pr.comments || []).map((c) => ({
            author: c.author?.login || "unknown",
            body: c.body,
            created_at: c.createdAt,
            path: c.path || null,
            line: c.line || null,
          }));

          return {
            ok: true,
            provider,
            mr: {
              id: pr.number,
              title: pr.title,
              description: pr.body || "",
              author: pr.author?.login || "unknown",
              branch: pr.headRefName,
              base_branch: pr.baseRefName,
              state: pr.state?.toLowerCase() || "open",
              url: pr.url,
              additions: pr.additions || 0,
              deletions: pr.deletions || 0,
              files_changed,
              comments,
              diff: include_diff ? diff : undefined,
            },
          };
        }

        // GitLab (glab)
        const mr = runCliJson(`glab mr view ${id} -F json`, cwd);

        let diff = null;
        if (include_diff) {
          try {
            diff = runCli(`glab mr diff ${id}`, cwd);
          } catch {
            diff = "(diff unavailable)";
          }
        }

        // glab mr view returns iid, source_branch, target_branch, author.username, web_url
        const notes = (mr.notes || []).map((n) => ({
          author: n.author?.username || "unknown",
          body: n.body,
          created_at: n.created_at,
        }));

        return {
          ok: true,
          provider,
          mr: {
            id: mr.iid || mr.id,
            title: mr.title,
            description: mr.description || "",
            author: mr.author?.username || mr.author?.name || "unknown",
            branch: mr.source_branch,
            base_branch: mr.target_branch,
            state: mr.state?.toLowerCase() || "opened",
            url: mr.web_url,
            additions: mr.changes_count?.split("/")[0] || 0,
            deletions: mr.changes_count?.split("/")[1] || 0,
            files_changed: (mr.changes || []).map((c) => ({
              path: c.new_path || c.old_path,
              status: c.renamed_file ? "renamed" : c.new_file ? "added" : c.deleted_file ? "deleted" : "modified",
            })),
            comments: notes,
            diff: include_diff ? diff : undefined,
          },
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    /**
     * Post a comment on an MR/PR.
     * If file and line are provided, posts an inline review comment (GitHub only).
     */
    async mrComment({ cwd, id, body, file, line }) {
      if (!cwd) return { ok: false, error: "cwd (workspace path) is required" };
      if (id === undefined || id === null) return { ok: false, error: "id (MR/PR number) is required" };
      if (!body) return { ok: false, error: "body (comment text) is required" };

      try {
        const { provider, cli } = detectGitProvider(cwd);

        if (cli === "gh") {
          if (file && line) {
            // Inline review comment via gh api
            // First get the latest commit SHA for the PR head
            const pr = runCliJson(`gh pr view ${id} --json headRefOid`, cwd);
            const commitSha = pr.headRefOid;

            if (!commitSha) {
              // Fallback to regular comment
              const result = runCli(`gh pr comment ${id} --body "${body.replace(/"/g, '\\"')}"`, cwd);
              const commentUrl = result.match(/(https:\/\/[^\s]+)/)?.[1] || null;
              return { ok: true, provider, comment_url: commentUrl, inline: false, message: "Could not get commit SHA for inline comment; posted as general comment" };
            }

            // Use gh api to post inline comment
            const escapedBody = body.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
            const payload = JSON.stringify({
              body: escapedBody,
              commit_id: commitSha,
              path: file,
              line: parseInt(line, 10),
              side: "RIGHT",
            });

            try {
              const result = runCli(
                `gh api repos/{owner}/{repo}/pulls/${id}/reviews --method POST --input -`,
                cwd
              );
              return { ok: true, provider, inline: true, file, line };
            } catch {
              // Fallback: try general comment if inline fails
              const result = runCli(`gh pr comment ${id} --body "${escapedBody}"`, cwd);
              const commentUrl = result.match(/(https:\/\/[^\s]+)/)?.[1] || null;
              return { ok: true, provider, comment_url: commentUrl, inline: false, message: "Inline comment failed; posted as general comment" };
            }
          }

          // Regular comment
          const result = runCli(`gh pr comment ${id} --body "${body.replace(/"/g, '\\"')}"`, cwd);
          const commentUrl = result.match(/(https:\/\/[^\s]+)/)?.[1] || null;
          return { ok: true, provider, comment_url: commentUrl };
        }

        // GitLab (glab)
        const escapedBody = body.replace(/"/g, '\\"');
        const result = runCli(`glab mr note ${id} --message "${escapedBody}"`, cwd);
        return { ok: true, provider, message: "Comment posted" };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  };
}

module.exports = { createMRHandlers, detectGitProvider, extractRepoSlug };
