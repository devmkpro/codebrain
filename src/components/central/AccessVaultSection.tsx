import React from "react";
import type {
  AccessCredential, AccessCredentialInput, AccessCredentialKind, AccessHost, AccessHostInput,
  AccessVaultBridge, AccessVaultInventory, AccessVaultResult, AccessVaultStatus,
} from "../../types/access-vault";
import { BridgeUnavailable, useAction, useResource } from "./api";
import { Btn, ConfirmInline, Field, Gate, SectionHead, Select, StateMessage, Tag } from "./primitives";
import { usePanesStore } from "../../stores/panes-store";
import { useNavStore } from "../../stores/nav-store";
import { useMissionsStore } from "../../stores/missions-store";
import { navigate } from "../../lib/router";

function api(): AccessVaultBridge {
  const bridge = (window as unknown as { codeBrainApp?: { accessVault?: AccessVaultBridge } }).codeBrainApp?.accessVault;
  if (!bridge) throw new BridgeUnavailable();
  return bridge;
}
function checked<T extends object>(result: AccessVaultResult<T>): AccessVaultResult<T> {
  if (!result?.ok) throw new Error(result?.error || "O cofre recusou a operação.");
  return result;
}
const kindLabels: Record<AccessCredentialKind, string> = { "api-key": "API key", password: "Senha", "ssh-key-path": "Referência de chave SSH" };

interface SshPane { id: string; cwd?: string; workspacePath?: string; missionId?: string; collapsed?: boolean }
interface PaneState { panes: SshPane[]; setActive(id: string): void; updatePane(id: string, patch: { collapsed: boolean }): void }

async function showExistingSshPane(paneId: string) {
  const state = () => usePanesStore.getState() as unknown as PaneState;
  const find = () => state().panes.find(pane => pane.id === paneId);
  let pane = find();
  if (!pane) pane = await new Promise<SshPane>((resolve, reject) => {
    const finish = () => {
      const found = find();
      if (found) { clearTimeout(timer); unsubscribe(); resolve(found); }
    };
    const timer = window.setTimeout(() => {
      unsubscribe();
      reject(new Error("O terminal SSH foi criado, mas ainda não apareceu na interface. Confira a lista de terminais antes de abrir outra conexão."));
    }, 3000);
    const unsubscribe = usePanesStore.subscribe(finish);
    finish();
  });
  const workspace = pane.workspacePath || pane.cwd;
  if (!workspace) throw new Error("O terminal SSH não informou seu workspace. Confira a lista de terminais.");
  if (pane.missionId) useMissionsStore.getState().setActiveMission(workspace, pane.missionId);
  if (pane.collapsed) state().updatePane(paneId, { collapsed: false });
  state().setActive(paneId);
  (useNavStore.getState() as { openWorkspace(path: string): void }).openWorkspace(workspace);
  navigate("/workspace", { query: { path: workspace } });
}

function CredentialForm({ credential, onSaved, onCancel }: {
  credential?: AccessCredential;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = React.useState(credential?.label ?? "");
  const [kind, setKind] = React.useState<AccessCredentialKind>(credential?.kind ?? "api-key");
  const [allow, setAllow] = React.useState(credential?.allowAgentAccess ?? false);
  // Secret input is never initialized from saved data, copied to React state or persisted in the renderer.
  const secret = React.useRef<HTMLInputElement>(null);
  const submitting = React.useRef(false);
  const action = useAction();
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    const value = secret.current?.value ?? "";
    if (secret.current) secret.current.value = "";
    const input: AccessCredentialInput = { ...(credential ? { id: credential.id } : {}), label, kind,
      allowAgentAccess: allow, ...(value ? { secret: value } : {}) };
    const result = await action.run(async () => {
      const response = checked(await api().saveCredential(input));
      if (!response.credential) throw new Error("O cofre não confirmou a credencial salva.");
      return true;
    });
    submitting.current = false;
    if (result) onSaved();
  };

  return <form aria-label={credential ? "Editar credencial" : "Nova credencial"} onSubmit={submit} className="space-y-4 p-4 border border-cb-line-1">
    <h3 className="text-sm text-cb-fg-0">{credential ? "Editar credencial" : "Nova credencial"}</h3>
    <div className="cbc-grid">
      <Field label="Nome da credencial" htmlFor="access-credential-label"><input id="access-credential-label" required maxLength={120} className="cbc-control" value={label} onChange={event => setLabel(event.target.value)} /></Field>
      <Field label="Tipo" htmlFor="access-credential-kind"><Select id="access-credential-kind" value={kind} onChange={value => { setKind(value as AccessCredentialKind); if (secret.current) secret.current.value = ""; }} options={Object.entries(kindLabels).map(([value, name]) => ({ value, label: name }))} /></Field>
      <Field label={kind === "ssh-key-path" ? "Caminho absoluto da chave SSH" : "Valor secreto"} htmlFor="access-secret" wide hint={credential ? "Deixe vazio para manter o valor salvo. Ele nunca é exibido novamente." : "O campo é limpo ao enviar. O segredo não pode ser revelado pela interface ou por ferramentas."}>
        <input ref={secret} id="access-secret" name="access-secret" type="password" autoComplete="new-password" spellCheck={false} required={!credential} maxLength={65536} className="cbc-control" defaultValue="" />
      </Field>
    </div>
    {kind === "ssh-key-path" ? <p className="cbc-tradeoff">O cofre criptografa apenas a referência ao caminho. O arquivo da chave permanece fora do cofre, com suas próprias permissões. Conteúdo de chave privada não é importado. Para chaves com passphrase, carregue a chave no ssh-agent e escolha essa opção no host.</p> : <p className="cbc-tradeoff">API keys e senhas são armazenadas criptografadas. Esta versão não injeta esses valores em comandos ou ferramentas; SSH por senha exige digitação manual no terminal.</p>}
    <label className="cbc-check"><input type="checkbox" checked={allow} onChange={event => setAllow(event.target.checked)} /> Disponibilizar referência desta credencial para agentes</label>
    <div className="flex gap-2"><Btn type="submit" tone="accent" disabled={action.busy}>{action.busy ? "salvando…" : "Salvar credencial"}</Btn><Btn onClick={onCancel} disabled={action.busy}>Cancelar</Btn></div>
    {action.error && <p role="alert" className="cbc-error-line">{action.error}</p>}
  </form>;
}

function HostForm({ host, credentials, onSaved, onCancel }: {
  host?: AccessHost;
  credentials: AccessCredential[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = React.useState(host?.label ?? "");
  const [hostname, setHostname] = React.useState(host?.hostname ?? "");
  const [username, setUsername] = React.useState(host?.username ?? "");
  const [port, setPort] = React.useState(String(host?.port ?? 22));
  const [useSshConfig, setUseSshConfig] = React.useState(host?.useSshConfig ?? false);
  const [useSsm, setUseSsm] = React.useState(Boolean(host?.ssmTunnel));
  const [instanceId, setInstanceId] = React.useState(host?.ssmTunnel?.instanceId ?? "");
  const [region, setRegion] = React.useState(host?.ssmTunnel?.region ?? "");
  const [profile, setProfile] = React.useState(host?.ssmTunnel?.profile ?? "default");
  const [localPort, setLocalPort] = React.useState(String(host?.ssmTunnel?.localPort ?? 2222));
  const [ssoNotice, setSsoNotice] = React.useState("");
  const [credentialId, setCredentialId] = React.useState(host?.credentialId ?? "");
  const [allow, setAllow] = React.useState(host?.allowAgentAccess ?? false);
  const submitting = React.useRef(false);
  const action = useAction();
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    const input: AccessHostInput = { ...(host ? { id: host.id } : {}), label, hostname, username, port: Number(port), credentialId: credentialId || null, useSshConfig, allowAgentAccess: allow,
      ...(useSsm ? { ssmTunnel: { instanceId, region, profile, localPort: Number(localPort) } } : host?.ssmTunnel ? { ssmTunnel: null } : {}) };
    const result = await action.run(async () => {
      const response = checked(await api().saveHost(input));
      if (!response.host) throw new Error("O cofre não confirmou o host salvo.");
      return true;
    });
    submitting.current = false;
    if (result) onSaved();
  };
  return <form aria-label={host ? "Editar host SSH" : "Novo host SSH"} onSubmit={submit} className="space-y-4 p-4 border border-cb-line-1">
    <h3 className="text-sm text-cb-fg-0">{host ? "Editar host SSH" : "Novo host SSH"}</h3>
    <div className="cbc-grid">
      <Field label="Nome do host" htmlFor="access-host-label"><input id="access-host-label" required maxLength={120} className="cbc-control" value={label} onChange={event => setLabel(event.target.value)} /></Field>
      <Field label={useSshConfig ? "Alias em ~/.ssh/config" : "Hostname ou IP"} htmlFor="access-hostname"><input id="access-hostname" required maxLength={253} className="cbc-control" value={hostname} onChange={event => setHostname(event.target.value)} placeholder={useSshConfig ? "codebrain-tom" : "server.example.com"} /></Field>
      <Field label="Usuário SSH" htmlFor="access-username"><input id="access-username" required maxLength={64} className="cbc-control" value={username} onChange={event => setUsername(event.target.value)} /></Field>
      <Field label="Porta SSH" htmlFor="access-port"><input id="access-port" type="number" min={1} max={65535} step={1} required className="cbc-control" value={port} onChange={event => setPort(event.target.value)} /></Field>
      <Field label="Autenticação" htmlFor="access-host-credential" wide><Select id="access-host-credential" value={credentialId} onChange={setCredentialId} options={[{ value: "", label: "ssh-agent — identidades já carregadas" }, ...credentials.filter(item => item.kind !== "api-key").map(item => ({ value: item.id, label: `${item.label} · ${kindLabels[item.kind]}${item.kind === "password" ? " (digitação manual)" : ""}` }))]} /></Field>
    </div>
    <label className="cbc-check"><input type="checkbox" checked={useSsm} onChange={event => setUseSsm(event.target.checked)} /> Abrir túnel AWS SSM automaticamente</label>
    {useSsm && <div className="cbc-grid">
      <Field label="ID da instância EC2" htmlFor="access-ssm-instance"><input id="access-ssm-instance" required className="cbc-control" value={instanceId} onChange={event => setInstanceId(event.target.value)} placeholder="i-0123456789abcdef0" /></Field>
      <Field label="Região AWS" htmlFor="access-ssm-region"><input id="access-ssm-region" required className="cbc-control" value={region} onChange={event => setRegion(event.target.value)} placeholder="sa-east-1" /></Field>
      <Field label="Perfil AWS CLI" htmlFor="access-ssm-profile"><input id="access-ssm-profile" required className="cbc-control" value={profile} onChange={event => setProfile(event.target.value)} /></Field>
      <Field label="Porta local do túnel" htmlFor="access-ssm-port"><input id="access-ssm-port" type="number" min={1} max={65535} required className="cbc-control" value={localPort} onChange={event => setLocalPort(event.target.value)} /></Field>
      <p className="cbc-tradeoff">Requer AWS CLI, Session Manager Plugin e perfil autenticado. A porta SSH acima é a porta remota; a chave do servidor continua sendo verificada.</p>
      <Btn disabled={action.busy} onClick={() => { setSsoNotice("Conclua o login no navegador."); void action.run(async () => { checked(await api().loginSso({ profile })); setSsoNotice("Login AWS SSO concluído."); return true; }); }}>Entrar no AWS SSO</Btn>
      {ssoNotice && <p role="status" className="cbc-tradeoff">{ssoNotice}</p>}
    </div>}
    <label className="cbc-check"><input type="checkbox" checked={useSshConfig} onChange={event => setUseSshConfig(event.target.checked)} /> Usar configuração SSH local (alias, chave e ProxyJump)</label>
    {useSshConfig ? <p className="cbc-tradeoff">Informe o alias configurado neste PC ou o IP. Chave e túnel vêm de ~/.ssh/config; usuário e porta são os preenchidos acima. Para túneis reversos, use a porta acessível na VM de passagem. Revise o arquivo local antes de autorizar agentes. A verificação da chave do servidor continua obrigatória.</p> : !credentialId && <p className="cbc-tradeoff">Sem credencial vinculada, somente identidades já carregadas no ssh-agent são usadas. Se não houver agente disponível, crie uma credencial do tipo Referência de chave SSH com o caminho absoluto do arquivo existente e depois vincule-a aqui. Uma chave usada pelo comando ssh manual não é selecionada automaticamente pelo cofre.</p>}
    <label className="cbc-check"><input type="checkbox" checked={allow} onChange={event => setAllow(event.target.checked)} /> Permitir solicitações SSH de agentes para este host</label>
    <p className="cbc-tradeoff">Bypass: após autorizar este host e a credencial vinculada, agentes podem conectar sem confirmação a cada abertura. Hosts novos começam bloqueados. Alterações de rota feitas por agentes exigem nova autorização.</p>
    <div className="flex gap-2"><Btn type="submit" tone="accent" disabled={action.busy}>{action.busy ? "salvando…" : "Salvar host"}</Btn><Btn onClick={onCancel} disabled={action.busy}>Cancelar</Btn></div>
    {action.error && <p role="alert" className="cbc-error-line">{action.error}</p>}
  </form>;
}

export function AccessVaultSection() {
  const resource = useResource<AccessVaultInventory & { status: AccessVaultStatus }>(async () => {
    const response = checked(await api().status());
    if (!response.status) throw new Error("O aplicativo não informou o estado do cofre.");
    if (!response.status.available) return { status: response.status, hosts: [], credentials: [] };
    const inventory = checked(await api().list());
    if (!inventory.hosts || !inventory.credentials) throw new Error("O aplicativo não retornou o inventário do cofre.");
    return { status: response.status, hosts: inventory.hosts, credentials: inventory.credentials };
  }, [], 15000);
  React.useEffect(() => {
    const refreshVisible = () => { if (document.visibilityState === "visible") resource.reload(); };
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [resource.reload]);
  const [editor, setEditor] = React.useState<{ kind: "host"; item?: AccessHost } | { kind: "credential"; item?: AccessCredential } | null>(null);
  const [confirm, setConfirm] = React.useState<{ kind: "host" | "credential"; id: string; label: string } | null>(null);
  const [notice, setNotice] = React.useState("");
  const action = useAction();
  const mutation = React.useRef(false);

  const saved = () => { setEditor(null); setNotice("Cadastro salvo no cofre."); resource.reload(); };
  async function remove() {
    if (!confirm || mutation.current) return;
    mutation.current = true;
    const target = confirm;
    const result = await action.run(async () => {
      checked(await (target.kind === "host" ? api().deleteHost({ id: target.id, confirmed: true }) : api().deleteCredential({ id: target.id, confirmed: true })));
      return true;
    });
    mutation.current = false;
    if (result) { setConfirm(null); setNotice("Cadastro removido do cofre."); resource.reload(); }
  }
  async function connect(host: AccessHost) {
    if (mutation.current) return;
    mutation.current = true;
    setNotice("");
    const result = await action.run(async () => {
      const response = checked(await api().openSsh({ hostId: host.id }));
      if (!response.paneId) throw new Error("O aplicativo não confirmou a abertura do terminal.");
      await showExistingSshPane(response.paneId);
      return response;
    });
    mutation.current = false;
    if (result) setNotice(result.interactive ? "Terminal SSH aberto. Digite a senha manualmente; a senha salva não foi enviada." : "Terminal SSH aberto. Confira o resultado da autenticação no terminal.");
  }

  return <>
    <SectionHead title="SSH e máquinas" lead="Hosts SSH e referências de credenciais sob controle do usuário." actions={<Btn onClick={resource.reload} disabled={action.busy}>Atualizar acessos</Btn>} />
    <Gate resource={resource} noun="o cofre de acessos">{data => !data.status.available ? <StateMessage title="Cofre bloqueado" text={data.status.reason} color="var(--cb-warn)" role="alert"><Btn onClick={resource.reload}>Verificar criptografia novamente</Btn></StateMessage> : <div className="cbc-body overflow-auto space-y-5">
      <div className="flex flex-wrap items-center gap-3"><Tag>Criptografia do sistema · {data.status.backend}</Tag><span className="text-xs text-cb-fg-2">Segredos salvos não são exibidos ou devolvidos a agentes.</span></div>
      <p className="cbc-tradeoff">SSH exige host já confiável em known_hosts. Para aliases e túneis, edite o host e habilite Usar configuração SSH local. Sem essa opção, a conexão é isolada da configuração local.</p>
      <p className="cbc-tradeoff">Se o terminal mostrar “Permission denied (publickey)”, crie uma credencial do tipo Referência de chave SSH e use Editar no host para vinculá-la, ou carregue sua identidade no ssh-agent. Sem credencial vinculada, o cofre não seleciona chaves padrão automaticamente, mesmo que o comando ssh manual funcione. O cadastro de uma máquina não comprova autenticação.</p>
      {notice && <p role="status" className="text-xs text-cb-success">{notice}</p>}
      {action.error && <p role="alert" className="cbc-error-line">{action.error}</p>}
      {confirm && <ConfirmInline message={<>Excluir {confirm.label} do cofre? Esta ação não pode ser desfeita.</>} confirmLabel="Confirmar exclusão" busy={action.busy} onConfirm={() => void remove()} onCancel={() => setConfirm(null)} />}
      {editor?.kind === "credential" && <CredentialForm key={`credential-${editor.item?.id ?? "new"}`} credential={editor.item} onSaved={saved} onCancel={() => setEditor(null)} />}
      {editor?.kind === "host" && <HostForm key={`host-${editor.item?.id ?? "new"}`} host={editor.item} credentials={data.credentials} onSaved={saved} onCancel={() => setEditor(null)} />}
      <section aria-label="Hosts SSH" className="space-y-3">
        <div className="flex items-center justify-between gap-3"><h3 className="text-sm text-cb-fg-0">Hosts SSH ({data.hosts.length})</h3><Btn tone="accent" disabled={action.busy || editor !== null} onClick={() => { action.clearError(); setNotice(""); setEditor({ kind: "host" }); }}>Novo host SSH</Btn></div>
        {data.hosts.length === 0 && <p className="text-xs text-cb-fg-2">Nenhum host cadastrado. O cadastro não abre uma conexão.</p>}
        {data.hosts.map(host => <article key={host.id} className="border-b border-cb-line-0 py-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2"><h4 className="text-sm text-cb-fg-0">{host.label}</h4><Tag>{host.allowAgentAccess ? "Agentes: solicitações permitidas" : "Agentes: bloqueado"}</Tag></div>
          <p className="text-xs text-cb-fg-2 break-all">{host.username}@{host.hostname} · porta {host.port}</p>
          <p className="text-xs text-cb-fg-2">{host.ssmTunnel ? `AWS SSM ${host.ssmTunnel.instanceId} · ${host.ssmTunnel.region} · porta local ${host.ssmTunnel.localPort} · ` : ""}{host.useSshConfig ? "Alias e rota de ~/.ssh/config · " : ""}{host.credentialId ? data.credentials.find(item => item.id === host.credentialId)?.label ?? "Credencial vinculada" : host.useSshConfig ? "identidade do alias" : "ssh-agent"}</p>
          <div className="flex flex-wrap gap-2"><Btn disabled={action.busy || editor !== null} onClick={() => void connect(host)} aria-label={`Abrir SSH ${host.label}`}>Abrir SSH</Btn><Btn disabled={action.busy || editor !== null} onClick={() => setEditor({ kind: "host", item: host })} aria-label={`Editar host ${host.label}`}>Editar</Btn><Btn tone="danger" disabled={action.busy || editor !== null} onClick={() => setConfirm({ kind: "host", id: host.id, label: host.label })} aria-label={`Excluir host ${host.label}`}>Excluir</Btn></div>
        </article>)}
      </section>
      <section aria-label="Credenciais" className="space-y-3">
        <div className="flex items-center justify-between gap-3"><h3 className="text-sm text-cb-fg-0">Credenciais ({data.credentials.length})</h3><Btn tone="accent" disabled={action.busy || editor !== null} onClick={() => { action.clearError(); setNotice(""); setEditor({ kind: "credential" }); }}>Nova credencial</Btn></div>
        {data.credentials.length === 0 && <p className="text-xs text-cb-fg-2">Nenhuma credencial salva.</p>}
        {data.credentials.map(credential => <article key={credential.id} className="border-b border-cb-line-0 py-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2"><h4 className="text-sm text-cb-fg-0">{credential.label}</h4><Tag>{kindLabels[credential.kind]}</Tag><Tag>{credential.allowAgentAccess ? "Referência para agentes" : "Agentes: bloqueado"}</Tag></div>
          <p className="text-xs text-cb-fg-2">{credential.kind === "ssh-key-path" ? "Referência criptografada; arquivo da chave fora do cofre." : "Valor protegido e não revelável."}</p>
          <div className="flex gap-2"><Btn disabled={action.busy || editor !== null} onClick={() => setEditor({ kind: "credential", item: credential })} aria-label={`Editar credencial ${credential.label}`}>Editar</Btn><Btn tone="danger" disabled={action.busy || editor !== null} onClick={() => setConfirm({ kind: "credential", id: credential.id, label: credential.label })} aria-label={`Excluir credencial ${credential.label}`}>Excluir</Btn></div>
        </article>)}
      </section>
    </div>}</Gate>
  </>;
}
