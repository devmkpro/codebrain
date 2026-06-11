"use strict";

/**
 * MR/PR Review bridge handlers — List, detail, review, and comment on
 * merge requests / pull requests via GitHub (gh) or GitLab (glab) CLI.
 *
 * Auto-detects the provider from the git remote origin URL.
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const COMMENT_SIGNATURE = "\n\n---\n🧠 *Posted by Codebrain AI Review*";

// ═══════════════════════════════════════════════════════════════════════════
// CLI PATH RESOLUTION — find gh/glab even if not in shell PATH
// ═══════════════════════════════════════════════════════════════════════════

const _cliPathCache = {};

function resolveCliPath(cli) {
  if (_cliPathCache[cli]) return _cliPathCache[cli];

  const isWin = os.platform() === "win32";
  const ext = isWin ? ".exe" : "";
  const bin = cli + ext;

  // 1) Try where/which with FULL system PATH (not just inherited)
  try {
    if (isWin) {
      // Refresh PATH from registry — Electron may have stale PATH
      const sysPath = execSync(
        'powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable(\'PATH\',\'Machine\')+\';\'+[System.Environment]::GetEnvironmentVariable(\'PATH\',\'User\')"',
        { encoding: "utf-8", timeout: 8000, stdio: ["pipe", "pipe", "pipe"] }
      ).trim();
      const found = execSync(`where ${cli}`, {
        encoding: "utf-8", timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PATH: sysPath },
      }).trim().split(/\r?\n/)[0];
      if (found && fs.existsSync(found)) { _cliPathCache[cli] = found; return found; }
    } else {
      const found = execSync(`which ${cli}`, { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }).trim();
      if (found) { _cliPathCache[cli] = found; return found; }
    }
  } catch { /* not in PATH */ }

  // 2) Check common install locations per OS
  const home = os.homedir();
  const candidates = isWin ? [
    path.join(home, "AppData", "Local", "Programs", cli, bin),
    path.join(home, "AppData", "Local", "Programs", cli.toUpperCase(), bin),
    path.join(home, "AppData", "Local", "Microsoft", "WinGet", "Links", bin),
    path.join(home, "AppData", "Local", "Microsoft", "WinGet", "Packages", `*${cli}*`, bin),
    `C:\\Program Files\\${cli}\\bin\\${bin}`,
    `C:\\Program Files\\${cli}\\${bin}`,
    `C:\\Program Files (x86)\\${cli}\\${bin}`,
    path.join(home, "scoop", "shims", bin),
    path.join(home, "scoop", "apps", cli, "current", bin),
    `C:\\ProgramData\\chocolatey\\bin\\${bin}`,
  ] : [
    `/usr/local/bin/${cli}`,
    `/usr/bin/${cli}`,
    `/opt/homebrew/bin/${cli}`,
    path.join(home, `.local/bin/${cli}`),
    `/snap/bin/${cli}`,
    `/home/linuxbrew/.linuxbrew/bin/${cli}`,
    path.join(home, `.nix-profile/bin/${cli}`),
  ];

  for (const p of candidates) {
    // Support glob-like wildcard in WinGet Packages path
    if (p.includes("*")) {
      try {
        const dir = path.dirname(p);
        const parentDir = path.dirname(dir);
        if (fs.existsSync(parentDir)) {
          const matches = fs.readdirSync(parentDir).filter(d => d.toLowerCase().includes(cli.toLowerCase()));
          for (const m of matches) {
            const full = path.join(parentDir, m, bin);
            if (fs.existsSync(full)) { _cliPathCache[cli] = full; return full; }
            // Check nested dirs
            try {
              const sub = fs.readdirSync(path.join(parentDir, m));
              for (const s of sub) {
                const nested = path.join(parentDir, m, s, bin);
                if (fs.existsSync(nested)) { _cliPathCache[cli] = nested; return nested; }
              }
            } catch { /* skip */ }
          }
        }
      } catch { /* skip */ }
      continue;
    }
    try { if (fs.existsSync(p)) { _cliPathCache[cli] = p; return p; } } catch { /* skip */ }
  }

  return null; // not found
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detect the git provider from the remote origin URL.
 * @param {string} cwd - Working directory of the git repo
 * @returns {{ provider: 'github'|'gitlab', cli: 'gh'|'glab', repo: string, remote_url: string, access_method: 'ssh'|'https' }}
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

  const accessMethod = remoteUrl.startsWith("git@") || remoteUrl.startsWith("ssh://") ? "ssh" : "https";

  if (remoteUrl.includes("github.com")) {
    return { provider: "github", cli: "gh", repo: extractRepoSlug(remoteUrl), remote_url: remoteUrl, access_method: accessMethod };
  }

  if (remoteUrl.includes("gitlab.com") || remoteUrl.includes("gitlab")) {
    return { provider: "gitlab", cli: "glab", repo: extractRepoSlug(remoteUrl), remote_url: remoteUrl, access_method: accessMethod };
  }

  // Default to GitHub for enterprise hosts (most common)
  return { provider: "github", cli: "gh", repo: extractRepoSlug(remoteUrl), remote_url: remoteUrl, access_method: accessMethod };
}

/**
 * Check if a CLI binary is available on the system.
 * @param {string} cli - 'gh' or 'glab'
 * @returns {{ installed: boolean, version: string|null }}
 */
function checkCliInstalled(cli) {
  const fullPath = resolveCliPath(cli);
  if (!fullPath) return { installed: false, version: null, path: null };
  try {
    const quoted = fullPath.includes(" ") ? `"${fullPath}"` : fullPath;
    const version = execSync(`${quoted} --version`, {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return { installed: true, version: version.split("\n")[0], path: fullPath };
  } catch {
    return { installed: false, version: null, path: fullPath };
  }
}

/**
 * Check if the CLI is authenticated.
 * @param {string} cli - 'gh' or 'glab'
 * @returns {{ authenticated: boolean, account: string|null }}
 */
function checkCliAuth(cli) {
  const fullPath = resolveCliPath(cli);
  const cmd = fullPath ? (fullPath.includes(" ") ? `"${fullPath}"` : fullPath) : cli;
  try {
    const output = execSync(`${cmd} auth status`, {
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    // gh auth status prints "Logged in to github.com account <user>"
    // glab auth status prints "Logged in to gitlab.com as <user>"
    const accountMatch = output.match(/(?:account|as)\s+(\S+)/i);
    return { authenticated: true, account: accountMatch?.[1] || null };
  } catch (err) {
    // Exit code 1 = not authenticated
    const stderr = err.stderr ? err.stderr.toString() : "";
    const stdout = err.stdout ? err.stdout.toString() : "";
    const combined = stderr + stdout;
    // Some CLIs output auth info to stderr even on success
    if (combined.includes("Logged in") || combined.includes("logged in")) {
      const accountMatch = combined.match(/(?:account|as)\s+(\S+)/i);
      return { authenticated: true, account: accountMatch?.[1] || null };
    }
    return { authenticated: false, account: null };
  }
}

/**
 * Check SSH connectivity to a git host.
 * @param {string} host - e.g. 'github.com', 'gitlab.com'
 * @returns {{ ok: boolean, message: string }}
 */
function checkSshAccess(host) {
  try {
    const output = execSync(`ssh -T git@${host} -o ConnectTimeout=10 -o StrictHostKeyChecking=no`, {
      encoding: "utf-8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    // GitHub: "Hi <user>! You've successfully authenticated..."
    // GitLab: "Welcome to GitLab, @<user>!"
    return { ok: true, message: output };
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : "";
    const stdout = err.stdout ? err.stdout.toString() : "";
    const combined = stderr + stdout;
    // SSH may exit non-zero but still authenticate (GitHub does this)
    if (combined.includes("successfully authenticated") || combined.includes("Welcome to GitLab")) {
      return { ok: true, message: combined.trim() };
    }
    if (combined.includes("Permission denied") || combined.includes("publickey")) {
      return { ok: false, message: "SSH key not authorized. Add your SSH key to your GitHub/GitLab account." };
    }
    if (combined.includes("timed out") || combined.includes("Connection refused") || combined.includes("connect to host")) {
      return { ok: false, message: `SSH connection to ${host} failed. Network or firewall may be blocking.` };
    }
    return { ok: false, message: combined.trim() || err.message };
  }
}

/**
 * Get platform-specific install instructions for a CLI.
 * @param {string} cli - 'gh' or 'glab'
 * @returns {{ windows: string, mac: string, linux: string, docs: string }}
 */
function getInstallInstructions(cli) {
  const platform = os.platform();
  if (cli === "gh") {
    return {
      windows: "winget install GitHub.cli",
      mac: "brew install gh",
      linux: "sudo apt install gh  # or: sudo dnf install gh",
      docs: "https://github.com/cli/cli#installation",
      recommended: platform === "win32" ? "winget install GitHub.cli" : platform === "darwin" ? "brew install gh" : "sudo apt install gh",
    };
  }
  // glab
  return {
    windows: "winget install GLab.GLab",
    mac: "brew install glab",
    linux: "sudo apt install glab  # or: brew install glab",
    docs: "https://gitlab.com/gitlab-org/cli#installation",
    recommended: platform === "win32" ? "winget install GLab.GLab" : platform === "darwin" ? "brew install glab" : "sudo apt install glab",
  };
}

/**
 * Full diagnostic: check remote, CLI, auth, access.
 * @param {string} cwd
 * @returns {{ ok, provider, remote_url, access_method, cli_installed, cli_authenticated, can_push, issues, ready }}
 */
function runDiagnostics(cwd) {
  const issues = [];
  const platform = os.platform();

  // Step 1: Detect remote
  let gitInfo;
  try {
    gitInfo = detectGitProvider(cwd);
  } catch (err) {
    return {
      ok: false,
      provider: null,
      remote_url: null,
      access_method: null,
      cli_installed: null,
      cli_authenticated: null,
      can_push: false,
      issues: [{ problem: err.message, fix: "Ensure you are in a git repository with an 'origin' remote.", severity: "blocking" }],
      ready: false,
    };
  }

  const { provider, cli, remote_url, access_method } = gitInfo;

  // Step 2: Check CLI installed
  const cliCheck = checkCliInstalled(cli);
  const cliInstalled = cliCheck.installed;

  if (!cliInstalled) {
    const install = getInstallInstructions(cli);
    issues.push({
      problem: `${cli} CLI not found`,
      fix: `Install with: ${install.recommended}`,
      severity: "blocking",
      install_commands: { windows: install.windows, mac: install.mac, linux: install.linux, docs: install.docs },
    });
  }

  // Step 3: Check CLI auth (only if installed)
  let cliAuth = { authenticated: false, account: null };
  if (cliInstalled) {
    cliAuth = checkCliAuth(cli);
    if (!cliAuth.authenticated) {
      issues.push({
        problem: `${cli} CLI not authenticated`,
        fix: `Run: ${cli} auth login`,
        severity: "blocking",
      });
    }
  }

  // Step 4: Check access method (SSH vs HTTPS)
  let canPush = false;
  let host = provider === "github" ? "github.com" : "gitlab.com";

  if (access_method === "ssh") {
    const sshCheck = checkSshAccess(host);
    canPush = sshCheck.ok;
    if (!sshCheck.ok) {
      issues.push({
        problem: `SSH access to ${host} failed: ${sshCheck.message}`,
        fix: `Add your SSH key to ${host}, or switch to HTTPS: git remote set-url origin https://${host}/${gitInfo.repo}.git`,
        severity: "blocking",
      });
    }
  } else {
    // HTTPS — assume ok if CLI is authenticated (credential helper or token)
    canPush = cliAuth.authenticated;
    if (!canPush && cliInstalled) {
      issues.push({
        problem: "HTTPS credentials may not be configured",
        fix: `Ensure ${cli} auth login sets up credential helper, or configure: git config --global credential.helper store`,
        severity: "warning",
      });
    }
  }

  const ready = cliInstalled && cliAuth.authenticated && canPush && issues.filter(i => i.severity === "blocking").length === 0;

  return {
    ok: true,
    provider,
    remote_url,
    access_method,
    cli_installed: cliInstalled,
    cli_version: cliCheck.version,
    cli_authenticated: cliAuth.authenticated,
    cli_account: cliAuth.account,
    can_push: canPush,
    issues,
    ready,
  };
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
  // Replace bare "gh " or "glab " with resolved full path
  let resolvedCmd = cmd;
  for (const cli of ["glab", "gh"]) {
    if (cmd.startsWith(cli + " ")) {
      const fullPath = resolveCliPath(cli);
      if (fullPath) {
        const quoted = fullPath.includes(" ") ? `"${fullPath}"` : fullPath;
        resolvedCmd = quoted + cmd.slice(cli.length);
      }
      break;
    }
  }

  try {
    return execSync(resolvedCmd, {
      cwd,
      encoding: "utf-8",
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024, // 10MB for large diffs
    }).trim();
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().trim() : "";
    const stdout = err.stdout ? err.stdout.toString().trim() : "";
    throw new Error(`CLI error (${resolvedCmd}): ${stderr || stdout || err.message}`);
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

/**
 * Guard: check if CLI is ready before running MR commands.
 * Returns null if ready, or a friendly error response if not.
 * @param {string} cwd
 * @returns {null | { ok: false, error: string, setup_needed: true, diagnostic: object }}
 */
function ensureCliReady(cwd) {
  try {
    const info = detectGitProvider(cwd);
    const cliCheck = checkCliInstalled(info.cli);
    if (!cliCheck.installed) {
      const install = getInstallInstructions(info.cli);
      return {
        ok: false,
        error: `${info.cli} CLI not found. Run mr_setup to diagnose and fix.`,
        setup_needed: true,
        quick_fix: install.recommended,
      };
    }
    const authCheck = checkCliAuth(info.cli);
    if (!authCheck.authenticated) {
      return {
        ok: false,
        error: `${info.cli} CLI not authenticated. Run: ${info.cli} auth login`,
        setup_needed: true,
        quick_fix: `${info.cli} auth login`,
      };
    }
    return null; // Ready
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      setup_needed: true,
    };
  }
}

function createMRHandlers() {
  return {
    /**
     * Smart diagnostic: check if the workspace is ready for MR operations.
     */
    async mrSetup({ cwd }) {
      if (!cwd) return { ok: false, error: "cwd (workspace path) is required" };
      return runDiagnostics(cwd);
    },

    /**
     * List MRs/PRs for the repository.
     */
    async mrList({ cwd, state = "open", limit = 20 }) {
      if (!cwd) return { ok: false, error: "cwd (workspace path) is required" };

      // Guard: ensure CLI is ready
      const notReady = ensureCliReady(cwd);
      if (notReady) return notReady;

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

        // GitLab (glab) — no --state flag; uses --closed, --merged, --all
        const glabStateFlag = state === "open" ? "" : state === "closed" ? "--closed" : "--all";
        const data = runCliJson(
          `glab mr list ${glabStateFlag} --per-page ${limit} -F json`.replace(/\s+/g, " ").trim(),
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

      // Guard: ensure CLI is ready
      const notReady = ensureCliReady(cwd);
      if (notReady) return notReady;

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

      // Guard: ensure CLI is ready
      const notReady = ensureCliReady(cwd);
      if (notReady) return notReady;

      // Append signature so readers know the comment was generated by AI
      const signedBody = body + COMMENT_SIGNATURE;

      // Write body to temp file to avoid shell escaping issues with markdown/emojis
      const tmpDir = os.tmpdir();
      const tmpFile = path.join(tmpDir, `codebrain-mr-comment-${Date.now()}.md`);

      try {
        fs.writeFileSync(tmpFile, signedBody, "utf-8");
        const { provider, cli } = detectGitProvider(cwd);

        if (cli === "gh") {
          if (file && line) {
            const pr = runCliJson(`gh pr view ${id} --json headRefOid`, cwd);
            const commitSha = pr.headRefOid;

            if (!commitSha) {
              const result = runCli(`gh pr comment ${id} --body-file "${tmpFile}"`, cwd);
              const commentUrl = result.match(/(https:\/\/[^\s]+)/)?.[1] || null;
              return { ok: true, provider, comment_url: commentUrl, inline: false, message: "Could not get commit SHA for inline comment; posted as general comment" };
            }

            // Use gh api to post inline comment (body from file)
            const escapedBody = signedBody.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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

          // Regular comment via temp file
          const result = runCli(`gh pr comment ${id} --body-file "${tmpFile}"`, cwd);
          const commentUrl = result.match(/(https:\/\/[^\s]+)/)?.[1] || null;
          return { ok: true, provider, comment_url: commentUrl };
        }

        // GitLab (glab) — use execFileSync to pass body as arg without shell escaping
        const { execFileSync } = require("child_process");
        const glabPath = resolveCliPath("glab") || "glab";
        const args = ["mr", "note", "create", String(id), "--resolvable=false", "-m", signedBody];
        if (file) { args.push("--file", file); }
        if (line) { args.push("--line", String(line)); }
        const result = execFileSync(glabPath, args, {
          cwd, encoding: "utf-8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"],
        }).trim();
        return { ok: true, provider, message: "Comment posted" };
      } catch (err) {
        return { ok: false, error: err.message };
      } finally {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore cleanup errors */ }
      }
    },
  };
}

module.exports = { createMRHandlers, detectGitProvider, extractRepoSlug, runDiagnostics, resolveCliPath };
