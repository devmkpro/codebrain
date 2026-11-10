import React from "react";
import { useNavStore } from "../../stores/nav-store";
import { usePanesStore } from "../../stores/panes-store";
import { central, useAction, useResource } from "./api";
import {
  CliPicker,
  multiAccountClis,
  RegistryStatus,
  useCliRegistry,
  type CliRegistry,
} from "./cli-registry";
import { formatReset, formatTokens, groupAccounts, usageBar, usageColor } from "./logic";
import { Btn, ConfirmInline, Dot, Gate, SectionHead, StateMessage, Tag } from "./primitives";
import type { Account, UsageWindow } from "./types";

function UsageLine({ window: usage, now }: { window: UsageWindow; now: number }) {
  const bar = usageBar(usage);
  const reset = formatReset(usage.resetsAt, now);
  const value =
    bar.kind === "measured"
      ? `${Math.round(bar.pct)}%`
      : bar.kind === "estimated"
        ? `~${formatTokens(bar.tokens)} tokens`
        : "sem medição";
  return (
    <div className="cbc-usage">
      <span
        className="cbc-cut text-cb-fg-1"
        title={usage.source ? `fonte: ${usage.source}` : undefined}
      >
        {usage.label}
      </span>
      <div
        className="cbc-bar"
        {...(bar.kind === "measured"
          ? {
              role: "progressbar",
              "aria-valuenow": Math.round(bar.pct),
              "aria-valuemin": 0,
              "aria-valuemax": 100,
              "aria-label": usage.label,
            }
          : { role: "img", "aria-label": `${usage.label}: ${value}, sem porcentagem conhecida` })}
      >
        {bar.kind === "measured" && (
          <div
            className="cbc-bar-fill"
            style={
              { width: `${bar.pct}%`, "--cbc-bar": usageColor(bar.pct) } as React.CSSProperties
            }
          />
        )}
        {bar.kind === "estimated" && <div className="cbc-bar-hatch" />}
      </div>
      <span className="text-right whitespace-nowrap">
        <span className={bar.kind === "measured" ? "text-cb-fg-0" : "text-cb-fg-2"}>{value}</span>
        {reset && <span className="text-cb-fg-2"> · {reset}</span>}
      </span>
    </div>
  );
}

function AccountRow({
  account,
  now,
  workspace,
  onChanged,
  onLogin,
  loginBusy,
}: {
  account: Account;
  now: number;
  workspace: string | null;
  onChanged: () => void;
  onLogin: (account: Account) => void;
  loginBusy: boolean;
}) {
  const action = useAction();
  const [confirming, setConfirming] = React.useState(false);
  const rail =
    account.loggedIn === false
      ? "var(--cb-warn)"
      : account.locked
        ? "var(--cb-accent)"
        : "var(--cb-line-1)";

  const toggleLock = () =>
    action.run(async () => {
      await central.accounts.lock(account.cli, account.locked ? null : account.id);
      onChanged();
    });

  const remove = () =>
    action.run(async () => {
      await central.accounts.remove(account.id);
      setConfirming(false);
      onChanged();
    });

  return (
    <li className="cbc-helper" style={{ "--cbc-rail": rail } as React.CSSProperties}>
      <div className="cbc-helper-head">
        <Dot
          color={
            account.loggedIn === false
              ? "var(--cb-warn)"
              : account.loggedIn === true
                ? "var(--cb-success)"
                : "var(--cb-fg-3)"
          }
        />
        <span className="cbc-helper-name">{account.label}</span>
        {account.isDefault && <Tag title="A conta que a CLI usa fora do Codebrain">padrão</Tag>}
        {account.locked && (
          <Tag color="var(--cb-accent)" title="Toda tarefa desta CLI usa só esta conta">
            travada
          </Tag>
        )}
        {account.loggedIn === false && <Tag color="var(--cb-warn)">precisa entrar</Tag>}
        <span className="flex-1" />
        {account.loggedIn === false && (
          <Btn
            tone="accent"
            onClick={() => onLogin(account)}
            disabled={!workspace || loginBusy}
            title={workspace ? undefined : "Abra um workspace para usar o terminal"}
          >
            entrar
          </Btn>
        )}
        <Btn
          onClick={toggleLock}
          disabled={action.busy}
          title={
            account.locked
              ? "Volta a escolher a conta com mais folga"
              : "Toda tarefa desta CLI passa a usar só esta conta"
          }
        >
          {account.locked ? "destravar" : "travar nesta"}
        </Btn>
        <Btn
          tone="danger"
          onClick={() => setConfirming(true)}
          disabled={action.busy || account.isDefault}
          title={account.isDefault ? "A conta padrão pertence à CLI e não sai daqui" : undefined}
        >
          remover
        </Btn>
      </div>

      {confirming && (
        <ConfirmInline
          message={
            <>
              Remover <strong>{account.label}</strong> apaga a pasta local desta conta
              {account.configDir ? ` (${account.configDir})` : ""}, com login e histórico. Não dá
              para desfazer.
            </>
          }
          confirmLabel="apagar a conta e a pasta"
          busy={action.busy}
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
        />
      )}
      {action.error && (
        <p className="cbc-error-line" role="alert">
          {action.error}
        </p>
      )}

      {account.windows?.length ? (
        <div className="mt-1">
          {account.windows.map((usage) => (
            <UsageLine key={usage.id} window={usage} now={now} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-cb-fg-2">Ainda sem medição de uso para esta conta.</p>
      )}
    </li>
  );
}

function AddAccount({
  registry,
  allowed,
  workspace,
  onCreated,
}: {
  registry: CliRegistry;
  allowed: ReturnType<typeof multiAccountClis>;
  workspace: string | null;
  onCreated: (account: Account) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [cli, setCli] = React.useState("");
  const [label, setLabel] = React.useState("");
  const action = useAction();
  const chosen = allowed.some((entry) => entry.id === cli) ? cli : allowed[0]?.id || "";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!chosen || !label.trim() || action.busy) return;
    const account = await action.run(() =>
      central.accounts.add({ cli: chosen, label: label.trim() })
    );
    if (account) {
      setOpen(false);
      setLabel("");
      onCreated(account);
    }
  };

  if (!open) {
    return (
      <Btn tone="accent" onClick={() => setOpen(true)} disabled={!allowed.length}>
        + conta
      </Btn>
    );
  }

  return (
    <form className="flex flex-wrap items-start gap-2 w-full" onSubmit={submit}>
      <div className="w-48">
        <CliPicker
          label="CLI da conta"
          value={chosen}
          onChange={setCli}
          registry={registry}
          only={allowed}
        />
      </div>
      <input
        autoFocus
        aria-label="Nome da conta"
        className="cbc-control flex-1 min-w-[140px]"
        style={{ width: "auto" }}
        placeholder="nome, como: trabalho"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
      />
      <Btn tone="accent" type="submit" disabled={!label.trim() || !chosen || action.busy}>
        {action.busy ? "criando…" : workspace ? "criar e entrar" : "criar"}
      </Btn>
      <Btn disabled={action.busy} onClick={() => setOpen(false)}>
        cancelar
      </Btn>
      {action.error && (
        <p className="cbc-error-line w-full" role="alert">
          {action.error}
        </p>
      )}
      {!workspace && (
        <p className="cbc-tradeoff w-full">
          Sem workspace aberto, o login fica para depois: use o botão entrar na conta.
        </p>
      )}
    </form>
  );
}

export function AccountsSection({ workspace }: { workspace: string | null }) {
  const resource = useResource(() => central.accounts.list(), [], 15000);
  const registry = useCliRegistry();
  const [loginError, setLoginError] = React.useState<string | null>(null);
  const [loginNote, setLoginNote] = React.useState<string | null>(null);
  const [loggingIn, setLoggingIn] = React.useState(false);
  const now = Date.now();
  const allowed = multiAccountClis(registry.entries).filter((entry) =>
    resource.data?.some((account) => account.cli === entry.id)
  );

  const login = async (account: Account) => {
    if (loggingIn) return;
    setLoginError(null);
    setLoginNote(null);
    if (!workspace) {
      setLoginNote(`Conta ${account.label} criada. Abra um workspace e clique em entrar.`);
      resource.reload();
      return;
    }
    setLoggingIn(true);
    try {
      const paneId = await central.accounts.login(account.id, workspace);
      if (!paneId) throw new Error("O app não devolveu o terminal de login.");
      (usePanesStore.getState() as unknown as { addPane: (config: unknown) => void }).addPane({
        id: paneId,
        agent: account.cli,
        cwd: workspace,
        workspacePath: workspace,
        externallySpawned: true,
        accountId: account.id,
        accountLabel: account.label,
      });
      (usePanesStore.getState() as unknown as { setActive: (id: string) => void }).setActive(
        paneId
      );
      (useNavStore.getState() as { openWorkspace: (path: string) => void }).openWorkspace(
        workspace
      );
      setLoginNote(`Terminal de login aberto para ${account.label}. Termine por lá e volte aqui.`);
      resource.reload();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoggingIn(false);
    }
  };

  return (
    <>
      <SectionHead
        title="Contas e limites"
        lead="Quanto cada conta já usou e quando renova. Barra cheia é medida; hachurada é estimativa, sem porcentagem."
        actions={
          resource.state === "ready" ? (
            <AddAccount
              registry={registry}
              allowed={allowed}
              workspace={workspace}
              onCreated={login}
            />
          ) : undefined
        }
      />
      <RegistryStatus registry={registry} />
      {loginError && (
        <div className="cbc-banner" data-tone="danger" role="alert">
          Não deu para abrir o login: {loginError}
        </div>
      )}
      {loginNote && (
        <div className="cbc-banner" role="status">
          {loginNote}
        </div>
      )}
      <Gate resource={resource} noun="as contas">
        {(accounts) => {
          const groups = groupAccounts(accounts).filter((group) => {
            return allowed.some((entry) => entry.id === group.cli);
          });
          if (!groups.length) {
            return (
              <StateMessage
                title="Nenhuma conta disponível"
                text={
                  allowed.length
                    ? "Adicione uma conta para usar mais de um login na mesma CLI."
                    : "O registro ainda não confirmou nenhuma CLI com suporte a várias contas."
                }
                role="status"
              />
            );
          }
          return (
            <div className="cb-scroll flex-1 min-h-0 pb-8">
              {groups.map((group) => (
                <section key={group.cli} aria-label={group.cli}>
                  <h3 className="cb-label px-6 pt-4 pb-2">
                    {registry.find(group.cli)?.label ?? group.cli}
                  </h3>
                  <ul className="list-none m-0 p-0">
                    {group.accounts.map((account) => (
                      <AccountRow
                        key={account.id}
                        account={account}
                        now={now}
                        workspace={workspace}
                        onChanged={resource.reload}
                        onLogin={login}
                        loginBusy={loggingIn}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          );
        }}
      </Gate>
    </>
  );
}
