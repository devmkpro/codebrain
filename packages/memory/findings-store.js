"use strict";

/* Findings: um defeito por registro, com evidência obrigatória e ciclo de vida.

   As regras ficam aqui, não no prompt: quem corrigiu não pode dar o próprio
   trabalho por verificado, e um defeito que volta reabre o mesmo ID em vez de
   gerar um novo, para o histórico da regressão não se perder. */

const TRANSITIONS = {
  open: ["fixed", "needs_decision"],
  fixed: ["verified", "reopened"],
  reopened: ["fixed", "needs_decision"],
  needs_decision: ["open"],
  verified: ["reopened"],
};

const STATUSES = Object.keys(TRANSITIONS);
const SEVERITIES = ["high", "medium", "low"];
const CATEGORIES = ["functional", "usability", "visual", "performance", "security"];
const hasText = (value) => typeof value === "string" && Boolean(value.trim());

const fingerprint = (title, location) =>
  `${title} ${location}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function parseRow(row) {
  if (!row) return null;
  let evidence = [];
  try {
    const parsed = JSON.parse(row.evidence || "[]");
    if (Array.isArray(parsed)) evidence = parsed;
  } catch {}
  return { ...row, evidence };
}

function createFindingsStore(db) {
  const stmts = {
    insert: db.prepare(`
      INSERT INTO findings (id, workspace, mission_id, title, category, severity, status, location,
        steps, expected, observed, evidence, fingerprint, reporter)
      VALUES (@id, @workspace, @mission_id, @title, @category, @severity, 'open', @location,
        @steps, @expected, @observed, @evidence, @fingerprint, @reporter)
    `),
    byFingerprint: db.prepare(`SELECT * FROM findings WHERE workspace = ? AND fingerprint = ?`),
    get: db.prepare(`SELECT * FROM findings WHERE workspace = ? AND id = ?`),
    maxSeq: db.prepare(
      `SELECT COALESCE(MAX(CAST(SUBSTR(id, 3) AS INTEGER)), 0) AS seq FROM findings WHERE workspace = ?`
    ),
    update: db.prepare(`
      UPDATE findings SET status = @status, evidence = @evidence, fixed_by = @fixed_by, fix_note = @fix_note,
        fix_commit = @fix_commit, verified_by = @verified_by, updated_at = unixepoch()
      WHERE workspace = @workspace AND id = @id
    `),
    stats: db.prepare(
      `SELECT status, COUNT(*) AS count FROM findings WHERE workspace = ? GROUP BY status`
    ),
  };

  const stamp = (text, actor) => ({ text, actor: actor ?? null, at: Date.now() });

  const api = {
    findingAdd({
      workspace,
      missionId,
      title,
      category,
      severity,
      location,
      steps,
      expected,
      observed,
      evidence,
      reporter,
    } = {}) {
      if (!hasText(workspace)) return { ok: false, error: "workspace obrigatório" };
      if (!hasText(title)) return { ok: false, error: "title obrigatório" };
      if (!hasText(evidence))
        return {
          ok: false,
          error: "sem evidência não é finding: informe arquivo:linha ou o caminho do print",
        };
      for (const value of [missionId, location, steps, expected, observed, reporter]) {
        if (value != null && typeof value !== "string")
          return { ok: false, error: "campos opcionais devem ser texto" };
      }
      if (!SEVERITIES.includes(severity))
        return { ok: false, error: `severity deve ser ${SEVERITIES.join("|")}` };
      if (!CATEGORIES.includes(category))
        return { ok: false, error: `category deve ser ${CATEGORIES.join("|")}` };

      const print = JSON.stringify([fingerprint(title, ""), fingerprint(location ?? "", "")]);
      const legacy = parseRow(
        stmts.byFingerprint.get(workspace, fingerprint(title, location ?? ""))
      );
      const existing =
        parseRow(stmts.byFingerprint.get(workspace, print)) ??
        (legacy &&
        fingerprint(legacy.title, "") === fingerprint(title, "") &&
        fingerprint(legacy.location ?? "", "") === fingerprint(location ?? "", "")
          ? legacy
          : null);
      if (existing) {
        // Defeito já registrado: soma a prova; se tinha sido dado como resolvido, reabre.
        const regressed = existing.status === "fixed" || existing.status === "verified";
        const status = regressed ? "reopened" : existing.status;
        stmts.update.run({
          workspace,
          id: existing.id,
          status,
          evidence: JSON.stringify([...existing.evidence, stamp(evidence.trim(), reporter)]),
          fixed_by: existing.fixed_by,
          fix_note: existing.fix_note,
          fix_commit: existing.fix_commit,
          verified_by: null,
        });
        return { ok: true, id: existing.id, duplicate: true, reopened: regressed, status };
      }

      const id = `F-${String(stmts.maxSeq.get(workspace).seq + 1).padStart(3, "0")}`;
      stmts.insert.run({
        id,
        workspace,
        mission_id: missionId ?? null,
        title: title.trim(),
        category,
        severity,
        location: location ?? null,
        steps: steps ?? null,
        expected: expected ?? null,
        observed: observed ?? null,
        evidence: JSON.stringify([stamp(evidence.trim(), reporter)]),
        fingerprint: print,
        reporter: reporter ?? null,
      });
      return { ok: true, id, duplicate: false, status: "open" };
    },

    findingUpdate({ workspace, id, status, actor, note, commit, evidence } = {}) {
      if (!hasText(workspace) || !hasText(id))
        return { ok: false, error: "workspace e id obrigatórios" };
      for (const value of [actor, note, commit, evidence]) {
        if (value != null && typeof value !== "string")
          return { ok: false, error: "campos opcionais devem ser texto" };
      }
      actor = actor?.trim() || null;
      const current = parseRow(stmts.get.get(workspace, id));
      if (!current) return { ok: false, error: `finding ${id} não encontrado` };
      if (!TRANSITIONS[current.status]?.includes(status)) {
        return {
          ok: false,
          error: `transição inválida: ${current.status} → ${status}. Permitidas: ${TRANSITIONS[current.status].join(", ")}`,
        };
      }
      if (status === "fixed" && !hasText(note)) {
        return { ok: false, error: "para marcar fixed, descreva a causa e como validou em note" };
      }
      if (status === "fixed" && !actor)
        return { ok: false, error: "fixed exige actor responsável pela correção" };
      if ((status === "verified" || status === "reopened") && !hasText(evidence)) {
        return { ok: false, error: `${status} exige evidence de que os passos foram refeitos` };
      }
      if (status === "verified" && (!actor || !hasText(current.fixed_by)))
        return { ok: false, error: "verified exige autor e verificador identificados" };
      if (status === "verified" && actor === current.fixed_by?.trim()) {
        return { ok: false, error: "quem corrigiu não pode verificar a própria correção" };
      }
      const nextEvidence = evidence?.trim()
        ? [...current.evidence, stamp(evidence.trim(), actor)]
        : current.evidence;
      stmts.update.run({
        workspace,
        id,
        status,
        evidence: JSON.stringify(nextEvidence),
        fixed_by: status === "fixed" ? (actor ?? null) : current.fixed_by,
        fix_note: status === "fixed" ? note.trim() : current.fix_note,
        fix_commit: status === "fixed" ? (commit ?? null) : current.fix_commit,
        verified_by: status === "verified" ? (actor ?? null) : null,
      });
      return { ok: true, id, status };
    },

    findingGet({ workspace, id } = {}) {
      if (!hasText(workspace) || !hasText(id))
        return { ok: false, error: "workspace e id obrigatórios" };
      const finding = parseRow(stmts.get.get(workspace, id));
      return finding ? { ok: true, finding } : { ok: false, error: `finding ${id} não encontrado` };
    },

    findingList({ workspace, status, severity, limit = 100 } = {}) {
      if (!hasText(workspace)) return { ok: false, error: "workspace obrigatório" };
      if (status != null && !STATUSES.includes(status))
        return { ok: false, error: "status inválido" };
      if (severity != null && !SEVERITIES.includes(severity))
        return { ok: false, error: "severity inválida" };
      if (!Number.isInteger(limit) || limit < 0)
        return { ok: false, error: "limit deve ser inteiro não negativo" };
      const clauses = ["workspace = @workspace"];
      if (status) clauses.push("status = @status");
      if (severity) clauses.push("severity = @severity");
      const rows = db
        .prepare(
          `
        SELECT * FROM findings WHERE ${clauses.join(" AND ")}
        ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id
        LIMIT @limit
      `
        )
        .all({ workspace, status, severity, limit: Math.min(limit, 500) });
      return { ok: true, findings: rows.map(parseRow) };
    },

    findingStats({ workspace } = {}) {
      if (!hasText(workspace)) return { ok: false, error: "workspace obrigatório" };
      const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]));
      for (const row of stmts.stats.all(workspace)) counts[row.status] = row.count;
      return { ok: true, counts };
    },
  };
  // Dedupe/sequence allocation and read-modify-write must be atomic across
  // concurrent SQLite connections, not only within this event loop.
  return {
    ...api,
    findingAdd: db.transaction(api.findingAdd).immediate,
    findingUpdate: db.transaction(api.findingUpdate).immediate,
  };
}

module.exports = { createFindingsStore, CATEGORIES, SEVERITIES, STATUSES, TRANSITIONS };
