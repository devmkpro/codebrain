"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");

/**
 * GitLab + Git bridge handlers for Codebrain MCP.
 *
 * Provides 11 tools for MR review, commenting, issue creation,
 * and local git operations (clone, branch, commit, push).
 *
 * Env vars:
 *   GITLAB_TOKEN   — Personal access token with "api" scope
 *   GITLAB_URL     — GitLab instance URL (default: https://gitlab.com)
 *   GITLAB_PROJECT_ID — Default project ID (can be overridden per-call)
 */

const { Gitlab } = require("@gitbeaker/rest");
const simpleGit = require("simple-git");
const parseDiffModule = require("parse-diff");

function createGitHandlers(opts = {}) {
  let _api = null;
  let _apiError = null;

  // Diagnostic: log env var presence at module load time
  console.log(`[GitHandlers] GITLAB_TOKEN present: ${!!process.env.GITLAB_TOKEN} (length: ${(process.env.GITLAB_TOKEN || "").length})`);

  /**
   * Resolve GITLAB_TOKEN from multiple sources:
   * 1. process.env.GITLAB_TOKEN (env var)
   * 2. ~/.codebrain/gitlab-token (plain text file)
   * 3. opts.gitlabToken (passed via bridge opts)
   */
  function resolveToken() {
    // 1. Environment variable
    if (process.env.GITLAB_TOKEN) return process.env.GITLAB_TOKEN;

    // 2. File fallback: ~/.codebrain/gitlab-token
    try {
      const tokenPath = path.join(os.homedir(), ".codebrain", "gitlab-token");
      if (fs.existsSync(tokenPath)) {
        const t = fs.readFileSync(tokenPath, "utf-8").trim();
        if (t) {
          console.log("[GitHandlers] GITLAB_TOKEN loaded from ~/.codebrain/gitlab-token");
          return t;
        }
      }
    } catch {}

    // 3. Bridge opts
    if (opts.gitlabToken) return opts.gitlabToken;

    return null;
  }

  /**
   * Lazy-init GitLab API client from env vars.
   * Caches the instance. Returns { api, error }.
   */
  function getApi() {
    if (_api) return { api: _api, error: null };
    if (_apiError) return { api: null, error: _apiError };

    const token = resolveToken();
    if (!token) {
      _apiError = "GITLAB_TOKEN not set. Set env var, create ~/.codebrain/gitlab-token, or pass via opts.";
      console.error("[GitHandlers] GITLAB_TOKEN not found in any source");
      return { api: null, error: _apiError };
    }

    const host = process.env.GITLAB_URL || "https://gitlab.com";
    try {
      _api = new Gitlab({
        token,
        host,
      });
      return { api: _api, error: null };
    } catch (err) {
      _apiError = `Failed to init GitLab client: ${err.message}`;
      return { api: null, error: _apiError };
    }
  }

  /**
   * Get default project ID from env or opts.
   */
  function getDefaultProjectId() {
    return process.env.GITLAB_PROJECT_ID || opts.defaultProjectId || null;
  }

  /**
   * Resolve project ID — use provided value or fall back to default.
   */
  function resolveProjectId(projectId) {
    const id = projectId || getDefaultProjectId();
    if (!id) throw new Error("No projectId provided and GITLAB_PROJECT_ID not set");
    return id;
  }

  // ─── GitLab MR Operations ──────────────────────────────────────────────────

  async function gitlabListMrs({ projectId, state, labels } = {}) {
    const { api, error } = getApi();
    if (error) return { ok: false, error };

    const pid = resolveProjectId(projectId);
    try {
      const params = {};
      if (state) params.state = state; // opened, closed, merged, all
      if (labels) params.labels = Array.isArray(labels) ? labels.join(",") : labels;

      const mrs = await api.MergeRequests.all(pid, params);
      return {
        ok: true,
        data: mrs.map((mr) => ({
          id: mr.iid,
          title: mr.title,
          author: mr.author?.name || mr.author?.username || "unknown",
          state: mr.state,
          sourceBranch: mr.source_branch,
          targetBranch: mr.target_branch,
          createdAt: mr.created_at,
          updatedAt: mr.updated_at,
          labels: mr.labels || [],
          draft: mr.work_in_progress || false,
          webUrl: mr.web_url,
          description: (mr.description || "").slice(0, 500),
        })),
      };
    } catch (err) {
      return { ok: false, error: `gitlab_list_mrs failed: ${err.message}` };
    }
  }

  async function gitlabGetMr({ projectId, mrId }) {
    const { api, error } = getApi();
    if (error) return { ok: false, error };

    const pid = resolveProjectId(projectId);
    if (!mrId) return { ok: false, error: "mrId is required" };

    try {
      const mr = await api.MergeRequests.show(pid, mrId);
      const changes = await api.MergeRequests.allDiffs(pid, mrId);

      // allDiffs returns an array directly (not {changes: [...]})
      const changeList = Array.isArray(changes) ? changes : (changes?.changes || []);

      // Parse the diff to extract structured hunks
      const files = [];
      if (changeList.length > 0) {
        for (const change of changeList) {
          const diff = change.diff || "";
          let parsed = [];
          try {
            parsed = parseDiffModule.default ? parseDiffModule.default(diff) : parseDiffModule(diff);
          } catch {
            // parse-diff sometimes fails on binary or unusual diffs
            parsed = [];
          }

          const fileData = {
            oldPath: change.old_path,
            newPath: change.new_path,
            newFile: change.new_file,
            renamedFile: change.renamed_file,
            deletedFile: change.deleted_file,
            diff: diff,
            hunks: [],
          };

          // Extract hunks from parsed diff
          if (parsed.length > 0 && parsed[0].chunks) {
            for (const chunk of parsed[0].chunks) {
              fileData.hunks.push({
                oldStart: chunk.oldStart,
                oldLines: chunk.oldLines,
                newStart: chunk.newStart,
                newLines: chunk.newLines,
                content: chunk.changes
                  ? chunk.changes
                      .filter((c) => c.type !== "normal")
                      .map((c) => ({
                        type: c.type, // "add" or "del"
                        line: c.type === "add" ? c.ln : c.ln1,
                        content: c.content,
                      }))
                  : [],
              });
            }
          }

          files.push(fileData);
        }
      }

      return {
        ok: true,
        data: {
          id: mr.iid,
          title: mr.title,
          description: mr.description || "",
          author: mr.author?.name || mr.author?.username || "unknown",
          state: mr.state,
          sourceBranch: mr.source_branch,
          targetBranch: mr.target_branch,
          webUrl: mr.web_url,
          createdAt: mr.created_at,
          updatedAt: mr.updated_at,
          labels: mr.labels || [],
          draft: mr.work_in_progress || false,
          sha: mr.sha,
          diffRefs: mr.diff_refs || null,
          filesChanged: files.length,
          files,
        },
      };
    } catch (err) {
      return { ok: false, error: `gitlab_get_mr failed: ${err.message}` };
    }
  }

  async function gitlabCommentMr({ projectId, mrId, body, position }) {
    const { api, error } = getApi();
    if (error) return { ok: false, error };

    const pid = resolveProjectId(projectId);
    if (!mrId) return { ok: false, error: "mrId is required" };
    if (!body) return { ok: false, error: "body is required" };

    try {
      // Inline comment (on a specific file + line)
      if (position) {
        const mr = await api.MergeRequests.show(pid, mrId);
        const positionPayload = {
          base_sha: position.base_sha || mr.diff_refs?.base_sha,
          start_sha: position.start_sha || mr.diff_refs?.start_sha,
          head_sha: position.head_sha || mr.diff_refs?.head_sha,
          position_type: "text",
          new_path: position.new_path,
          new_line: position.new_line,
        };

        const comment = await api.MergeRequestDiscussions.create(pid, mrId, body, {
          position: positionPayload,
        });

        return {
          ok: true,
          data: {
            id: comment.id,
            type: "inline",
            file: position.new_path,
            line: position.new_line,
          },
        };
      }

      // General comment (not inline)
      const comment = await api.MergeRequestNotes.create(pid, mrId, body);
      return {
        ok: true,
        data: { id: comment.id, type: "general" },
      };
    } catch (err) {
      return { ok: false, error: `gitlab_comment_mr failed: ${err.message}` };
    }
  }

  async function gitlabCreateMr({ projectId, title, sourceBranch, targetBranch, description }) {
    const { api, error } = getApi();
    if (error) return { ok: false, error };

    const pid = resolveProjectId(projectId);
    if (!title) return { ok: false, error: "title is required" };
    if (!sourceBranch) return { ok: false, error: "sourceBranch is required" };

    try {
      const mr = await api.MergeRequests.create(pid, sourceBranch, targetBranch || "main", title, {
        description: description || "",
      });

      return {
        ok: true,
        data: {
          id: mr.iid,
          title: mr.title,
          webUrl: mr.web_url,
          state: mr.state,
        },
      };
    } catch (err) {
      return { ok: false, error: `gitlab_create_mr failed: ${err.message}` };
    }
  }

  async function gitlabUpdateMr({ projectId, mrId, state }) {
    const { api, error } = getApi();
    if (error) return { ok: false, error };

    const pid = resolveProjectId(projectId);
    if (!mrId) return { ok: false, error: "mrId is required" };

    try {
      const params = {};
      if (state === "merge") params.state_event = "merge";
      else if (state === "close") params.state_event = "close";
      else if (state === "reopen") params.state_event = "reopen";

      const mr = await api.MergeRequests.edit(pid, mrId, params);
      return {
        ok: true,
        data: { id: mr.iid, state: mr.state },
      };
    } catch (err) {
      return { ok: false, error: `gitlab_update_mr failed: ${err.message}` };
    }
  }

  async function gitlabCreateIssue({ projectId, title, description, labels }) {
    const { api, error } = getApi();
    if (error) return { ok: false, error };

    const pid = resolveProjectId(projectId);
    if (!title) return { ok: false, error: "title is required" };

    try {
      const issue = await api.Issues.create(pid, title, {
        description: description || "",
        labels: Array.isArray(labels) ? labels.join(",") : labels || "",
      });

      return {
        ok: true,
        data: {
          id: issue.iid,
          title: issue.title,
          webUrl: issue.web_url,
          state: issue.state,
        },
      };
    } catch (err) {
      return { ok: false, error: `gitlab_create_issue failed: ${err.message}` };
    }
  }

  async function gitlabGetFile({ projectId, filePath, ref }) {
    const { api, error } = getApi();
    if (error) return { ok: false, error };

    const pid = resolveProjectId(projectId);
    if (!filePath) return { ok: false, error: "filePath is required" };

    try {
      const file = await api.RepositoryFiles.show(pid, filePath, ref || "main");
      const content = Buffer.from(file.content, file.encoding || "base64").toString("utf-8");
      return {
        ok: true,
        data: {
          path: file.file_path,
          content,
          size: content.length,
          ref: ref || "main",
        },
      };
    } catch (err) {
      return { ok: false, error: `gitlab_get_file failed: ${err.message}` };
    }
  }

  async function gitlabListRepos() {
    const { api, error } = getApi();
    if (error) return { ok: false, error };

    try {
      const projects = await api.Projects.all({ membership: true, perPage: 50, orderBy: "last_activity_at" });
      return {
        ok: true,
        data: projects.map((p) => ({
          id: p.id,
          name: p.name,
          namespace: p.namespace?.full_path || "",
          webUrl: p.web_url,
          defaultBranch: p.default_branch,
          lastActivity: p.last_activity_at,
        })),
      };
    } catch (err) {
      return { ok: false, error: `gitlab_list_repos failed: ${err.message}` };
    }
  }

  /**
   * Detect the GitLab project for the current workspace by inspecting git remotes.
   * Returns the matched project ID + metadata, or an error.
   */
  async function gitDetectProject({ path: workspacePath } = {}) {
    const wsPath = workspacePath || (opts.getCurrentWorkspacePath && opts.getCurrentWorkspacePath());
    if (!wsPath) return { ok: false, error: "No workspace path provided and getCurrentWorkspacePath not available" };

    try {
      const git = simpleGit(wsPath);
      const remotes = await git.getRemotes(true);
      if (!remotes || remotes.length === 0) return { ok: false, error: "No git remotes found in workspace" };

      // Try origin first, then first remote
      const origin = remotes.find((r) => r.name === "origin") || remotes[0];
      const remoteUrl = origin?.refs?.fetch || origin?.refs?.push;
      if (!remoteUrl) return { ok: false, error: "Remote has no URL configured" };

      // Parse namespace/project from URL
      // HTTPS: https://gitlab.com/ns/project.git
      // SSH:   git@gitlab.com:ns/project.git
      let namespacePath = "";
      const httpsMatch = remoteUrl.match(/https?:\/\/[^/]+\/(.+?)(?:\.git)?$/);
      const sshMatch = remoteUrl.match(/git@[^:]+:(.+?)(?:\.git)?$/);
      if (httpsMatch) namespacePath = httpsMatch[1].replace(/\.git$/, "");
      else if (sshMatch) namespacePath = sshMatch[1].replace(/\.git$/, "");
      else return { ok: false, error: `Could not parse remote URL: ${remoteUrl}` };

      // Fetch accessible repos and match by namespace path
      const reposResult = await gitlabListRepos();
      if (!reposResult.ok) return { ok: false, error: reposResult.error };

      const match = reposResult.data.find((r) => {
        const fullPath = r.namespace ? `${r.namespace}/${r.name}` : r.name;
        return fullPath.toLowerCase() === namespacePath.toLowerCase();
      });

      if (!match) {
        return { ok: false, error: `No accessible GitLab repo matches "${namespacePath}". Token may lack access.`, remoteUrl, parsedPath: namespacePath };
      }

      return { ok: true, data: { projectId: match.id, name: match.name, namespace: match.namespace, webUrl: match.webUrl, remoteUrl, defaultBranch: match.defaultBranch } };
    } catch (err) {
      return { ok: false, error: `git_detect_project failed: ${err.message}` };
    }
  }

  // ─── Local Git Operations ──────────────────────────────────────────────────

  async function gitClone({ url, path: clonePath }) {
    if (!url) return { ok: false, error: "url is required" };
    if (!clonePath) return { ok: false, error: "path is required" };

    try {
      const git = simpleGit();
      await git.clone(url, clonePath);
      return { ok: true, data: { path: clonePath, url } };
    } catch (err) {
      return { ok: false, error: `git_clone failed: ${err.message}` };
    }
  }

  async function gitBranch({ path: repoPath, name, base }) {
    if (!repoPath) return { ok: false, error: "path is required" };
    if (!name) return { ok: false, error: "name is required" };

    try {
      const git = simpleGit(repoPath);
      if (base) {
        await git.checkoutBranch(name, base);
      } else {
        await git.checkoutLocalBranch(name);
      }
      return { ok: true, data: { branch: name, base: base || "HEAD" } };
    } catch (err) {
      return { ok: false, error: `git_branch failed: ${err.message}` };
    }
  }

  async function gitCommitPush({ path: repoPath, message, files, branch }) {
    if (!repoPath) return { ok: false, error: "path is required" };
    if (!message) return { ok: false, error: "message is required" };

    try {
      const git = simpleGit(repoPath);

      // Stage files
      if (files && files.length > 0) {
        await git.add(files);
      } else {
        await git.add(".");
      }

      const commitResult = await git.commit(message);

      // Push if branch specified or on current branch
      if (branch) {
        await git.push("origin", branch, ["--set-upstream"]);
      } else {
        await git.push(["--set-upstream"]);
      }

      return {
        ok: true,
        data: {
          commit: commitResult.commit,
          summary: commitResult.summary,
          branch: branch || "(current)",
        },
      };
    } catch (err) {
      return { ok: false, error: `git_commit_push failed: ${err.message}` };
    }
  }

  async function gitDiff({ path: repoPath, base, head }) {
    if (!repoPath) return { ok: false, error: "path is required" };

    try {
      const git = simpleGit(repoPath);
      const diffArgs = [];
      if (base && head) diffArgs.push(base, head);
      else if (base) diffArgs.push(base);

      const diff = await git.diff(diffArgs);
      const summary = await git.diffSummary(diffArgs);

      return {
        ok: true,
        data: {
          diff,
          filesChanged: summary.files?.length || 0,
          insertions: summary.insertions || 0,
          deletions: summary.deletions || 0,
        },
      };
    } catch (err) {
      return { ok: false, error: `git_diff failed: ${err.message}` };
    }
  }

  // ─── Return handlers ──────────────────────────────────────────────────────

  return {
    // GitLab
    gitlabListMrs,
    gitlabGetMr,
    gitlabCommentMr,
    gitlabCreateMr,
    gitlabUpdateMr,
    gitlabCreateIssue,
    gitlabGetFile,
    gitlabListRepos,
    gitDetectProject,
    // Git local
    gitClone,
    gitBranch,
    gitCommitPush,
    gitDiff,
  };
}

module.exports = { createGitHandlers };
