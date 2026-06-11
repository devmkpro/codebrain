/**
 * OAuth Service — GitLab + GitHub OAuth for Review Bot.
 *
 * GitLab: Standard Authorization Code flow with localhost callback server.
 * GitHub: Device Flow (best for desktop apps — no local server needed).
 *
 * Tokens are encrypted with a machine-derived key before being stored in SQLite.
 */

import * as http from "node:http";
import * as crypto from "node:crypto";
import { shell } from "electron";
import type { AppContext } from "../context";

// ── Encryption ──────────────────────────────────────────────────────────────

function getMachineKey(): Buffer {
  // Derive a consistent key from machine-specific data
  const machineId = [
    process.env.COMPUTERNAME || process.env.HOSTNAME || "unknown",
    process.env.USERNAME || process.env.USER || "unknown",
    process.platform,
    process.arch,
  ].join("-");
  return crypto.scryptSync(machineId, "codebrain-oauth-salt-v1", 32);
}

function encrypt(text: string): string {
  const key = getMachineKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decrypt(encryptedText: string): string {
  const key = getMachineKey();
  const [ivHex, data] = encryptedText.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(data, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// ── Token storage helpers (use memoryStore SQLite) ──────────────────────────

function ensureOAuthTable(memoryStore: any): void {
  try {
    memoryStore.db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_tokens (
        provider      TEXT PRIMARY KEY,
        access_token  TEXT NOT NULL,
        refresh_token TEXT,
        account       TEXT,
        expires_at    INTEGER,
        created_at    INTEGER DEFAULT (unixepoch())
      )
    `);
  } catch {
    // Table may already exist
  }
}

function saveToken(memoryStore: any, provider: string, accessToken: string, refreshToken: string | null, account: string | null, expiresAt: number | null): void {
  ensureOAuthTable(memoryStore);
  memoryStore.db.prepare(`
    INSERT OR REPLACE INTO oauth_tokens (provider, access_token, refresh_token, account, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, unixepoch())
  `).run(provider, encrypt(accessToken), refreshToken ? encrypt(refreshToken) : null, account, expiresAt);
}

function getToken(memoryStore: any, provider: string): { access_token: string; refresh_token: string | null; account: string | null; expires_at: number | null } | null {
  ensureOAuthTable(memoryStore);
  const row = memoryStore.db.prepare("SELECT * FROM oauth_tokens WHERE provider = ?").get(provider);
  if (!row) return null;
  try {
    return {
      access_token: decrypt(row.access_token),
      refresh_token: row.refresh_token ? decrypt(row.refresh_token) : null,
      account: row.account,
      expires_at: row.expires_at,
    };
  } catch {
    return null;
  }
}

function deleteToken(memoryStore: any, provider: string): void {
  ensureOAuthTable(memoryStore);
  memoryStore.db.prepare("DELETE FROM oauth_tokens WHERE provider = ?").run(provider);
}

// ── OAuth Status ────────────────────────────────────────────────────────────

export interface OAuthStatus {
  github: { connected: boolean; account?: string };
  gitlab: { connected: boolean; account?: string };
}

export function getOAuthStatus(ctx: AppContext): OAuthStatus {
  const ms = ctx.memoryStore;
  const gh = getToken(ms, "github");
  const gl = getToken(ms, "gitlab");
  return {
    github: { connected: !!gh, account: gh?.account || undefined },
    gitlab: { connected: !!gl, account: gl?.account || undefined },
  };
}

// ── Get OAuth token for use in MR handlers ──────────────────────────────────

export function getOAuthToken(ctx: AppContext, provider: "github" | "gitlab"): string | null {
  const tokenData = getToken(ctx.memoryStore, provider);
  if (!tokenData) return null;
  // Check expiry
  if (tokenData.expires_at && tokenData.expires_at < Date.now() / 1000) {
    // Token expired — try refresh for GitLab
    if (provider === "gitlab" && tokenData.refresh_token) {
      // Refresh happens async; return null for now
      return null;
    }
    deleteToken(ctx.memoryStore, provider);
    return null;
  }
  return tokenData.access_token;
}

// ── GitLab OAuth (Authorization Code Flow) ──────────────────────────────────

export async function connectGitLab(ctx: AppContext, config: { clientId: string; clientSecret: string }): Promise<{ ok: boolean; account?: string; error?: string }> {
  const { clientId, clientSecret } = config;
  if (!clientId || !clientSecret) {
    return { ok: false, error: "GitLab Client ID and Client Secret are required. Create a GitLab Application at gitlab.com/-/user_settings/applications" };
  }

  const port = 19876; // Fixed port for OAuth callback
  const redirectUri = `http://localhost:${port}/callback`;

  return new Promise((resolve) => {
    let server: http.Server | null = null;
    let resolved = false;

    const cleanup = () => {
      if (server) {
        try { server.close(); } catch {}
        server = null;
      }
    };

    // Create temporary HTTP server to receive callback
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url || "/", `http://localhost:${port}`);

      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<h2>OAuth Canceled</h2><p>You can close this window.</p>");
          cleanup();
          if (!resolved) { resolved = true; resolve({ ok: false, error: `OAuth error: ${error}` }); }
          return;
        }

        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<h2>Missing code</h2>");
          return;
        }

        // Exchange code for token
        try {
          const tokenRes = await fetch("https://gitlab.com/oauth/token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              client_id: clientId,
              client_secret: clientSecret,
              code,
              grant_type: "authorization_code",
              redirect_uri: redirectUri,
            }),
          });

          const tokenData = await tokenRes.json() as any;

          if (!tokenData.access_token) {
            res.writeHead(400, { "Content-Type": "text/html" });
            res.end("<h2>Token exchange failed</h2><p>Check your Client ID and Secret.</p>");
            cleanup();
            if (!resolved) { resolved = true; resolve({ ok: false, error: "Token exchange failed — check Client ID and Secret" }); }
            return;
          }

          // Fetch user info
          let account: string | null = null;
          try {
            const userRes = await fetch("https://gitlab.com/api/v4/user", {
              headers: { Authorization: `Bearer ${tokenData.access_token}` },
            });
            const userData = await userRes.json() as any;
            account = userData.username || null;
          } catch {}

          // Save token
          const expiresAt = tokenData.created_at && tokenData.expires_in
            ? tokenData.created_at + tokenData.expires_in
            : null;
          saveToken(ctx.memoryStore, "gitlab", tokenData.access_token, tokenData.refresh_token || null, account, expiresAt);

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html><body style="font-family:system-ui;background:#0A0A0B;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
              <div style="text-align:center">
                <h2 style="color:#4ade80">GitLab Connected!</h2>
                <p>Logged in as <strong>@${account || "unknown"}</strong></p>
                <p style="color:#64748b;font-size:14px">You can close this window and return to Codebrain.</p>
              </div>
            </body></html>
          `);
          cleanup();
          if (!resolved) { resolved = true; resolve({ ok: true, account: account || undefined }); }
        } catch (err: any) {
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end("<h2>Error</h2><p>" + (err.message || "Unknown error") + "</p>");
          cleanup();
          if (!resolved) { resolved = true; resolve({ ok: false, error: err.message }); }
        }
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    server.on("error", (err: any) => {
      if (err.code === "EADDRINUSE") {
        if (!resolved) { resolved = true; resolve({ ok: false, error: `Port ${port} is already in use. Close other OAuth flows first.` }); }
      } else {
        if (!resolved) { resolved = true; resolve({ ok: false, error: err.message }); }
      }
      cleanup();
    });

    server.listen(port, "127.0.0.1", () => {
      // Open browser with GitLab OAuth URL
      const authUrl = new URL("https://gitlab.com/oauth/authorize");
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", "api");
      shell.openExternal(authUrl.toString());
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({ ok: false, error: "OAuth flow timed out (5 min). Try again." });
      }
    }, 5 * 60 * 1000);
  });
}

// ── GitHub OAuth (Device Flow) ──────────────────────────────────────────────

export async function connectGitHub(ctx: AppContext, config: { clientId: string }): Promise<{ ok: boolean; account?: string; userCode?: string; verificationUri?: string; error?: string }> {
  const { clientId } = config;
  if (!clientId) {
    return { ok: false, error: "GitHub Client ID is required. Create a GitHub OAuth App at github.com/settings/developers (no client secret needed for Device Flow)" };
  }

  // Step 1: Request device code
  let deviceData: any;
  try {
    const res = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        scope: "repo",
      }),
    });
    deviceData = await res.json();
  } catch (err: any) {
    return { ok: false, error: `Failed to start device flow: ${err.message}` };
  }

  if (!deviceData.device_code) {
    return { ok: false, error: "Failed to get device code. Check your Client ID." };
  }

  const { device_code, user_code, verification_uri, interval = 5 } = deviceData;

  // Open browser for user to authorize
  shell.openExternal(verification_uri);

  // Step 2: Poll for authorization
  const maxPolls = 120; // ~10 minutes at 5s intervals
  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, (interval + 1) * 1000));

    try {
      const pollRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });

      const pollData = await pollRes.json() as any;

      if (pollData.access_token) {
        // Success! Fetch user info
        let account: string | null = null;
        try {
          const userRes = await fetch("https://api.github.com/user", {
            headers: {
              Authorization: `Bearer ${pollData.access_token}`,
              "User-Agent": "Codebrain",
            },
          });
          const userData = await userRes.json() as any;
          account = userData.login || null;
        } catch {}

        saveToken(ctx.memoryStore, "github", pollData.access_token, null, account, null);
        return { ok: true, account: account || undefined };
      }

      if (pollData.error === "authorization_pending") {
        // Still waiting — continue polling
        continue;
      }

      if (pollData.error === "slow_down") {
        // Rate limited — wait a bit longer
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      // Any other error = failure
      return { ok: false, error: `GitHub OAuth error: ${pollData.error_description || pollData.error}` };
    } catch (err: any) {
      return { ok: false, error: `Polling failed: ${err.message}` };
    }
  }

  return { ok: false, error: "GitHub OAuth timed out (10 min). The user_code may have expired." };
}

// ── Disconnect ──────────────────────────────────────────────────────────────

export function disconnectOAuth(ctx: AppContext, provider: "github" | "gitlab"): void {
  deleteToken(ctx.memoryStore, provider);
}

// ── Refresh GitLab token ────────────────────────────────────────────────────

export async function refreshGitLabToken(ctx: AppContext, config: { clientId: string; clientSecret: string }): Promise<boolean> {
  const ms = ctx.memoryStore;
  const tokenData = getToken(ms, "gitlab");
  if (!tokenData?.refresh_token) return false;

  try {
    const res = await fetch("https://gitlab.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: tokenData.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    const data = await res.json() as any;
    if (!data.access_token) return false;

    const expiresAt = data.created_at && data.expires_in
      ? data.created_at + data.expires_in
      : null;
    saveToken(ms, "gitlab", data.access_token, data.refresh_token || null, tokenData.account, expiresAt);
    return true;
  } catch {
    return false;
  }
}
