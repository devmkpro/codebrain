import React from "react";
import { useRouter } from "../../lib/router";
import { useMissionsStore, type Mission } from "../../stores/missions-store";
import { useNavStore } from "../../stores/nav-store";
import { usePanesStore } from "../../stores/panes-store";
import { statusPresentation } from "../shell/pane-status";
import { MissionWizard } from "../missions/MissionWizard";
import { central, useResource } from "./api";
import {
  deliveryState,
  evidenceSummary,
  findingsForHelper,
  parseReceipt,
  receiptsForMission,
  sourceInfo,
  timeAgo,
} from "./logic";
import { Btn, Dot, Gate, SectionHead, Select, StateMessage, Tag } from "./primitives";
import type { Finding, HandoffEvidence, SpawnReceipt } from "./types";

const POLL_MS = 4000;
const NO_MISSIONS: Mission[] = [];
const EFFORT_WORD: Record<string, string> = { low: "baixo", medium: "médio", high: "alto" };

interface PaneLike {
  id: string;
  status?: string;
  agent?: string;
  model?: string;
}

function usePanes(): PaneLike[] {
  return usePanesStore((state: any) => state.panes) as PaneLike[];
}

function focusPane(paneId: string, workspace: string) {
  (usePanesStore.getState() as unknown as { setActive: (id: string) => void }).setActive(paneId);
  (useNavStore.getState() as { openWorkspace: (path: string) => void }).openWorkspace(workspace);
}

function Proof({ evidence }: { evidence: HandoffEvidence }) {
  return (
    <details className="cbc-proof">
      <summary>ver a prova</summary>
      <div className="cbc-proof-list">
        {evidence.checks?.map((check, index) => (
          <p key={`c${index}`}>
            <span
              style={{
                color:
                  check.status === "fail"
                    ? "var(--cb-danger)"
                    : check.status === "pass"
                      ? "var(--cb-success)"
                      : "var(--cb-fg-2)",
              }}
            >
              {check.status === "fail"
                ? "falhou"
                : check.status === "pass"
                  ? "ok"
                  : (check.status ?? "sem resultado")}
            </span>{" "}
            {check.requirement}
            {check.verify && <span className="text-cb-fg-2"> · {check.verify}</span>}
          </p>
        ))}
        {evidence.commands?.map((command, index) => (
          <p key={`r${index}`}>
            <span style={{ color: command.exitCode ? "var(--cb-danger)" : "var(--cb-fg-3)" }}>
              $
            </span>{" "}
            {command.cmd}
            {typeof command.exitCode === "number" && (
              <span className="text-cb-fg-2"> · saiu com {command.exitCode}</span>
            )}
          </p>
        ))}
        {evidence.files?.map((file) => (
          <p key={file} className="text-cb-fg-2">
            {file}
          </p>
        ))}
        {evidence.tested && <p>testado: {evidence.tested}</p>}
      </div>
    </details>
  );
}

function HelperRow({
  receipt,
  pane,
  findings,
  workspace,
  now,
}: {
  receipt: SpawnReceipt;
  pane: PaneLike | undefined;
  findings: Finding[];
  workspace: string;
  now: number;
}) {
  const delivery = deliveryState(receipt, pane?.status);
  const source = sourceInfo(receipt.source);
  const parsed = parseReceipt(receipt.receipt);
  const evidence = evidenceSummary(receipt.handoff_evidence);
  const open = findings.filter(
    (finding) => finding.status === "open" || finding.status === "reopened"
  ).length;
  const effort = receipt.effort ? `esforço ${EFFORT_WORD[receipt.effort] ?? receipt.effort}` : null;

  return (
    <li className="cbc-helper" style={{ "--cbc-rail": delivery.color } as React.CSSProperties}>
      <div className="cbc-helper-head">
        <Dot color={delivery.color} pulse={delivery.live} />
        <span className="cbc-helper-name">{receipt.name || receipt.pane_id}</span>
        {receipt.task_name && <span className="text-xs text-cb-fg-2">{receipt.task_name}</span>}
        {receipt.reused ? (
          <Tag title="Aproveitou um ajudante que estava parado">reaproveitado</Tag>
        ) : null}
        <span className="flex-1" />
        {findings.length > 0 && (
          <Tag
            color={open ? "var(--cb-danger)" : "var(--cb-fg-2)"}
            title={`${open} em aberto de ${findings.length}`}
          >
            {findings.length} finding{findings.length === 1 ? "" : "s"}
          </Tag>
        )}
        <Tag color={delivery.color}>{delivery.label}</Tag>
        {pane && (
          <Btn
            tone="ghost"
            onClick={() => focusPane(pane.id, workspace)}
            aria-label={`Ver o terminal de ${receipt.name ?? receipt.pane_id}`}
          >
            ver terminal
          </Btn>
        )}
      </div>

      <p className="cbc-receipt">
        <span className="cbc-prompt" aria-hidden>
          ❯
        </span>
        <span>{receipt.agent ?? "CLI padrão"}</span>
        <span className="cbc-receipt-dim">·</span>
        <span>{receipt.model ?? "modelo da conta"}</span>
        {effort && (
          <>
            <span className="cbc-receipt-dim">·</span>
            <span>{effort}</span>
          </>
        )}
        {receipt.account && (
          <>
            <span className="cbc-receipt-dim">·</span>
            <span>conta {receipt.account}</span>
          </>
        )}
      </p>

      <dl className="cbc-meta">
        <dt>quem</dt>
        <dd>
          <span style={{ color: source.color }}>{source.label}</span>
          {parsed.why && <span> · {parsed.why}</span>}
        </dd>
        {receipt.skills && receipt.skills.length > 0 && (
          <>
            <dt>skills</dt>
            <dd className="text-cb-fg-2">{receipt.skills.join(", ")}</dd>
          </>
        )}
        {parsed.warnings.length > 0 && (
          <>
            <dt>aviso</dt>
            <dd style={{ color: "var(--cb-warn)" }}>{parsed.warnings.join(" · ")}</dd>
          </>
        )}
        {receipt.handoff_summary && (
          <>
            <dt>entrega</dt>
            <dd>
              {receipt.handoff_summary}
              {timeAgo(receipt.handoff_at, now) && (
                <span className="text-cb-fg-2"> · {timeAgo(receipt.handoff_at, now)}</span>
              )}
            </dd>
          </>
        )}
        {delivery.delivered && (
          <>
            <dt>prova</dt>
            <dd style={evidence ? undefined : { color: "var(--cb-warn)" }}>
              {evidence ?? "não apresentou nenhuma"}
            </dd>
          </>
        )}
      </dl>
      {receipt.handoff_evidence && evidence && <Proof evidence={receipt.handoff_evidence} />}
    </li>
  );
}

function MissionCockpit({
  mission,
  nextAt,
  workspace,
}: {
  mission: Mission;
  nextAt: number | null;
  workspace: string;
}) {
  const panes = usePanes();
  const resource = useResource(
    async () => {
      const [receipts, findings] = await Promise.all([
        central.harness.receipts(workspace),
        central.findings.list(workspace).catch(() => [] as Finding[]),
      ]);
      return { receipts, findings };
    },
    [workspace, mission.id],
    POLL_MS
  );

  const pilot = panes.find((pane) => pane.id === mission.pilotPaneId);
  const presentation = statusPresentation(pilot?.status);
  const now = Date.now();

  return (
    <div className="cb-scroll flex-1 min-h-0">
      <dl
        className="cbc-meta px-6 py-4 border-b border-cb-line-0"
        style={{ gridTemplateColumns: "9ch minmax(0,1fr)", rowGap: 4 }}
      >
        <dt>objetivo</dt>
        <dd className="text-cb-fg-0" style={{ fontSize: "var(--cb-text-base)" }}>
          {mission.objective || "Sem objetivo registrado."}
        </dd>
        <dt>piloto</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <Dot
            color={pilot ? presentation.color : "var(--cb-fg-3)"}
            pulse={pilot ? presentation.pulse : false}
          />
          <span>
            {mission.pilot?.agent ?? pilot?.agent ?? "CLI padrão"} ·{" "}
            {mission.pilot?.model ?? pilot?.model ?? "modelo da conta"}
          </span>
          <span className="text-cb-fg-2">{pilot ? presentation.label : "terminal fechado"}</span>
          {pilot && (
            <Btn tone="ghost" onClick={() => focusPane(pilot.id, workspace)}>
              falar com o piloto
            </Btn>
          )}
        </dd>
      </dl>

      <Gate resource={resource} noun="os ajudantes desta missão">
        {({ receipts, findings }) => {
          const helpers = receiptsForMission(receipts, mission, nextAt);
          if (!helpers.length) {
            return (
              <StateMessage
                title="O piloto ainda não chamou ajudantes"
                text="Cada ajudante aparece aqui com o recibo: quem faz, com o quê, e quem decidiu isso."
                role="status"
              />
            );
          }
          const delivered = helpers.filter((helper) => helper.handoff_status === "done").length;
          return (
            <>
              <p className="cb-label px-6 pt-4 pb-2">
                {helpers.length} ajudante{helpers.length === 1 ? "" : "s"} · {delivered} entrega
                {delivered === 1 ? "" : "s"}
              </p>
              <ul className="list-none m-0 p-0">
                {helpers.map((helper) => (
                  <HelperRow
                    key={helper.id ?? helper.pane_id}
                    receipt={helper}
                    pane={panes.find((pane) => pane.id === helper.pane_id)}
                    findings={findingsForHelper(findings, helper)}
                    workspace={workspace}
                    now={now}
                  />
                ))}
              </ul>
            </>
          );
        }}
      </Gate>
    </div>
  );
}

export function MissionSection({ workspace }: { workspace: string | null }) {
  const { query, location } = useRouter();
  const router = useRouter();
  const all = useMissionsStore(
    (state) => (workspace ? state.missionsByWorkspace[workspace] : undefined) ?? NO_MISSIONS
  );
  const [wizardOpen, setWizardOpen] = React.useState(false);

  const agentic = React.useMemo(
    () =>
      all
        .filter((mission) => mission.mode === "agentico" && mission.status !== "archived")
        .sort((a, b) => b.createdAt - a.createdAt),
    [all]
  );
  const selected = agentic.find((mission) => mission.id === query.mission) ?? agentic[0];

  const nextAt = React.useMemo(() => {
    if (!selected) return null;
    const later = all
      .filter((mission) => mission.mode === "agentico" && mission.createdAt > selected.createdAt)
      .map((mission) => mission.createdAt);
    return later.length ? Math.min(...later) : null;
  }, [all, selected]);

  const lead = "Acompanhe o objetivo, o piloto e o que cada ajudante está fazendo.";

  if (!workspace) {
    return (
      <>
        <SectionHead title="Missão" lead={lead} />
        <StateMessage
          title="Abra um workspace para ver a missão"
          text="Missões pertencem a uma pasta de projeto."
          role="status"
        />
      </>
    );
  }

  return (
    <>
      <SectionHead
        title={selected?.title ?? "Missão"}
        lead={selected ? undefined : lead}
        actions={
          <>
            {agentic.length > 1 && selected && (
              <div className="w-44">
                <Select
                  aria-label="Trocar de missão"
                  value={selected.id}
                  onChange={(mission) =>
                    router.navigate(location.path, { query: { ...query, mission }, replace: true })
                  }
                  options={agentic.map((mission) => ({ value: mission.id, label: mission.title }))}
                />
              </div>
            )}
            {selected && <Btn onClick={() => setWizardOpen(true)}>nova missão</Btn>}
          </>
        }
      />
      {selected ? (
        <MissionCockpit
          key={selected.id}
          mission={selected}
          nextAt={nextAt}
          workspace={workspace}
        />
      ) : (
        <StateMessage
          title="Nenhuma missão agêntica neste workspace"
          text="Você descreve o objetivo, um piloto quebra em partes e distribui. Você só fala com o piloto."
          role="status"
        >
          <Btn tone="accent" onClick={() => setWizardOpen(true)}>
            começar uma missão agêntica
          </Btn>
        </StateMessage>
      )}
      <MissionWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        workspacePath={workspace}
        initialMode="agentico"
      />
    </>
  );
}
