import React from "react";
import { central, useAction, useResource } from "./api";
import {
  allowedTransitions,
  FINDING_ACTION_LABEL,
  FINDING_STATUS_LABEL,
  FINDING_STATUSES,
  SEVERITY_LABEL,
  sortFindings,
  timeAgo,
  transitionField,
  validateTransition,
} from "./logic";
import { Btn, Dot, Gate, listArrowNav, Prompt, SectionHead, StateMessage, Tag } from "./primitives";
import type { Finding, FindingSeverity, FindingStatus } from "./types";

const ACTOR = "usuario";

const SEVERITY_COLOR: Record<FindingSeverity, string> = {
  high: "var(--cb-danger)",
  medium: "var(--cb-warn)",
  low: "var(--cb-info)",
};

const STATUS_COLOR: Record<FindingStatus, string> = {
  open: "var(--cb-danger)",
  reopened: "var(--cb-danger)",
  needs_decision: "var(--cb-warn)",
  fixed: "var(--cb-info)",
  verified: "var(--cb-success)",
};

const SEVERITIES: FindingSeverity[] = ["high", "medium", "low"];

function Actions({
  finding,
  workspace,
  onDone,
}: {
  finding: Finding;
  workspace: string;
  onDone: () => void;
}) {
  const [target, setTarget] = React.useState<FindingStatus | null>(null);
  const [text, setText] = React.useState("");
  const [commit, setCommit] = React.useState("");
  const [problem, setProblem] = React.useState<string | null>(null);
  const action = useAction();
  const transitions = allowedTransitions(finding.status);
  const field = target ? transitionField(target) : null;

  const send = async (next: FindingStatus, value: string) => {
    const kind = transitionField(next);
    const input = {
      actor: ACTOR,
      note: kind === "note" ? value : undefined,
      evidence: kind === "evidence" ? value : undefined,
    };
    const blocked = validateTransition(finding, next, input);
    if (blocked) {
      setProblem(blocked);
      return;
    }
    setProblem(null);
    const result = await action.run(() =>
      central.findings.update({
        workspace,
        id: finding.id,
        status: next,
        ...input,
        commit: next === "fixed" && commit.trim() ? commit.trim() : undefined,
      })
    );
    if (result) {
      setTarget(null);
      setText("");
      setCommit("");
      onDone();
    }
  };

  return (
    <section>
      <p className="cb-label mb-2">O que fazer</p>
      <div className="flex flex-wrap gap-2">
        {transitions.map((next) => (
          <Btn
            key={next}
            tone={target === next ? "accent" : undefined}
            disabled={action.busy}
            onClick={() => {
              setProblem(null);
              if (transitionField(next)) setTarget(target === next ? null : next);
              else void send(next, "");
            }}
          >
            {FINDING_ACTION_LABEL[next]}
          </Btn>
        ))}
      </div>
      {target && field && (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send(target, text);
          }}
        >
          <label className="cb-label" htmlFor="finding-text">
            {field === "note"
              ? "Qual era a causa e como você validou"
              : "O que você refez e o que viu"}
          </label>
          <textarea
            id="finding-text"
            autoFocus
            className="cbc-control"
            rows={3}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          {target === "fixed" && (
            <input
              aria-label="Commit da correção"
              className="cbc-control"
              placeholder="commit, se houver"
              value={commit}
              onChange={(event) => setCommit(event.target.value)}
            />
          )}
          <div className="flex gap-2">
            <Btn tone="accent" type="submit" disabled={action.busy || !text.trim()}>
              {action.busy ? "enviando…" : "confirmar"}
            </Btn>
            <Btn onClick={() => setTarget(null)}>cancelar</Btn>
          </div>
        </form>
      )}
      {(problem || action.error) && (
        <p className="cbc-error-line mt-2" role="alert">
          {problem ?? action.error}
        </p>
      )}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function Detail({
  finding,
  workspace,
  onDone,
  now,
}: {
  finding: Finding;
  workspace: string;
  onDone: () => void;
  now: number;
}) {
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h3 className="text-md font-bold text-cb-fg-0 break-words">
          <Prompt /> {finding.title}
        </h3>
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <span className="text-xs text-cb-fg-2">{finding.id}</span>
          <Tag color={SEVERITY_COLOR[finding.severity]}>{SEVERITY_LABEL[finding.severity]}</Tag>
          <Tag color={STATUS_COLOR[finding.status]}>{FINDING_STATUS_LABEL[finding.status]}</Tag>
          {finding.category && <Tag>{finding.category}</Tag>}
        </div>
      </header>

      <dl className="cbc-meta" style={{ gridTemplateColumns: "11ch minmax(0,1fr)", rowGap: 4 }}>
        {finding.location && <Fact label="onde">{finding.location}</Fact>}
        {finding.steps && (
          <Fact label="passos">
            <span className="whitespace-pre-wrap">{finding.steps}</span>
          </Fact>
        )}
        {finding.expected && <Fact label="esperado">{finding.expected}</Fact>}
        {finding.observed && <Fact label="aconteceu">{finding.observed}</Fact>}
        {finding.reporter && <Fact label="achado por">{finding.reporter}</Fact>}
        {finding.fix_note && <Fact label="correção">{finding.fix_note}</Fact>}
        {finding.fixed_by && (
          <Fact label="corrigido">
            {finding.fixed_by}
            {finding.fix_commit ? ` · ${finding.fix_commit}` : ""}
          </Fact>
        )}
        {finding.verified_by && <Fact label="verificado">{finding.verified_by}</Fact>}
      </dl>

      <section>
        <p className="cb-label mb-2">Rastro de evidência</p>
        {finding.evidence?.length ? (
          <ol className="list-none m-0 p-0">
            {finding.evidence.map((item, index) => (
              <li
                key={index}
                className="cb-rail py-1 text-xs break-words"
                style={
                  {
                    "--cb-rail-color":
                      index === finding.evidence!.length - 1
                        ? "var(--cb-accent)"
                        : "var(--cb-line-1)",
                  } as React.CSSProperties
                }
              >
                <p className="text-cb-fg-1 whitespace-pre-wrap">{item.text}</p>
                <p className="text-2xs text-cb-fg-2">
                  {[item.actor, timeAgo(item.at, now)].filter(Boolean).join(" · ")}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-xs text-cb-fg-2">Nenhuma evidência registrada.</p>
        )}
      </section>

      <Actions
        key={`${finding.id}:${finding.status}`}
        finding={finding}
        workspace={workspace}
        onDone={onDone}
      />
    </div>
  );
}

function FindingsBoard({
  findings,
  workspace,
  onChanged,
}: {
  findings: Finding[];
  workspace: string;
  onChanged: () => void;
}) {
  const [status, setStatus] = React.useState<FindingStatus | "all">("all");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const now = Date.now();

  const counts = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const finding of findings) map.set(finding.status, (map.get(finding.status) ?? 0) + 1);
    return map;
  }, [findings]);

  const visible = React.useMemo(
    () =>
      sortFindings(
        status === "all" ? findings : findings.filter((finding) => finding.status === status)
      ),
    [findings, status]
  );
  const selected = visible.find((finding) => finding.id === selectedId) ?? visible[0];

  if (!findings.length) {
    return (
      <StateMessage
        title="Nenhum finding neste workspace"
        text="Quando um revisor achar um defeito, ele aparece aqui com a prova."
        role="status"
      />
    );
  }

  return (
    <>
      <div className="cbc-toolbar" role="group" aria-label="Filtrar por situação">
        <button
          type="button"
          className="cbc-chip"
          aria-pressed={status === "all"}
          onClick={() => setStatus("all")}
        >
          todos {findings.length}
        </button>
        {FINDING_STATUSES.map((item) => (
          <button
            key={item}
            type="button"
            className="cbc-chip"
            aria-pressed={status === item}
            onClick={() => setStatus(item)}
          >
            {FINDING_STATUS_LABEL[item]} {counts.get(item) ?? 0}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <StateMessage title="Nenhum finding nesta situação" role="status" />
      ) : (
        <div className="cbc-split">
          <div className="cbc-split-list cb-scroll" onKeyDown={listArrowNav}>
            {SEVERITIES.map((severity) => {
              const group = visible.filter((finding) => finding.severity === severity);
              if (!group.length) return null;
              return (
                <section key={severity} aria-label={`Severidade ${SEVERITY_LABEL[severity]}`}>
                  <p
                    className="cb-label cbc-group-label"
                    style={{ color: SEVERITY_COLOR[severity] }}
                  >
                    {SEVERITY_LABEL[severity]} · {group.length}
                  </p>
                  {group.map((finding) => {
                    const current = selected?.id === finding.id;
                    return (
                      <button
                        key={finding.id}
                        type="button"
                        data-list-item
                        className="cbc-list-row"
                        aria-current={current ? "true" : undefined}
                        onClick={() => setSelectedId(finding.id)}
                        style={{ "--cbc-rail": SEVERITY_COLOR[severity] } as React.CSSProperties}
                      >
                        <Dot color={STATUS_COLOR[finding.status]} />
                        <span className="text-2xs text-cb-fg-2 shrink-0">{finding.id}</span>
                        <span className="flex-1 min-w-0 cbc-cut">{finding.title}</span>
                        <span
                          className="text-2xs shrink-0"
                          style={{ color: STATUS_COLOR[finding.status] }}
                        >
                          {FINDING_STATUS_LABEL[finding.status]}
                        </span>
                      </button>
                    );
                  })}
                </section>
              );
            })}
          </div>
          <div className="cbc-split-detail cb-scroll">
            {selected && (
              <Detail
                key={`${workspace}:${selected.id}:${selected.status}`}
                finding={selected}
                workspace={workspace}
                onDone={onChanged}
                now={now}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function FindingsSection({
  workspace,
  onChanged,
}: {
  workspace: string | null;
  onChanged?: () => void;
}) {
  const resource = useResource(
    async () => (workspace ? central.findings.list(workspace) : []),
    [workspace]
  );
  const lead = "Defeitos achados pelos revisores, com a prova de cada um.";

  if (!workspace) {
    return (
      <>
        <SectionHead title="Findings" lead={lead} />
        <StateMessage title="Abra um workspace para ver os findings" role="status" />
      </>
    );
  }

  return (
    <>
      <SectionHead title="Findings" lead={lead} />
      <Gate resource={resource} noun="os findings">
        {(findings) => (
          <FindingsBoard
            findings={findings}
            workspace={workspace}
            onChanged={() => {
              resource.reload();
              onChanged?.();
            }}
          />
        )}
      </Gate>
    </>
  );
}
