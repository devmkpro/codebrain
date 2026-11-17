import React from "react";
import type {
  GitDigest,
  GitDigestBridge,
  GitDigestConfig,
  GitDigestConnection,
  GitDigestListItem,
  GitDigestNode,
  GitDigestProviderOption,
  GitDigestStatus,
} from "../../types/git-digest";
import { BridgeUnavailable, useAction, useProviderRefresh, useResource } from "./api";
import { NeuralMap } from "./NeuralMap";
import { Btn, ConfirmInline, Field, Gate, SectionHead, Select, StateMessage, Tag } from "./primitives";

function api(): GitDigestBridge {
  const bridge = (window as unknown as { codeBrainApp?: { gitDigest?: GitDigestBridge } }).codeBrainApp?.gitDigest;
  if (!bridge) throw new BridgeUnavailable();
  return bridge;
}

async function unwrap<T extends object>(promise: Promise<({ ok: true } & T) | { ok: false; error: string }>): Promise<T> {
  const result = await promise;
  if (!result) throw new BridgeUnavailable();
  if (result.ok === false) throw new Error(result.error || "O app recusou a operação.");
  return result as T;
}

const todayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const formatDate = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" });
};

const lines = (value: string) => value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);

function tokenPageOf(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl);
    return `${url.origin}${url.pathname.replace(/\/+$/, "").replace(/\/api\/v4$/i, "")}/-/user_settings/personal_access_tokens`;
  } catch {
    return null;
  }
}

// ── Conexões ────────────────────────────────────────────────────────────────

function ConnectionForm({ connection, encryption, onSaved, onCancel }: {
  connection?: GitDigestConnection;
  encryption: GitDigestStatus["encryption"];
  onSaved: (config: GitDigestConfig) => void;
  onCancel?: () => void;
}) {
  const [label, setLabel] = React.useState(connection?.label ?? "");
  const [baseUrl, setBaseUrl] = React.useState(connection?.baseUrl ?? "https://gitlab.com");
  const [projects, setProjects] = React.useState((connection?.projects ?? []).join("\n"));
  const [emails, setEmails] = React.useState((connection?.authorEmails ?? []).join("\n"));
  const [scope, setScope] = React.useState<GitDigestConnection["scope"]>(connection?.scope ?? "all");
  // O token nunca vai para o estado do React: é lido do campo e apagado no envio.
  const token = React.useRef<HTMLInputElement>(null);
  const action = useAction();
  const tokenPage = tokenPageOf(baseUrl);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = token.current?.value ?? "";
    if (token.current) token.current.value = "";
    const result = await action.run(() =>
      unwrap(
        api().upsertConnection({
          ...(connection ? { id: connection.id } : {}),
          label,
          baseUrl,
          enabled: connection?.enabled ?? true,
          scope,
          projects: lines(projects),
          authorEmails: lines(emails),
          ...(value ? { token: value } : {}),
        })
      )
    );
    if (result) onSaved(result.config);
  };

  return (
    <form aria-label={connection ? "Editar conexão GitLab" : "Nova conexão GitLab"} onSubmit={submit} className="space-y-4 p-4 border border-cb-line-1">
      <h3 className="text-sm text-cb-fg-0">{connection ? "Editar conexão" : "Nova conexão GitLab"}</h3>
      {!encryption.available && (
        <div className="cbc-banner" data-tone="danger" role="alert">
          <span>{encryption.reason ?? "Criptografia do sistema indisponível."} O token não será salvo.</span>
        </div>
      )}
      <div className="cbc-grid">
        <Field label="Nome" htmlFor="gd-label">
          <input id="gd-label" maxLength={80} className="cbc-control" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="GitLab da empresa" />
        </Field>
        <Field label="URL do GitLab" htmlFor="gd-url" hint="gitlab.com ou self-hosted. HTTP só em rede interna.">
          <input id="gd-url" required maxLength={500} className="cbc-control" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://gitlab.suaempresa.com" spellCheck={false} />
        </Field>
        <Field
          label="Personal access token"
          htmlFor="gd-token"
          wide
          hint={
            <>
              Escopo <code>read_api</code> basta.{" "}
              {connection?.hasToken
                ? "Deixe vazio para manter o token salvo; ele nunca é exibido de novo."
                : "Fica cifrado pelo chaveiro do sistema e só o processo principal o lê."}
              {tokenPage && (
                <>
                  {" "}Gere em <span className="break-all">{tokenPage}</span>.
                </>
              )}
            </>
          }
        >
          <input ref={token} id="gd-token" type="password" autoComplete="new-password" spellCheck={false} required={!connection?.hasToken} maxLength={512} className="cbc-control" defaultValue="" placeholder="glpat-…" />
        </Field>
        <Field label="O que entra no diário" htmlFor="gd-scope" hint="Git inteiro: todos os projetos que o token enxerga, todos os autores e branches.">
          <Select
            id="gd-scope"
            value={scope}
            onChange={(value) => setScope(value === "mine" ? "mine" : "all")}
            options={[
              { value: "all", label: "Git inteiro · todos os commits" },
              { value: "mine", label: "Só os meus commits" },
            ]}
          />
        </Field>
        <Field label="Projetos (opcional)" htmlFor="gd-projects" hint="grupo/projeto por linha. Vazio = todos com atividade no dia.">
          <textarea id="gd-projects" rows={3} className="cbc-control" value={projects} onChange={(e) => setProjects(e.target.value)} spellCheck={false} />
        </Field>
        {scope === "mine" && (
          <Field label="E-mails de autoria extras" htmlFor="gd-emails" hint="Se você commita com outro e-mail além do da conta.">
            <textarea id="gd-emails" rows={3} className="cbc-control" value={emails} onChange={(e) => setEmails(e.target.value)} spellCheck={false} />
          </Field>
        )}
      </div>
      <div className="flex gap-2">
        <Btn type="submit" tone="accent" disabled={action.busy || !encryption.available}>{action.busy ? "verificando token." : "Salvar e verificar"}</Btn>
        {onCancel && <Btn onClick={onCancel} disabled={action.busy}>Cancelar</Btn>}
      </div>
      {action.error && <p role="alert" className="cbc-error-line">{action.error}</p>}
    </form>
  );
}

function ConnectionRow({ connection, onChanged, onEdit }: { connection: GitDigestConnection; onChanged: (config: GitDigestConfig) => void; onEdit: () => void }) {
  const action = useAction();
  const [confirm, setConfirm] = React.useState(false);
  const [tested, setTested] = React.useState<string | null>(null);
  return (
    <div className="border-b border-cb-line-0 py-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-cb-fg-0">{connection.label}</span>
        <span className="text-xs text-cb-fg-2 break-all">{connection.baseUrl}</span>
        {connection.username && <Tag>@{connection.username}</Tag>}
        <Tag color={connection.hasToken ? "var(--cb-success)" : "var(--cb-danger)"}>{connection.hasToken ? "token cifrado" : "sem token"}</Tag>
        {!connection.enabled && <Tag color="var(--cb-warn)">pausada</Tag>}
        <Tag>{connection.scope === "mine" ? "só meus commits" : "git inteiro"}</Tag>
        {connection.projects.length > 0 && <Tag>{connection.projects.length} projeto(s)</Tag>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Btn
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              setTested(null);
              const { user } = await unwrap(api().testConnection({ id: connection.id }));
              setTested(`ok · ${user.name} (@${user.username})`);
            })
          }
        >
          testar
        </Btn>
        <Btn disabled={action.busy} onClick={onEdit}>editar</Btn>
        <Btn
          disabled={action.busy}
          onClick={() => void action.run(async () => onChanged((await unwrap(api().upsertConnection({ id: connection.id, enabled: !connection.enabled }))).config))}
        >
          {connection.enabled ? "pausar" : "ativar"}
        </Btn>
        <Btn tone="danger" disabled={action.busy} onClick={() => setConfirm(true)}>remover</Btn>
        {tested && <span className="text-xs text-cb-success">{tested}</span>}
      </div>
      {confirm && (
        <ConfirmInline
          message={`Remover "${connection.label}" e apagar o token cifrado? Os diários já gerados ficam.`}
          confirmLabel="remover conexão"
          busy={action.busy}
          onCancel={() => setConfirm(false)}
          onConfirm={() => void action.run(async () => onChanged((await unwrap(api().removeConnection({ id: connection.id }))).config))}
        />
      )}
      {action.error && <p role="alert" className="cbc-error-line">{action.error}</p>}
    </div>
  );
}

// ── Harness, modelo e agenda ────────────────────────────────────────────────

function SettingsForm({ config, onSaved }: { config: GitDigestConfig; onSaved: (config: GitDigestConfig) => void }) {
  const providers = useResource(async () => (await unwrap(api().providers())).providers, []);
  useProviderRefresh(providers.reload);
  const [providerId, setProviderId] = React.useState(config.summarizer.providerId ?? "");
  const [model, setModel] = React.useState(config.summarizer.model ?? "");
  const [enabled, setEnabled] = React.useState(config.schedule.enabled);
  const [time, setTime] = React.useState(config.schedule.time);
  const [catchUp, setCatchUp] = React.useState(String(config.schedule.catchUpDays));
  const [includeDiffs, setIncludeDiffs] = React.useState(config.includeDiffs);
  const [saved, setSaved] = React.useState(false);
  const action = useAction();

  const list: GitDigestProviderOption[] = providers.data ?? [];
  const usable = list.filter((item) => item.available !== false);
  const provider = list.find((item) => item.id === providerId);
  const missing = !!providerId && providers.state === "ready" && !provider;
  const transportLabel = (item: GitDigestProviderOption) => (item.transport === "cli" ? "CLI" : "API");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaved(false);
    const result = await action.run(() =>
      unwrap(
        api().saveSettings({
          summarizer: { providerId: providerId || null, model: providerId ? model || null : null },
          schedule: { enabled, time, catchUpDays: Number(catchUp) },
          includeDiffs,
        })
      )
    );
    if (result) {
      setSaved(true);
      onSaved(result.config);
    }
  };

  return (
    <form aria-label="Harness, modelo e agenda" onSubmit={submit} className="space-y-4">
      <div className="cbc-grid">
        <Field label="Harness padrão" htmlFor="gd-provider" gain="o resumo explica o porquê, não só os arquivos" risk="títulos e caminhos (e diffs, se ligado) vão para esse modelo">
          <Select
            id="gd-provider"
            value={providerId}
            onChange={(value) => {
              setProviderId(value);
              setModel(list.find((item) => item.id === value)?.models[0] ?? "");
            }}
            options={[
              { value: "", label: "Sem modelo · agrupar por pasta" },
              ...usable.map((item) => ({ value: item.id, label: `${item.label} (${transportLabel(item)})` })),
              // Indisponíveis aparecem com o motivo, para ficar claro por que não dá para escolher.
              ...list
                .filter((item) => item.available === false)
                .map((item) => ({ value: item.id, label: `${item.label} (${transportLabel(item)}) — ${item.reason ?? "indisponível"}`, disabled: item.id !== providerId })),
              ...(missing ? [{ value: providerId, label: `${providerId} (não configurado)`, disabled: true }] : []),
            ]}
          />
        </Field>
        <Field label="Modelo" htmlFor="gd-model" hint={provider && !provider.models.length ? "Provider sem lista de modelos: digite o id." : undefined}>
          {provider && provider.models.length ? (
            <Select
              id="gd-model"
              value={model}
              onChange={setModel}
              options={[...new Set([...(model && !provider.models.includes(model) ? [model] : []), ...provider.models])].map((item) => ({ value: item, label: item }))}
            />
          ) : (
            <input id="gd-model" className="cbc-control" value={model} disabled={!providerId} onChange={(e) => setModel(e.target.value)} maxLength={200} spellCheck={false} />
          )}
        </Field>
        <Field label="Horário do resumo diário" htmlFor="gd-time" hint="Fuso deste computador. O app precisa estar aberto.">
          <input id="gd-time" type="time" className="cbc-control" value={time} onChange={(e) => setTime(e.target.value)} disabled={!enabled} />
        </Field>
        <Field label="Recuperar dias perdidos" htmlFor="gd-catchup" hint="Ao abrir o app, refaz os últimos N dias sem diário ou incompletos.">
          <input id="gd-catchup" type="number" min={0} max={14} step={1} className="cbc-control" value={catchUp} onChange={(e) => setCatchUp(e.target.value)} disabled={!enabled} />
        </Field>
      </div>
      <label className="cbc-check">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Gerar o diário sozinho todo dia
      </label>
      <label className="cbc-check">
        <input type="checkbox" checked={includeDiffs} onChange={(e) => setIncludeDiffs(e.target.checked)} /> Enviar trechos de diff ao modelo (resumo melhor; o código sai do computador se o harness for API)
      </label>
      {providers.state === "ready" && !usable.length && (
        <p className="cbc-tradeoff">Nenhum harness disponível. Faça login no Claude CLI ou cadastre um provider de API com chave em Configurações › Providers.</p>
      )}
      <div className="flex items-center gap-2">
        <Btn type="submit" tone="accent" disabled={action.busy || (!!providerId && !model)}>{action.busy ? "salvando." : "Salvar preferências"}</Btn>
        {saved && <span className="text-xs text-cb-success">salvo</span>}
      </div>
      {action.error && <p role="alert" className="cbc-error-line">{action.error}</p>}
    </form>
  );
}

function ConfigPanel({ config, status, onChanged }: { config: GitDigestConfig; status: GitDigestStatus; onChanged: (config: GitDigestConfig) => void }) {
  const [editing, setEditing] = React.useState<string | null>(config.connections.length ? null : "new");
  const done = (next: GitDigestConfig) => {
    setEditing(null);
    onChanged(next);
  };
  return (
    <div className="space-y-6">
      <section className="space-y-2" aria-label="Conexões GitLab">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm text-cb-fg-0">Conexões GitLab</h3>
          {editing !== "new" && <Btn onClick={() => setEditing("new")}>+ conexão</Btn>}
        </div>
        {config.connections.map((connection) =>
          editing === connection.id ? (
            <ConnectionForm key={connection.id} connection={connection} encryption={status.encryption} onCancel={() => setEditing(null)} onSaved={done} />
          ) : (
            <ConnectionRow key={connection.id} connection={connection} onChanged={onChanged} onEdit={() => setEditing(connection.id)} />
          )
        )}
        {editing === "new" && (
          <ConnectionForm encryption={status.encryption} onCancel={config.connections.length ? () => setEditing(null) : undefined} onSaved={done} />
        )}
      </section>
      <section className="space-y-2" aria-label="Harness e modelo">
        <h3 className="text-sm text-cb-fg-0">Harness, modelo e agenda</h3>
        <SettingsForm key={JSON.stringify([config.summarizer, config.schedule, config.includeDiffs])} config={config} onSaved={onChanged} />
      </section>
    </div>
  );
}

// ── Mapa do dia ─────────────────────────────────────────────────────────────

function NodeDetail({ digest, node }: { digest: GitDigest; node: GitDigestNode | undefined }) {
  const commits = React.useMemo(() => {
    const map = new Map<string, { title: string; authorName: string; additions: number; deletions: number }>();
    for (const project of digest.projects)
      for (const commit of project.commits) map.set(`${project.key}|${commit.shortSha}`, commit);
    return map;
  }, [digest]);

  if (!node || node.kind === "day") {
    return (
      <div className="space-y-3">
        <p className="text-xs text-cb-fg-2">Clique num projeto, tema ou arquivo do mapa para ver os commits e quem fez.</p>
        {digest.summary.model && !digest.summary.error && <p className="cbc-tradeoff">resumido por {digest.summary.model}</p>}
        {digest.summary.error && <p className="cbc-tradeoff" style={{ color: "var(--cb-warn)" }}>{digest.summary.error}</p>}
      </div>
    );
  }

  const projectKey = node.projectKey ?? "";
  const shas =
    node.kind === "file"
      ? digest.projects.find((item) => item.key === projectKey)?.commits.filter((commit) => commit.files.some((file) => file.path === node.detail)).map((commit) => commit.shortSha) ?? []
      : node.commits ?? [];
  return (
    <div className="space-y-3">
      <p className="text-sm text-cb-fg-0 break-all">{node.kind === "file" ? node.detail : node.label}</p>
      {node.kind !== "file" && node.detail && <p className="text-xs text-cb-fg-1 whitespace-pre-wrap leading-relaxed">{node.detail}</p>}
      <ul className="space-y-1.5" aria-label="Commits">
        {shas.map((sha) => {
          const commit = commits.get(`${projectKey}|${sha}`);
          if (!commit) return null;
          return (
            <li key={sha} className="text-xs">
              <code className="text-cb-fg-2">{sha}</code> <span className="text-cb-fg-0">{commit.title}</span>{" "}
              {commit.authorName && <span className="text-cb-fg-2">· {commit.authorName} </span>}
              <span className="text-cb-success">+{commit.additions}</span> <span className="text-cb-danger">−{commit.deletions}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DigestView({ digest }: { digest: GitDigest }) {
  const [selected, setSelected] = React.useState<string>("day");
  React.useEffect(() => setSelected("day"), [digest.date, digest.generatedAt]);
  const node = digest.map.nodes.find((item) => item.id === selected);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-cb-fg-2">
        <Tag>{digest.stats.commits} commits</Tag>
        {digest.stats.authors !== undefined && <Tag>{digest.stats.authors} pessoas</Tag>}
        <Tag>{digest.stats.projects} projetos</Tag>
        <Tag>{digest.stats.files} arquivos</Tag>
        <Tag color="var(--cb-success)">+{digest.stats.additions}</Tag>
        <Tag color="var(--cb-danger)">−{digest.stats.deletions}</Tag>
        <span>gerado {new Date(digest.generatedAt).toLocaleString("pt-BR")}</span>
      </div>
      {digest.warnings.map((warning) => (
        <div key={warning} className="cbc-banner" data-tone="warn" role="status">
          <span>{warning}</span>
        </div>
      ))}
      {digest.stats.commits > 0 && (
        <article className="cbc-diary-summary" aria-label="Resumo do dia">
          <h3>{digest.summary.headline}</h3>
          {digest.summary.text.split(/\n{2,}/).map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </article>
      )}
      {digest.stats.commits === 0 ? (
        <StateMessage title="Nenhum commit neste dia" text="Nenhum commit foi enviado ao GitLab nesta data." role="status" />
      ) : (
        <div className="cbc-neural-layout">
          <NeuralMap nodes={digest.map.nodes} edges={digest.map.edges} selected={selected} onSelect={setSelected} />
          <aside className="cbc-neural-detail" aria-live="polite">
            <NodeDetail digest={digest} node={node} />
          </aside>
        </div>
      )}
    </div>
  );
}

/** `embedded`: dentro da aba do Início, sem rolagem própria nem cabeçalho grande. */
export function DiarySection({ embedded = false }: { embedded?: boolean } = {}) {
  const resource = useResource(async () => {
    const [{ config, status }, { items }] = await Promise.all([unwrap(api().getConfig()), unwrap(api().list())]);
    return { config, status, items };
  }, []);
  const [mode, setMode] = React.useState<"map" | "config">("map");
  const [date, setDate] = React.useState<string | null>(null);
  const [version, setVersion] = React.useState(0);
  const action = useAction();
  const reloadRef = React.useRef(resource.reload);
  reloadRef.current = resource.reload;

  React.useEffect(() => {
    let off: (() => void) | undefined;
    try {
      off = api().onUpdated(() => {
        reloadRef.current();
        setVersion((value) => value + 1);
      });
    } catch {
      /* versão sem a ponte: o Gate mostra o estado indisponível */
    }
    return () => off?.();
  }, []);

  const items: GitDigestListItem[] = resource.data?.items ?? [];
  const current = date ?? items[0]?.date ?? todayKey();
  const digest = useResource(async () => (await unwrap(api().get({ date: current }))).digest, [current, version]);

  const generate = () =>
    void action.run(async () => {
      await unwrap(api().generate({ date: current }));
      resource.reload();
      setVersion((value) => value + 1);
    });

  const dates = [...new Set([todayKey(), ...items.map((item) => item.date), current])].sort().reverse();
  const index = dates.indexOf(current);

  return (
    <div className={embedded ? "space-y-4" : "cbc-body overflow-auto space-y-5"}>
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-cb-fg-2">Tudo o que foi commitado no GitLab no dia, contado em texto e desenhado como mapa neural.</p>
          <div className="flex gap-2">
            <Btn aria-pressed={mode === "map"} onClick={() => setMode("map")}>mapa</Btn>
            <Btn aria-pressed={mode === "config"} onClick={() => setMode("config")}>configurar</Btn>
          </div>
        </div>
      ) : (
      <SectionHead
        title="Diário neural"
        lead="Tudo o que foi commitado no GitLab a cada dia, contado em texto pelo harness padrão e desenhado como mapa: dia no centro, depois projetos, temas e arquivos."
        actions={
          <>
            <Btn aria-pressed={mode === "map"} onClick={() => setMode("map")}>mapa</Btn>
            <Btn aria-pressed={mode === "config"} onClick={() => setMode("config")}>configurar</Btn>
          </>
        }
      />
      )}<Gate resource={resource} noun="o diário">
        {({ config, status }) => {
          if (mode === "config" || !config.connections.length)
            return <ConfigPanel config={config} status={status} onChanged={(next) => resource.mutate({ ...resource.data!, config: next })} />;
          const busy = action.busy || !!status.running;
          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Btn aria-label="Dia anterior" disabled={index >= dates.length - 1} onClick={() => setDate(dates[index + 1])}>‹</Btn>
                <Select
                  aria-label="Dia"
                  value={current}
                  onChange={setDate}
                  options={dates.map((value) => {
                    const item = items.find((entry) => entry.date === value);
                    return { value, label: `${formatDate(value)}${item ? ` · ${item.commits} commits` : " · sem diário"}` };
                  })}
                />
                <Btn aria-label="Próximo dia" disabled={index <= 0} onClick={() => setDate(dates[index - 1])}>›</Btn>
                <input type="date" aria-label="Escolher data" className="cbc-control" style={{ width: "auto" }} max={todayKey()} value={current} onChange={(e) => e.target.value && setDate(e.target.value)} />
                <Btn tone="accent" disabled={busy} onClick={generate}>{busy ? "gerando." : digest.data ? "regerar" : "gerar agora"}</Btn>
                {config.summarizer.model ? <Tag>{config.summarizer.model}</Tag> : <Tag color="var(--cb-warn)">sem modelo</Tag>}
              </div>
              {action.error && <p role="alert" className="cbc-error-line">{action.error}</p>}
              {status.lastError && !action.error && (
                <p className="cbc-tradeoff" style={{ color: "var(--cb-warn)" }}>Última execução falhou: {status.lastError}</p>
              )}
              <Gate resource={digest} noun="o dia">
                {(data) =>
                  data ? (
                    <DigestView digest={data} />
                  ) : (
                    <StateMessage title={`Sem diário em ${formatDate(current)}`} text="Gere agora para buscar os commits desse dia no GitLab." role="status" />
                  )
                }
              </Gate>
            </div>
          );
        }}
      </Gate>
    </div>
  );
}
