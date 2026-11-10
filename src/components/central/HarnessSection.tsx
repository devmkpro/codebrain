import React from "react";
import { useProvidersStore } from "../../stores/providers-store";
import { useModalsStore } from "../../stores/modals-store";
import { central, useAction, useProviderRefresh, useResource } from "./api";
import {
  canUse,
  CliPicker,
  RegistryStatus,
  useCliRegistry,
  type CliEntry,
  type CliRegistry,
} from "./cli-registry";
import {
  blankRow,
  decisionView,
  DEFAULT_ROW_ID,
  EFFORT_LABEL,
  EFFORTS,
  ladderSteps,
  parseList,
  TIER_LABEL,
  TIERS,
  validateTable,
  type DecisionView,
} from "./logic";
import { Btn, ChipPicker, Field, Gate, Prompt, SectionHead, Select } from "./primitives";
import type {
  Account,
  CatalogItem,
  DeciderProvider,
  Effort,
  HarnessDecider,
  HarnessRow,
  HarnessTable,
  Tier,
} from "./types";

const TIER_TRADEOFF: Record<Tier, { gain: string; risk: string }> = {
  fast: { gain: "resposta rápida e barata", risk: "errar em tarefa difícil" },
  balanced: { gain: "bom resultado pelo custo", risk: "tropeçar no que é realmente difícil" },
  deep: { gain: "menos erro em tarefa difícil", risk: "gastar o limite bem mais rápido" },
};

const EFFORT_TRADEOFF: Record<Effort, { gain: string; risk: string }> = {
  low: { gain: "entrega ligeira", risk: "resposta superficial" },
  medium: { gain: "equilíbrio para o dia a dia", risk: "pensar pouco em caso cabeludo" },
  high: { gain: "pensa mais antes de mexer", risk: "demora e consome mais" },
};

const TIER_COLOR: Record<Tier, string> = {
  fast: "var(--cb-ansi-cyan)",
  balanced: "var(--cb-ansi-blue)",
  deep: "var(--cb-accent)",
};

/** Lista editada como texto: guarda o que foi digitado até o valor mudar por fora. */
function ListInput({
  id,
  value,
  onChange,
  multiline,
  placeholder,
}: {
  id: string;
  value: string[];
  onChange: (value: string[]) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  const separator = multiline ? /\n/ : /[,\n]/;
  const joiner = multiline ? "\n" : ", ";
  const [text, setText] = React.useState(value.join(joiner));
  React.useEffect(() => {
    setText((current) =>
      parseList(current, separator).join("|") === value.join("|") ? current : value.join(joiner)
    );
    // `separator` e `joiner` derivam de `multiline`, que não muda em vida.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const change = (next: string) => {
    setText(next);
    onChange(parseList(next, separator));
  };
  return multiline ? (
    <textarea
      id={id}
      className="cbc-control"
      rows={3}
      value={text}
      placeholder={placeholder}
      onChange={(event) => change(event.target.value)}
    />
  ) : (
    <input
      id={id}
      className="cbc-control"
      value={text}
      placeholder={placeholder}
      onChange={(event) => change(event.target.value)}
    />
  );
}

function modelsFor(
  cli: string | null,
  providers: { host?: string; models?: string[] }[],
  table: HarnessTable
): string[] {
  const fromProviders = providers
    .filter((provider) => !cli || provider.host === cli)
    .flatMap((provider) => provider.models ?? []);
  const fromTiers = cli ? Object.values(table.tierModels[cli] ?? {}) : [];
  return [...new Set([...fromTiers, ...fromProviders])].filter((model): model is string =>
    Boolean(model)
  );
}

function RowDetail({
  row,
  table,
  onChange,
  onRemove,
  registry,
  accounts,
  skills,
  agents,
  providers,
}: {
  row: HarnessRow;
  table: HarnessTable;
  onChange: (patch: Partial<HarnessRow>) => void;
  onRemove: () => void;
  registry: CliRegistry;
  accounts: Account[];
  skills: string[];
  agents: string[];
  providers: { host?: string; models?: string[] }[];
}) {
  const uid = `row-${row.id}`;
  const entry: CliEntry | undefined = registry.find(row.cli);
  const tierModel = row.cli ? table.tierModels[row.cli]?.[row.tier] : undefined;
  const datalistId = `${uid}-models`;
  const accountOptions = accounts.filter((account) => account.cli === row.cli);
  const skillsSupported = !row.cli || canUse(entry, "skills");

  return (
    <div className="cbc-task-detail">
      <div className="cbc-grid">
        <Field label="Nome" htmlFor={`${uid}-name`}>
          <input
            id={`${uid}-name`}
            className="cbc-control"
            value={row.name}
            maxLength={48}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </Field>
        <Field
          label="Para que serve"
          htmlFor={`${uid}-desc`}
          gain="o Decisor entende melhor o tipo"
          risk="texto vago atrair tarefa errada"
        >
          <input
            id={`${uid}-desc`}
            className="cbc-control"
            value={row.description}
            maxLength={240}
            onChange={(event) => onChange({ description: event.target.value })}
          />
        </Field>
        <Field label="Força" htmlFor={`${uid}-tier`} {...TIER_TRADEOFF[row.tier]}>
          <Select
            id={`${uid}-tier`}
            value={row.tier}
            onChange={(value) => onChange({ tier: value as Tier })}
            options={TIERS.map((tier) => ({ value: tier, label: TIER_LABEL[tier] }))}
          />
        </Field>
        {(!row.cli || canUse(entry, "effort")) && (
          <Field label="Esforço" htmlFor={`${uid}-effort`} {...EFFORT_TRADEOFF[row.effort]}>
            <Select
              id={`${uid}-effort`}
              value={row.effort}
              onChange={(value) => onChange({ effort: value as Effort })}
              options={EFFORTS.map((effort) => ({ value: effort, label: EFFORT_LABEL[effort] }))}
            />
          </Field>
        )}
        <Field
          label="CLI"
          htmlFor={`${uid}-cli`}
          gain={row.cli ? "a ferramenta certa para este tipo" : "nada para configurar"}
          risk={row.cli ? "parar nas reservas se ela faltar" : "cair numa CLI ruim para a tarefa"}
        >
          <CliPicker
            id={`${uid}-cli`}
            value={row.cli ?? ""}
            registry={registry}
            emptyLabel="a mesma de quem pediu"
            onChange={(value) => onChange({ cli: value || null, model: null, accountId: null })}
          />
        </Field>
        {(!row.cli || canUse(entry, "model")) && (
          <Field
            label="Modelo"
            htmlFor={`${uid}-model`}
            gain={row.model ? "resultado previsível" : "acompanha a força escolhida"}
            risk={
              row.model
                ? "quebrar quando o modelo sair de linha"
                : "mudar sem aviso se a faixa mudar"
            }
          >
            <input
              id={`${uid}-model`}
              className="cbc-control"
              list={datalistId}
              value={row.model ?? ""}
              placeholder={tierModel ? `da força: ${tierModel}` : "o da conta"}
              onChange={(event) => onChange({ model: event.target.value.trim() || null })}
            />
            <datalist id={datalistId}>
              {modelsFor(row.cli, providers, table).map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </Field>
        )}
        {canUse(entry, "multiAccount") && (
          <Field
            label="Conta"
            htmlFor={`${uid}-account`}
            gain={row.accountId ? "separar o gasto por conta" : "usar a conta com mais folga"}
            risk={
              row.accountId
                ? "parar quando o limite dela acabar"
                : "não saber antes qual conta paga"
            }
          >
            <Select
              id={`${uid}-account`}
              value={row.accountId ?? ""}
              onChange={(value) => onChange({ accountId: value || null })}
              options={[
                { value: "", label: "escolher sozinho" },
                ...accountOptions.map((account) => ({
                  value: account.id,
                  label: `${account.label} (${account.cli})`,
                })),
                ...(row.accountId && !accountOptions.some((account) => account.id === row.accountId)
                  ? [{ value: row.accountId, label: `${row.accountId} (indisponível)` }]
                  : []),
              ]}
            />
          </Field>
        )}
        {(!row.cli || canUse(entry, "systemPrompt")) && (
          <Field
            label="Agente"
            htmlFor={`${uid}-agent`}
            hint="Instruções do agente aplicadas a esta tarefa."
          >
            <Select
              id={`${uid}-agent`}
              value={row.agentName ?? ""}
              onChange={(agentName) => onChange({ agentName: agentName || null })}
              options={[
                { value: "", label: "nenhum" },
                ...agents.map((name) => ({ value: name, label: name })),
                ...(row.agentName && !agents.includes(row.agentName)
                  ? [{ value: row.agentName, label: `${row.agentName} (indisponível)` }]
                  : []),
              ]}
            />
          </Field>
        )}
        <Field
          label="Revisão"
          gain="olhar sem o ponto cego do autor"
          risk="abrir mais um terminal e gastar mais"
        >
          <label className="cbc-check">
            <input
              type="checkbox"
              checked={row.review}
              onChange={(event) => onChange({ review: event.target.checked })}
            />
            sempre em pane novo, nunca com quem escreveu
          </label>
        </Field>
        {skillsSupported ? (
          <Field
            label="Skills permitidas"
            wide
            gain="agente focado, menos contexto gasto"
            risk="improvisar se faltar a skill certa"
          >
            <ChipPicker
              label="Skills permitidas"
              value={row.skills}
              options={skills}
              onChange={(next) => onChange({ skills: next })}
              emptyHint="Nenhuma skill encontrada no catálogo."
            />
          </Field>
        ) : (
          <Field
            label="Skills permitidas"
            wide
            hint={`${entry?.label ?? "Esta CLI"} não usa skills.`}
          >
            <span />
          </Field>
        )}
        <Field
          label="Palavras-chave"
          htmlFor={`${uid}-keywords`}
          wide
          gain="decide na hora e de graça"
          risk="palavra comum puxar o tipo errado"
        >
          <ListInput
            id={`${uid}-keywords`}
            value={row.keywords}
            onChange={(keywords) => onChange({ keywords })}
            placeholder="bug, erro, quebrou"
          />
        </Field>
        <Field
          label="Exemplos, um por linha"
          htmlFor={`${uid}-examples`}
          gain="o Decisor acerta casos parecidos"
          risk="exemplo ruim ensinar errado"
        >
          <ListInput
            id={`${uid}-examples`}
            multiline
            value={row.examples ?? []}
            onChange={(examples) => onChange({ examples })}
            placeholder="o botão de salvar parou de funcionar"
          />
        </Field>
        <Field
          label="Não é este tipo, um por linha"
          htmlFor={`${uid}-not`}
          gain="separar tipos vizinhos"
          risk="excluir demais e cair no padrão"
        >
          <ListInput
            id={`${uid}-not`}
            multiline
            value={row.notExamples ?? []}
            onChange={(notExamples) => onChange({ notExamples })}
            placeholder="explique por que o botão existe"
          />
        </Field>
        <Field
          label="Reservas"
          wide
          gain="a tarefa não para se a CLI faltar"
          risk="rodar numa ferramenta que você não escolheu"
        >
          <div className="flex flex-col gap-2">
            {row.fallbacks.map((fallback, index) => (
              <div key={index} className="flex flex-wrap items-start gap-2">
                <span className="text-2xs text-cb-fg-3 h-6 leading-6">{index + 1}</span>
                <div className="flex-1 min-w-[140px]">
                  <CliPicker
                    label={`CLI da reserva ${index + 1}`}
                    value={fallback.cli}
                    registry={registry}
                    emptyLabel="escolha"
                    onChange={(cli) =>
                      onChange({
                        fallbacks: row.fallbacks.map((item, i) =>
                          i === index ? { cli, model: null } : item
                        ),
                      })
                    }
                  />
                </div>
                {fallback.cli && canUse(registry.find(fallback.cli), "model") && (
                  <input
                    aria-label={`Modelo da reserva ${index + 1}`}
                    className="cbc-control flex-1 min-w-[140px]"
                    style={{ width: "auto" }}
                    placeholder="modelo, opcional"
                    value={fallback.model ?? ""}
                    onChange={(event) =>
                      onChange({
                        fallbacks: row.fallbacks.map((item, i) =>
                          i === index ? { ...item, model: event.target.value.trim() || null } : item
                        ),
                      })
                    }
                  />
                )}
                <Btn
                  tone="ghost"
                  aria-label={`Tirar reserva ${index + 1}`}
                  onClick={() =>
                    onChange({ fallbacks: row.fallbacks.filter((_, i) => i !== index) })
                  }
                >
                  tirar
                </Btn>
              </div>
            ))}
            <div>
              <Btn
                onClick={() =>
                  onChange({ fallbacks: [...row.fallbacks, { cli: "", model: null }] })
                }
              >
                + reserva
              </Btn>
            </div>
          </div>
        </Field>
      </div>
      {row.id !== DEFAULT_ROW_ID && (
        <div className="mt-4">
          <Btn tone="danger" onClick={onRemove}>
            remover este tipo
          </Btn>
        </div>
      )}
    </div>
  );
}

function TaskRow({
  row,
  open,
  onToggle,
  table,
  registry,
  accounts,
  children,
}: {
  row: HarnessRow;
  open: boolean;
  onToggle: () => void;
  table: HarnessTable;
  registry: CliRegistry;
  accounts: Account[];
  children: React.ReactNode;
}) {
  const entry = registry.find(row.cli);
  const model =
    row.cli && !canUse(entry, "model")
      ? "—"
      : (row.model ?? (row.cli ? table.tierModels[row.cli]?.[row.tier] : null) ?? "o da conta");
  const account = canUse(entry, "multiAccount")
    ? (accounts.find((item) => item.id === row.accountId && item.cli === row.cli)?.label ??
      (row.accountId ? "indisponível" : "sozinho"))
    : "—";
  return (
    <>
      <button
        type="button"
        data-list-item
        className="cbc-task-row"
        aria-expanded={open}
        aria-label={`${row.name}, ${open ? "recolher" : "editar"}`}
        onClick={onToggle}
        style={{ "--cbc-rail": TIER_COLOR[row.tier] } as React.CSSProperties}
      >
        <span className="text-cb-fg-3" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span className="cbc-cut text-cb-fg-0" title={row.description}>
          {row.name}
        </span>
        <span data-col="more" className="cbc-cut">
          {TIER_LABEL[row.tier]}
        </span>
        <span className="cbc-cut">
          {!row.cli || canUse(entry, "effort") ? EFFORT_LABEL[row.effort] : "—"}
        </span>
        <span data-col="cli" className="cbc-cut">
          {entry?.label ?? row.cli ?? "herda"}
        </span>
        <span
          data-col="model"
          className={`cbc-cut ${row.model ? "text-cb-fg-0" : "text-cb-fg-2"}`}
          title={String(model)}
        >
          {model}
        </span>
        <span data-col="account" className="cbc-cut text-cb-fg-2">
          {account}
        </span>
        <span data-col="account" className="text-cb-fg-2">
          {row.cli && !canUse(entry, "skills")
            ? "—"
            : `${row.skills.length} skill${row.skills.length === 1 ? "" : "s"}`}
        </span>
      </button>
      {open && children}
    </>
  );
}

function Ladder({ decider }: { decider: HarnessDecider }) {
  const steps = ladderSteps(decider);
  return (
    <div className="px-6 py-3 border-b border-cb-line-0">
      <p className="cb-label mb-2">Quem decide, nesta ordem. O primeiro que responder vence.</p>
      <ol className="cbc-ladder">
        {steps.map((step, index) => (
          <li key={step.id} className="cbc-step" data-off={step.off ? "true" : undefined}>
            <div className="cbc-step-body">
              <span className="cbc-step-name">{step.label}</span>
              <span className="cbc-step-detail">{step.detail}</span>
            </div>
            {index < steps.length - 1 && (
              <span className="cbc-step-arrow" aria-hidden>
                →
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function DeciderBlock({
  decider,
  savedDecider,
  dirty,
  providers,
  onChange,
}: {
  decider: HarnessDecider;
  savedDecider: HarnessDecider;
  dirty: boolean;
  providers: DeciderProvider[];
  onChange: (patch: Partial<HarnessDecider>) => void;
}) {
  const [prompt, setPrompt] = React.useState("");
  const [result, setResult] = React.useState<DecisionView | null>(null);
  const action = useAction();
  const provider = providers.find((item) => item.id === decider.providerId);
  const usesCli = provider?.transport === "cli";
  const models = provider?.models ?? [];
  const canTest = Boolean(
    savedDecider.model && providers.some((item) => item.id === savedDecider.providerId)
  );

  const test = async (event: React.FormEvent) => {
    event.preventDefault();
    setResult(null);
    const response = await action.run(() => central.harness.testDecider(prompt.trim()));
    if (response) setResult(decisionView(response as Parameters<typeof decisionView>[0]));
  };

  return (
    <section className="px-6 py-4 border-b border-cb-line-0" aria-labelledby="decider-title">
      <h3 id="decider-title" className="text-xs font-bold text-cb-fg-0 mb-3">
        <Prompt /> Decisor
      </h3>
      <p className="cbc-tradeoff mb-3">
        Use o login já existente de uma CLI compatível ou uma API configurada. Chave de API não é obrigatória para usar CLI.
      </p>
      {!providers.length && (
        <div className="cbc-banner" data-tone="warn">
          <span>Nenhuma CLI com transporte compatível ou API configurada foi retornada pelo app. Uma CLI detectada ainda precisa de suporte ao Decisor e login válido. Sem Decisor, as palavras-chave e o tipo padrão continuam disponíveis.</span>
          <Btn onClick={() => useModalsStore.getState().openProviders("list")}>
            configurar API (opcional)
          </Btn>
        </div>
      )}
      <div className="cbc-grid">
        <Field
          label="Ligado"
          gain="entende o pedido além das palavras"
          risk="cada ajudante esperar a resposta dele"
        >
          <label className="cbc-check">
            <input
              type="checkbox"
              checked={decider.enabled}
              onChange={(event) => onChange({ enabled: event.target.checked })}
            />
            usar o Decisor antes das palavras-chave
          </label>
        </Field>
        <Field
          label="Quem responde"
          htmlFor="decider-provider"
          gain={usesCli ? "aproveitar o login da CLI, sem chave de API" : "escolher como consultar o modelo"}
          risk={usesCli ? "esperar o processo iniciar ou o login expirar" : "login, chave ou serviço ficarem indisponíveis"}
          hint={provider ? (usesCli
            ? `CLI${provider.cli ? ` (${provider.cli})` : ""}: usa o login já existente, sem chave de API. A disponibilidade do login é confirmada na consulta; a listagem não garante autenticação.`
            : "API: usa as credenciais já configuradas no provider; não precisa digitá-las aqui.") : undefined}
        >
          <Select
            id="decider-provider"
            value={decider.providerId ?? ""}
            onChange={(value) => onChange({ providerId: value || null, model: null })}
            options={[
              { value: "", label: providers.length ? "escolha CLI ou API" : "nenhum transporte disponível" },
              ...providers.map((item) => ({ value: item.id, label: item.transport ? `${item.label} · ${item.transport.toUpperCase()}` : item.label })),
              ...(decider.providerId && !provider
                ? [{ value: decider.providerId, label: `${decider.providerId} (indisponível)` }]
                : []),
            ]}
          />
          {usesCli && provider.authentication === "existing-login" && (
            <p className="cbc-tradeoff">Autenticação: login existente da CLI.</p>
          )}
        </Field>
        <Field
          label="Modelo"
          htmlFor="decider-model"
          gain="quanto mais simples, mais rápido"
          risk="modelo fraco classificar errado"
        >
          {models.length ? (
            <Select
              id="decider-model"
              value={decider.model ?? ""}
              onChange={(value) => onChange({ model: value || null })}
              options={[
                { value: "", label: "escolha" },
                ...models.map((model) => ({ value: model, label: model })),
                ...(decider.model && !models.includes(decider.model)
                  ? [{ value: decider.model, label: `${decider.model} (salvo)` }]
                  : []),
              ]}
            />
          ) : (
            <input
              id="decider-model"
              className="cbc-control"
              value={decider.model ?? ""}
              placeholder="nome do modelo"
              onChange={(event) => onChange({ model: event.target.value.trim() || null })}
            />
          )}
        </Field>
        <Field
          label={`Confiança mínima: ${Math.round(decider.minConfidence * 100)}%`}
          htmlFor="decider-conf"
          gain="subir evita decisão no chute"
          risk="subir demais anular o Decisor"
        >
          <input
            id="decider-conf"
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(decider.minConfidence * 100)}
            onChange={(event) => onChange({ minConfidence: Number(event.target.value) / 100 })}
            style={{ accentColor: "var(--cb-accent)" }}
          />
        </Field>
        <Field
          label={`Tempo limite: ${(decider.timeoutMs / 1000).toLocaleString("pt-BR")} s`}
          htmlFor="decider-timeout"
          gain="desistir menos"
          risk="cada ajudante demorar isso a mais para abrir"
          hint={usesCli ? "CLI pode precisar de um tempo limite maior para iniciar. Se expirar, falhar ou responder sem confiança, o roteamento segue pelas palavras-chave e pelo tipo padrão." : "Se a consulta falhar ou expirar, o roteamento segue pelas palavras-chave e pelo tipo padrão."}
        >
          <input
            id="decider-timeout"
            type="range"
            min={1000}
            max={30000}
            step={500}
            value={decider.timeoutMs}
            onChange={(event) => onChange({ timeoutMs: Number(event.target.value) })}
            style={{ accentColor: "var(--cb-accent)" }}
          />
        </Field>
      </div>

      <form className="mt-4 flex flex-col gap-2" onSubmit={test}>
        <label className="cb-label" htmlFor="decider-test">
          Testar
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="decider-test"
            className="cbc-control flex-1 min-w-[200px]"
            style={{ width: "auto" }}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="escreva uma frase, como: o login quebrou depois do deploy"
          />
          <Btn type="submit" disabled={!prompt.trim() || action.busy || !canTest}>
            {action.busy ? "perguntando…" : "testar"}
          </Btn>
        </div>
        {!canTest && (
          <p className="cbc-tradeoff">
            Escolha uma CLI ou API disponível e um modelo, e salve para testar. CLI usa o login existente; API é opcional.
          </p>
        )}
        {canTest && !savedDecider.enabled && (
          <p className="cbc-tradeoff">O teste funciona com o Decisor desligado.</p>
        )}
        {canTest && dirty && (
          <p className="cbc-tradeoff">
            O teste usa o que está salvo, não as mudanças ainda na tela.
          </p>
        )}
        {action.error && (
          <p className="cbc-error-line" role="alert">
            {action.error}
          </p>
        )}
        {result && (
          <p className="text-xs" role="status">
            {result.decided ? (
              <>
                <span className="text-cb-accent">decidiria</span>{" "}
                <span className="text-cb-fg-0">{result.taskLabel}</span>
                {result.confidence != null && (
                  <span className="text-cb-fg-2"> · {Math.round(result.confidence * 100)}%</span>
                )}
                {result.reason && <span className="text-cb-fg-1"> · {result.reason}</span>}
              </>
            ) : (
              <>
                <span className="text-cb-warn">não decidiu</span>
                <span className="text-cb-fg-1">
                  {" "}
                  · {result.reason ?? "as palavras-chave responderiam"}
                </span>
              </>
            )}
          </p>
        )}
      </form>
    </section>
  );
}

function HarnessEditor({
  initial,
  deciderProviders,
  registry,
  accounts,
  skills,
  agents,
}: {
  initial: HarnessTable;
  deciderProviders: DeciderProvider[];
  registry: CliRegistry;
  accounts: Account[];
  skills: string[];
  agents: string[];
}) {
  const [saved, setSaved] = React.useState(initial);
  const [draft, setDraft] = React.useState(initial);
  const [open, setOpen] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState(false);
  const action = useAction();
  const providers = useProvidersStore((state: any) => state.providers) as {
    host?: string;
    models?: string[];
  }[];

  const dirty = React.useMemo(
    () => JSON.stringify(saved) !== JSON.stringify(draft),
    [saved, draft]
  );
  const issues = React.useMemo(() => validateTable(draft), [draft]);

  const patchRow = (id: string, patch: Partial<HarnessRow>) => {
    setSavedAt(false);
    setDraft((table) => ({
      ...table,
      rows: table.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }));
  };

  const addRow = () => {
    const row = blankRow(draft.rows.map((item) => item.id));
    setDraft((table) => ({
      ...table,
      rows: [
        ...table.rows.filter((item) => item.id !== DEFAULT_ROW_ID),
        row,
        ...table.rows.filter((item) => item.id === DEFAULT_ROW_ID),
      ],
    }));
    setOpen(row.id);
  };

  const save = async () => {
    const next = await action.run(() => central.harness.saveTable(draft));
    if (next) {
      setSaved(next);
      setDraft(next);
      setSavedAt(true);
    }
  };

  return (
    <>
      <SectionHead
        title="Quem faz cada tarefa"
        lead="O piloto diz o que precisa ser feito. Esta tabela decide com o quê."
        actions={
          <>
            {dirty && <span className="text-2xs text-cb-warn">mudanças não salvas</span>}
            {!dirty && savedAt && (
              <span className="text-2xs text-cb-success" role="status">
                salvo
              </span>
            )}
            <Btn disabled={!dirty || action.busy} onClick={() => setDraft(saved)}>
              desfazer
            </Btn>
            <Btn tone="accent" disabled={!dirty || action.busy || issues.length > 0} onClick={save}>
              {action.busy ? "salvando…" : "salvar"}
            </Btn>
          </>
        }
      />
      <RegistryStatus registry={registry} />
      {(action.error || issues.length > 0) && (
        <div className="cbc-banner" data-tone="danger" role="alert">
          {action.error ?? issues[0].message}
          {issues.length > 1 && !action.error && <span>e mais {issues.length - 1}</span>}
        </div>
      )}
      <div className="cb-scroll flex-1 min-h-0">
        <fieldset disabled={action.busy} className="m-0 p-0 border-0 min-w-0">
          <Ladder decider={draft.decider} />
          <div>
            <div className="cbc-task-head cb-label">
              <span />
              <span>Tipo</span>
              <span>Força</span>
              <span>Esforço</span>
              <span>CLI</span>
              <span>Modelo</span>
              <span>Conta</span>
              <span>Skills</span>
            </div>
            {draft.rows.map((row) => (
              <TaskRow
                key={row.id}
                row={row}
                table={draft}
                registry={registry}
                accounts={accounts}
                open={open === row.id}
                onToggle={() => setOpen(open === row.id ? null : row.id)}
              >
                <RowDetail
                  row={row}
                  table={draft}
                  registry={registry}
                  accounts={accounts}
                  skills={skills}
                  agents={agents}
                  providers={providers}
                  onChange={(patch) => patchRow(row.id, patch)}
                  onRemove={() => {
                    setDraft((table) => ({
                      ...table,
                      rows: table.rows.filter((item) => item.id !== row.id),
                    }));
                    setOpen(null);
                  }}
                />
              </TaskRow>
            ))}
            <div className="px-5 py-3 border-b border-cb-line-0">
              <Btn onClick={addRow}>+ novo tipo de tarefa</Btn>
            </div>
          </div>
          <DeciderBlock
            decider={draft.decider}
            savedDecider={saved.decider}
            dirty={dirty}
            providers={deciderProviders}
            onChange={(patch) => {
              setSavedAt(false);
              setDraft((table) => ({ ...table, decider: { ...table.decider, ...patch } }));
            }}
          />
        </fieldset>
      </div>
    </>
  );
}

interface HarnessData {
  table: HarnessTable | null;
  accounts: Account[];
  catalog: CatalogItem[];
}

const optional = <T,>(promise: Promise<T>, fallback: T) => promise.catch(() => fallback);

async function loadHarness(workspace: string | null): Promise<HarnessData> {
  const [table, accounts, catalog] = await Promise.all([
    central.harness.getTable(),
    optional(central.accounts.list(), []),
    optional(central.catalog.scan(workspace), []),
  ]);
  return { table, accounts, catalog };
}

export function HarnessSection({ workspace }: { workspace: string | null }) {
  const resource = useResource(() => loadHarness(workspace), [workspace]);
  const providers = useResource(central.harness.deciderProviders, []);
  useProviderRefresh(providers.reload);
  const registry = useCliRegistry();

  if (resource.state !== "ready" || !resource.data?.table) {
    return (
      <>
        <SectionHead
          title="Quem faz cada tarefa"
          lead="O piloto diz o que precisa ser feito. Esta tabela decide com o quê."
        />
        <Gate resource={resource} noun="a tabela de tarefas">
          {() => <div className="cbc-state">A tabela veio vazia.</div>}
        </Gate>
      </>
    );
  }

  const { table, accounts, catalog } = resource.data;
  return (
    <>
      {(providers.error || providers.stale) && (
        <div className="cbc-banner" data-tone="warn" role="status">
          <span>Não deu para atualizar os provedores do Decisor. {providers.error}</span>
          <Btn onClick={providers.reload}>tentar de novo</Btn>
        </div>
      )}
      <HarnessEditor
        initial={table}
        deciderProviders={providers.data ?? []}
        registry={registry}
        accounts={accounts}
        skills={catalog
          .filter((item) => item.kind === "skill" && !item.disabled)
          .map((item) => item.name)}
        agents={catalog
          .filter((item) => item.kind === "agent" && !item.disabled)
          .map((item) => item.name)}
      />
    </>
  );
}
