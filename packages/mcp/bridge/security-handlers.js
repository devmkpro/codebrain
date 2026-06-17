"use strict";

/**
 * Security Scanner MCP Handlers
 * Scans codebases for secrets, vulnerabilities, and dependency issues.
 * Results stored in memory for tracking across sessions.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ─── Secret Patterns ─────────────────────────────────────────────────

const SECRET_PATTERNS = [
  { name: "password", regex: /password\s*[:=]\s*['"][^'"]{4,}['"]/gi, severity: "critical" },
  { name: "api_key", regex: /api[_-]?key\s*[:=]\s*['"][^'"]{8,}['"]/gi, severity: "critical" },
  { name: "secret", regex: /secret\s*[:=]\s*['"][^'"]{8,}['"]/gi, severity: "critical" },
  { name: "token", regex: /(?:bearer|auth|access|refresh)[_-]?token\s*[:=]\s*['"][^'"]{8,}['"]/gi, severity: "high" },
  { name: "private_key", regex: /private[_-]?key\s*[:=]\s*['"][^'"]{20,}['"]/gi, severity: "critical" },
  { name: "aws_key", regex: /(?:AKIA|ASIA)[A-Z0-9]{16}/g, severity: "critical" },
  { name: "connection_string", regex: /(?:mongodb|postgres|mysql|redis):\/\/[^\s'"]{10,}/gi, severity: "high" },
];

// ─── Vulnerability Patterns ──────────────────────────────────────────

const VULN_PATTERNS = [
  { name: "sql_injection", regex: /(?:execute|query|raw)\s*\(\s*['"`].*\$\{/g, severity: "critical", lang: "js" },
  { name: "command_injection", regex: /(?:exec|spawn|execSync)\s*\(\s*['"`].*\$\{/g, severity: "critical", lang: "js" },
  { name: "eval_usage", regex: /\beval\s*\(/g, severity: "high", lang: "js" },
  { name: "innerhtml", regex: /\.innerHTML\s*=/g, severity: "medium", lang: "js" },
  { name: "dangerouslySetInnerHTML", regex: /dangerouslySetInnerHTML/g, severity: "medium", lang: "jsx" },
  { name: "php_eval", regex: /\beval\s*\(/g, severity: "critical", lang: "php" },
  { name: "php_exec", regex: /\b(?:exec|passthru|system|shell_exec|popen)\s*\(/g, severity: "high", lang: "php" },
  { name: "python_exec", regex: /\b(?:os\.system|subprocess\.call|exec)\s*\(/g, severity: "high", lang: "py" },
];

// ─── File Extensions to Scan ─────────────────────────────────────────

const SCAN_EXTENSIONS = new Set([
  ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs",
  ".py", ".php", ".rb", ".go", ".rs",
  ".json", ".yaml", ".yml", ".toml", ".env",
  ".xml", ".html", ".vue", ".svelte",
]);

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage",
  "__pycache__", ".venv", "venv", "vendor", ".claude",
]);

// ─── File Walker ─────────────────────────────────────────────────────

/**
 * Walk directory tree and return files matching extensions.
 * @param {string} dir
 * @param {number} [maxDepth=8]
 * @returns {string[]}
 */
function walkFiles(dir, maxDepth = 8) {
  const results = [];
  function walk(current, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch { return; }
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SCAN_EXTENSIONS.has(ext)) {
          results.push(fullPath);
        }
      }
    }
  }
  walk(dir, 0);
  return results;
}

// ─── Scanner ─────────────────────────────────────────────────────────

function createSecurityHandlers(opts) {
  let _lastScan = 0;
  const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

  return {
    /**
     * Scan a directory for security issues.
     * @param {object} args
     * @param {string} [args.path] - Directory to scan (default: workspace)
     * @param {string} [args.type="full"] - Scan type: "full", "secrets", "vulnerabilities"
     * @param {boolean} [args.force=false] - Bypass cooldown
     */
    async securityScan({ path: scanPath, type = "full", force = false } = {}) {
      try {
        // Cooldown check
        const now = Date.now();
        if (!force && now - _lastScan < COOLDOWN_MS) {
          const remaining = Math.ceil((COOLDOWN_MS - (now - _lastScan)) / 60000);
          return {
            ok: true,
            data: {
              status: "throttled",
              message: `Scan cooldown active. Try again in ${remaining} minutes, or use force=true.`,
              remainingMinutes: remaining,
            },
          };
        }

        const targetDir = scanPath || opts.getCurrentWorkspacePath?.() || process.cwd();
        if (!fs.existsSync(targetDir)) {
          return { ok: false, error: `Directory not found: ${targetDir}` };
        }

        const findings = { secrets: [], vulnerabilities: [] };
        const files = walkFiles(targetDir);
        let filesScanned = 0;

        for (const filePath of files) {
          let content;
          try {
            content = fs.readFileSync(filePath, "utf-8");
          } catch { continue; }
          filesScanned++;

          const relPath = path.relative(targetDir, filePath);
          const ext = path.extname(filePath).toLowerCase();

          // Secret scanning
          if (type === "full" || type === "secrets") {
            for (const pattern of SECRET_PATTERNS) {
              const matches = content.matchAll(pattern.regex);
              for (const match of matches) {
                // Skip test files and examples
                if (relPath.includes("test") || relPath.includes("example") || relPath.includes("mock")) continue;
                findings.secrets.push({
                  type: pattern.name,
                  severity: pattern.severity,
                  file: relPath,
                  line: content.slice(0, match.index).split("\n").length,
                  snippet: match[0].slice(0, 80) + "...",
                });
              }
            }
          }

          // Vulnerability scanning
          if (type === "full" || type === "vulnerabilities") {
            for (const pattern of VULN_PATTERNS) {
              // Check language match
              if (pattern.lang === "js" && ![".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs"].includes(ext)) continue;
              if (pattern.lang === "jsx" && ![".jsx", ".tsx"].includes(ext)) continue;
              if (pattern.lang === "py" && ext !== ".py") continue;
              if (pattern.lang === "php" && ext !== ".php") continue;

              const matches = content.matchAll(pattern.regex);
              for (const match of matches) {
                if (relPath.includes("test") || relPath.includes("spec")) continue;
                findings.vulnerabilities.push({
                  type: pattern.name,
                  severity: pattern.severity,
                  file: relPath,
                  line: content.slice(0, match.index).split("\n").length,
                  snippet: match[0].slice(0, 80),
                });
              }
            }
          }
        }

        const totalFindings = findings.secrets.length + findings.vulnerabilities.length;
        const status = totalFindings > 10 ? "critical" : totalFindings > 0 ? "warning" : "clean";
        _lastScan = now;

        const result = {
          status,
          timestamp: new Date().toISOString(),
          filesScanned,
          findings: {
            secrets: findings.secrets.length,
            vulnerabilities: findings.vulnerabilities.length,
            total: totalFindings,
          },
          details: {
            secrets: findings.secrets.slice(0, 50), // Cap at 50 for output
            vulnerabilities: findings.vulnerabilities.slice(0, 50),
          },
        };

        // Store result in memory for tracking
        if (opts.memoryStore) {
          try {
            opts.memoryStore.write({
              type: "episodic",
              key: `security-scan:${new Date().toISOString().split("T")[0]}`,
              content: JSON.stringify({ status, findings: result.findings, filesScanned }),
              tags: ["security", "scan", status],
              agent_id: "security-scanner",
              scope: "project",
            });
          } catch { /* ignore */ }
        }

        return { ok: true, data: result };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    /**
     * Get last scan result from memory.
     */
    async securityStatus() {
      try {
        if (!opts.memoryStore) return { ok: true, data: { status: "unknown", message: "Memory store not available" } };

        const scans = opts.memoryStore.list({ type: "episodic", limit: 5 });
        const securityScans = (scans || []).filter(s => s.key?.startsWith("security-scan:"));

        if (securityScans.length === 0) {
          return { ok: true, data: { status: "no-scans", message: "No security scans found. Run security_scan first." } };
        }

        const latest = JSON.parse(securityScans[0].content);
        return {
          ok: true,
          data: {
            lastScan: securityScans[0].key,
            ...latest,
          },
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  };
}

module.exports = { createSecurityHandlers };
