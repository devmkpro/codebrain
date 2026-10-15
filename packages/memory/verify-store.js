"use strict";

/* ═══════════════════════════════════════════════════════════════════════════
   VERIFICAÇÃO VISUAL — CONCESSÕES E EXECUÇÕES
   ═══════════════════════════════════════════════════════════════════════════

   Persistência de duas coisas: quem foi autorizado a logar (e até quando), e
   o veredito de cada verificação.

   O que NÃO está aqui, e não por esquecimento: senha, hash, cookie, token de
   sessão. Uma concessão é uma autorização com prazo, não uma credencial
   guardada. Ver o comentário da migração v3.

   ═══════════════════════════════════════════════════════════════════════════ */

/** Modos de login aceitos. Não existe um terceiro. */
const GRANT_MODES = new Set(["seeder", "manual"]);

/** Prazo padrão de uma concessão: uma hora. */
const DEFAULT_TTL_SECONDS = 3600;

function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Só loopback e faixa privada. Uma concessão contra host público seria a
 * ferramenta virando ponte de autenticação remota, e a recusa é no armazém
 * além de no handler — duas barreiras, porque uma só é uma barreira que
 * alguém contorna.
 */
function isLocalTarget(baseUrl) {
  let url;
  try { url = new URL(baseUrl); } catch { return false; }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".test") || host.endsWith(".local")) return true;
  return false;
}

/**
 * @param {any} db Conexão better-sqlite3 já migrada (>= v3).
 */
function createVerifyStore(db) {
  function getGrantRow(id) {
    return db.prepare(`SELECT * FROM verify_grants WHERE id = ?`).get(id);
  }

  /** Uma concessão expirada não é ativa, mesmo com status 'approved'. */
  function isUsable(row) {
    if (!row) return false;
    if (row.status !== "approved") return false;
    if (row.expires_at && row.expires_at < nowSeconds()) return false;
    return true;
  }

  function publicGrant(row) {
    if (!row) return null;
    return {
      id: row.id,
      workspace: row.workspace,
      base_url: row.base_url,
      identity: row.identity,
      role: row.role,
      mode: row.mode,
      status: isUsable(row) ? "approved" : row.status === "approved" ? "expired" : row.status,
      reason: row.reason,
      approved_by: row.approved_by,
      expires_at: row.expires_at,
      expires_in_seconds: row.expires_at ? Math.max(0, row.expires_at - nowSeconds()) : null,
      // A procedência da credencial é informação de auditoria; o VALOR nunca sai.
      credential_source: row.credential_file ? `${row.credential_file}:${row.credential_line}` : null,
      created_at: row.created_at,
    };
  }

  return {
    /**
     * Pede autorização para logar. Nasce `pending` — nada é liberado aqui.
     *
     * @param {{ workspace: string, base_url: string, identity: string, role?: string,
     *           mode?: string, reason?: string, credential_file?: string,
     *           credential_line?: number }} args
     */
    verifyGrantRequest({ workspace, base_url, identity, role, mode = "manual", reason, credential_file, credential_line }) {
      if (!workspace) return { ok: false, error: "workspace é obrigatório" };
      if (!identity) return { ok: false, error: "identity é obrigatória" };
      const m = String(mode).toLowerCase();
      if (!GRANT_MODES.has(m)) {
        return { ok: false, error: `mode inválido: ${mode}. Use ${[...GRANT_MODES].join(" | ")}` };
      }
      if (m === "seeder" && (!credential_file || !credential_line)) {
        return { ok: false, error: "mode 'seeder' exige credential_file + credential_line (a procedência no repositório)" };
      }

      const id = genId("grant");
      db.prepare(`
        INSERT INTO verify_grants (id, workspace, base_url, identity, role, mode, status, reason, credential_file, credential_line)
        VALUES (@id, @workspace, @base_url, @identity, @role, @mode, 'pending', @reason, @credential_file, @credential_line)
      `).run({
        id,
        workspace,
        base_url,
        identity,
        role: role || null,
        mode: m,
        reason: reason || null,
        credential_file: credential_file || null,
        credential_line: credential_line || null,
      });

      return {
        ok: true,
        status: "pending",
        grant: publicGrant(getGrantRow(id)),
        message: `Autorização PENDENTE. Nenhum login acontece até o usuário aprovar com verify_auth_approve(grant_id="${id}").`,
      };
    },

    /**
     * Aprova uma concessão pendente. `approved_by` é registrado porque uma
     * autorização sem autor é uma autorização que ninguém deu.
     */
    verifyGrantApprove({ grant_id, approved_by, ttl_seconds = DEFAULT_TTL_SECONDS }) {
      const row = getGrantRow(grant_id);
      if (!row) return { ok: false, error: "concessão não encontrada" };
      if (row.status === "approved" && isUsable(row)) {
        return { ok: true, status: "approved", grant: publicGrant(row), message: "já estava aprovada" };
      }
      if (row.status === "revoked") {
        return { ok: false, error: "concessão revogada; peça uma nova em vez de reaproveitar esta" };
      }
      const ttl = Math.max(60, Math.min(Number(ttl_seconds) || DEFAULT_TTL_SECONDS, 86400));
      db.prepare(`
        UPDATE verify_grants
           SET status = 'approved', approved_by = @approved_by, expires_at = @expires_at, updated_at = unixepoch()
         WHERE id = @id
      `).run({ id: grant_id, approved_by: approved_by || "user", expires_at: nowSeconds() + ttl });
      return { ok: true, status: "approved", grant: publicGrant(getGrantRow(grant_id)) };
    },

    /** Revoga. Vale tanto para pendente quanto para aprovada. */
    verifyGrantRevoke({ grant_id }) {
      const row = getGrantRow(grant_id);
      if (!row) return { ok: false, error: "concessão não encontrada" };
      db.prepare(`UPDATE verify_grants SET status = 'revoked', updated_at = unixepoch() WHERE id = ?`).run(grant_id);
      return { ok: true, status: "revoked", grant: publicGrant(getGrantRow(grant_id)) };
    },

    /** Concessão utilizável para este alvo, se existir. */
    verifyGrantUsable({ workspace, base_url, identity }) {
      const rows = db.prepare(`
        SELECT * FROM verify_grants
         WHERE workspace = ? AND status = 'approved'
         ORDER BY created_at DESC
      `).all(workspace);
      const match = rows.find((row) =>
        isUsable(row) &&
        (!base_url || row.base_url === base_url) &&
        (!identity || row.identity === identity));
      return { ok: true, usable: !!match, grant: publicGrant(match) };
    },

    verifyGrantList({ workspace, include_expired = false }) {
      const rows = db.prepare(`SELECT * FROM verify_grants WHERE workspace = ? ORDER BY created_at DESC LIMIT 100`).all(workspace);
      const grants = rows
        .map(publicGrant)
        .filter((g) => include_expired || g.status === "pending" || g.status === "approved");
      return { ok: true, count: grants.length, grants };
    },

    /** Uso INTERNO do handler de login: precisa do caminho da credencial. */
    verifyGrantInternal({ grant_id }) {
      const row = getGrantRow(grant_id);
      if (!row) return { ok: false, error: "concessão não encontrada" };
      if (!isUsable(row)) {
        return { ok: false, error: `concessão não utilizável (status: ${row.status}${row.expires_at && row.expires_at < nowSeconds() ? ", expirada" : ""})` };
      }
      return { ok: true, row };
    },

    /* ── Execuções ─────────────────────────────────────────────────────── */

    verifyRunCreate({ workspace, session_id, base_url, plan, evidence_dir }) {
      const id = genId("vrun");
      db.prepare(`
        INSERT INTO verify_runs (id, workspace, session_id, base_url, verdict, plan, evidence_dir)
        VALUES (@id, @workspace, @session_id, @base_url, 'planned', @plan, @evidence_dir)
      `).run({
        id,
        workspace,
        session_id: session_id || null,
        base_url: base_url || null,
        plan: JSON.stringify(plan || {}),
        evidence_dir: evidence_dir || null,
      });
      return { ok: true, run_id: id };
    },

    verifyRunFinish({ run_id, verdict, summary, results }) {
      const row = db.prepare(`SELECT id FROM verify_runs WHERE id = ?`).get(run_id);
      if (!row) return { ok: false, error: "execução não encontrada" };
      db.prepare(`
        UPDATE verify_runs
           SET verdict = @verdict, summary = @summary, results = @results, updated_at = unixepoch()
         WHERE id = @id
      `).run({
        id: run_id,
        verdict: verdict || "unknown",
        summary: summary || null,
        results: JSON.stringify(results || []),
      });
      return { ok: true, run_id, verdict };
    },

    verifyRunGet({ run_id }) {
      const row = db.prepare(`SELECT * FROM verify_runs WHERE id = ?`).get(run_id);
      if (!row) return { ok: true, data: null, message: "execução não encontrada" };
      const parse = (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } };
      return {
        ok: true,
        data: { ...row, plan: parse(row.plan, {}), results: parse(row.results, []) },
      };
    },

    verifyRunList({ workspace, limit = 20 }) {
      const rows = db.prepare(`
        SELECT id, session_id, base_url, verdict, summary, evidence_dir, created_at
          FROM verify_runs WHERE workspace = ? ORDER BY created_at DESC LIMIT ?
      `).all(workspace, Number(limit) || 20);
      return { ok: true, count: rows.length, runs: rows };
    },
  };
}

module.exports = { createVerifyStore, isLocalTarget, GRANT_MODES, DEFAULT_TTL_SECONDS };
