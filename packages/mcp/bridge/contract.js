"use strict";

/* Contrato de entrega entre orquestrador e worker.

   Um `handoff_submit` com status "done" é uma afirmação. Quando o spawn declara
   `expect`, a afirmação precisa vir com o que foi combinado; caso contrário o
   worker recebe de volta exatamente o que faltou. */

const typeOf = (value) => {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
};

/** Subconjunto de JSON Schema: type, required, properties, items, enum, minItems. */
function validateSchema(schema, value, at = "output") {
  if (schema === false) return [`${at}: schema recusa qualquer valor`];
  if (schema === true || schema == null) return [];
  if (typeof schema !== "object" || Array.isArray(schema)) return [`${at}: schema inválido`];
  const problems = [];
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    const matches = allowed.some(
      (type) =>
        type === actual || (type === "integer" && actual === "number" && Number.isInteger(value))
    );
    if (!matches) {
      problems.push(`${at}: esperado ${allowed.join("|")}, recebido ${actual}`);
      return problems;
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    problems.push(`${at}: valor fora de [${schema.enum.join(", ")}]`);
  }
  if (typeOf(value) === "object") {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key) || value[key] === undefined)
        problems.push(`${at}.${key}: obrigatório`);
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key) && value[key] !== undefined)
        problems.push(...validateSchema(childSchema, value[key], `${at}.${key}`));
    }
  }
  if (typeOf(value) === "array") {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      problems.push(`${at}: mínimo de ${schema.minItems} item(ns)`);
    }
    if (schema.items) {
      value.forEach((item, index) =>
        problems.push(...validateSchema(schema.items, item, `${at}[${index}]`))
      );
    }
  }
  return problems;
}

function hasEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") return false;
  const text = (value) => typeof value === "string" && Boolean(value.trim());
  return Boolean(
    (Array.isArray(evidence.checks) &&
      evidence.checks.some(
        (check) => text(check?.requirement) && ["pass", "fail"].includes(check.status)
      )) ||
    (Array.isArray(evidence.commands) &&
      evidence.commands.some(
        (command) => text(command?.cmd) && Number.isInteger(command.exitCode)
      )) ||
    (Array.isArray(evidence.files) && evidence.files.some(text)) ||
    text(evidence.tested)
  );
}

function evidenceProblems(evidence) {
  const problems = [];
  for (const [index, command] of (Array.isArray(evidence?.commands)
    ? evidence.commands
    : []
  ).entries()) {
    if (typeof command?.exitCode === "number" && command.exitCode !== 0) {
      problems.push(
        `evidence.commands[${index}]: "${command.cmd}" saiu com código ${command.exitCode}`
      );
    }
  }
  for (const [index, check] of (Array.isArray(evidence?.checks) ? evidence.checks : []).entries()) {
    if (check?.status === "fail") {
      problems.push(`evidence.checks[${index}]: "${check.requirement}" reprovado`);
    }
  }
  return problems;
}

/**
 * @returns {{ accepted: boolean, status: "none"|"passed"|"failed", problems: string[] }}
 */
function evaluateHandoff({ status, output, evidence, contract }) {
  if (!contract) return { accepted: true, status: "none", problems: [] };
  // Bloqueio e erro são relatos honestos: exigir prova deles só atrasaria o aviso.
  if (status !== "done") return { accepted: true, status: "none", problems: [] };

  const problems = [];
  if (contract.requireEvidence !== false) {
    if (!hasEvidence(evidence)) {
      problems.push("evidence: informe checks, commands, files ou tested");
    }
    problems.push(...evidenceProblems(evidence));
  }
  if (contract.schema !== undefined && contract.schema !== null) {
    try {
      problems.push(...validateSchema(contract.schema, output));
    } catch {
      problems.push("output: schema inválido");
    }
  }

  if (!problems.length) return { accepted: true, status: "passed", problems };
  const attempts = (contract.attempts ?? 0) + 1;
  contract.attempts = attempts;
  const retries = Number.isInteger(contract.retries)
    ? Math.min(3, Math.max(0, contract.retries))
    : 1;
  const accepted = attempts > retries;
  return { accepted, status: "failed", problems };
}

/** Uma linha para o orquestrador julgar a entrega sem abrir o pane. */
function describeEvidence(evidence, contractStatus) {
  if (contractStatus === "failed") return "⚠ contrato reprovado";
  if (!hasEvidence(evidence)) return "⚠ sem evidência";
  const parts = [];
  if (Array.isArray(evidence.checks) && evidence.checks.length)
    parts.push(`${evidence.checks.length} checks`);
  if (Array.isArray(evidence.commands) && evidence.commands.length) {
    const failed = evidence.commands.filter(
      (command) => command.exitCode && command.exitCode !== 0
    ).length;
    parts.push(`${evidence.commands.length} comandos${failed ? ` (${failed} falharam)` : ""}`);
  }
  if (Array.isArray(evidence.files) && evidence.files.length)
    parts.push(`${evidence.files.length} arquivos`);
  if (evidence.tested) parts.push("testado");
  return `evidência: ${parts.join(", ")}`;
}

module.exports = { describeEvidence, evaluateHandoff, hasEvidence, validateSchema };
