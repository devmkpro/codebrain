import React from "react";
import { BridgeUnavailable, useAction, useResource, whenFixturesReady } from "./api";
import { Btn, Select, Tag, type SelectOption } from "./primitives";

/* Toda escolha de CLI passa por aqui. A lista vem do registro do app; enquanto
   ele não existir, cai no cli.detect(), que sabe o que está instalado mas não
   sabe do que cada CLI é capaz. */

export interface CliCapabilities {
  model?: boolean;
  effort?: boolean;
  systemPrompt?: boolean;
  mcp?: boolean;
  resume?: boolean;
  multiAccount?: boolean;
  skills?: boolean;
}

export interface CliEntry {
  id: string;
  label: string;
  found: boolean;
  version?: string | null;
  verified?: boolean;
  capabilities?: CliCapabilities | null;
  loginCommand?: string | null;
}

/** Entradas de cli.detect() que não são CLI de agente. */
const NOT_AGENTS = new Set(["shell", "9router"]);

export function normalizeRegistry(raw: unknown): CliEntry[] | null {
  const list = Array.isArray(raw)
    ? raw
    : ((raw as { registry?: unknown; clis?: unknown; items?: unknown } | null)?.registry ??
      (raw as { clis?: unknown } | null)?.clis ??
      (raw as { items?: unknown } | null)?.items);
  if (!Array.isArray(list)) return null;
  return list
    .filter(
      (item, index, items) =>
        typeof item?.id === "string" &&
        !NOT_AGENTS.has(item.id) &&
        items.findIndex((other) => other?.id === item.id) === index
    )
    .map((item) => ({ ...item, label: item.label || item.id, found: Boolean(item.found) }));
}

export function entriesFromDetect(raw: unknown): CliEntry[] {
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw as Record<string, { found?: boolean; version?: string } | null>)
    .filter(
      ([id, info]) => !NOT_AGENTS.has(id) && info && typeof info === "object" && "found" in info
    )
    .map(([id, info]) => ({
      id,
      label: id,
      found: Boolean(info?.found),
      version: info?.version ?? null,
    }));
}

/** Só oferece uma capacidade que o registro confirma. */
export function canUse(entry: CliEntry | undefined, capability: keyof CliCapabilities): boolean {
  return entry?.capabilities?.[capability] === true;
}

export function multiAccountClis(entries: CliEntry[]): CliEntry[] {
  return entries.filter((entry) => canUse(entry, "multiAccount"));
}

export function cliOptionLabel(entry: CliEntry): string {
  const marks = [
    entry.found ? null : "não instalada",
    entry.verified === true
      ? "suportada"
      : entry.verified === false
        ? "experimental"
        : "suporte não verificado",
  ].filter(Boolean);
  return marks.length ? `${entry.label} (${marks.join(", ")})` : entry.label;
}

export function cliOptions(
  entries: CliEntry[],
  current: string | null | undefined
): SelectOption[] {
  const options = entries.map((entry) => ({ value: entry.id, label: cliOptionLabel(entry) }));
  if (current && !entries.some((entry) => entry.id === current)) {
    options.push({ value: current, label: `${current} (fora do registro)` });
  }
  return options;
}

async function loadCliEntries(): Promise<CliEntry[]> {
  await whenFixturesReady();
  const cli = (
    window as unknown as {
      codeBrainApp?: {
        cli?: { registry?: () => Promise<unknown>; detect?: () => Promise<unknown> };
      };
    }
  ).codeBrainApp?.cli;
  if (cli?.registry) {
    const fromRegistry = normalizeRegistry(await cli.registry());
    if (!fromRegistry) throw new Error("O registro de CLIs devolveu uma resposta inválida.");
    return fromRegistry;
  }
  if (!cli?.detect) throw new BridgeUnavailable();
  return entriesFromDetect(await cli.detect());
}

export interface CliRegistry {
  entries: CliEntry[];
  ready: boolean;
  error?: string | null;
  find: (id: string | null | undefined) => CliEntry | undefined;
  reload: () => void;
}

export function useCliRegistry(): CliRegistry {
  const resource = useResource(loadCliEntries, []);
  const entries = React.useMemo(() => resource.data ?? [], [resource.data]);
  return React.useMemo(
    () => ({
      entries,
      ready: resource.state === "ready",
      error:
        resource.state === "unavailable"
          ? "Registro de CLIs indisponível nesta versão."
          : resource.error,
      find: (id) => entries.find((entry) => entry.id === id),
      reload: resource.reload,
    }),
    [entries, resource.state, resource.error, resource.reload]
  );
}

/** Seletor de CLI com o aviso do que falta para ela funcionar. */
export function CliPicker({
  value,
  onChange,
  registry,
  emptyLabel,
  id,
  label,
  disabled,
  only,
}: {
  value: string;
  onChange: (value: string) => void;
  registry: CliRegistry;
  /** Rótulo da opção "nenhuma"; sem ele, é obrigatório escolher. */
  emptyLabel?: string;
  id?: string;
  label?: string;
  disabled?: boolean;
  only?: CliEntry[];
}) {
  const options = cliOptions(only ?? registry.entries, value);
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <Select
        id={id}
        aria-label={label}
        value={value}
        onChange={onChange}
        disabled={disabled || !registry.ready}
        options={
          emptyLabel !== undefined ? [{ value: "", label: emptyLabel }, ...options] : options
        }
      />
      <CliNote key={value} entry={registry.find(value)} onInstalled={registry.reload} />
    </div>
  );
}

/** CLI não instalada continua escolhível, mas diz como resolver. */
export function CliNote({
  entry,
  onInstalled,
}: {
  entry: CliEntry | undefined;
  onInstalled?: () => void;
}) {
  const action = useAction();
  if (!entry || (entry.found && entry.verified !== false)) return null;

  const install = () =>
    action.run(async () => {
      const api = (
        window as unknown as {
          codeBrainApp?: {
            cli?: { installCli?: (id: string) => Promise<{ ok?: boolean; error?: string }> };
          };
        }
      ).codeBrainApp?.cli;
      if (!api?.installCli)
        throw new Error("Esta versão do app não instala CLIs. Instale pelo terminal.");
      const result = await api.installCli(entry.id);
      if (!result?.ok) throw new Error(result?.error || "A instalação falhou.");
      onInstalled?.();
    });

  return (
    <div className="flex flex-wrap items-center gap-2 text-2xs" style={{ color: "var(--cb-fg-2)" }}>
      {entry.verified === false && (
        <Tag color="var(--cb-warn)" title="Integração ainda não testada a fundo">
          experimental
        </Tag>
      )}
      {!entry.found && (
        <>
          <span style={{ color: "var(--cb-warn)" }}>não instalada</span>
          <Btn tone="ghost" onClick={install} disabled={action.busy}>
            {action.busy ? "instalando…" : "instalar"}
          </Btn>
        </>
      )}
      {action.error && (
        <span className="cbc-error-line" role="alert">
          {action.error}
        </span>
      )}
    </div>
  );
}

export function RegistryStatus({ registry }: { registry: CliRegistry }) {
  if (!registry.error && registry.ready) return null;
  return (
    <div className="cbc-banner" data-tone={registry.error ? "warn" : undefined} role="status">
      <span>{registry.error ?? "Carregando o registro de CLIs…"}</span>
      {registry.error && <Btn onClick={registry.reload}>tentar de novo</Btn>}
    </div>
  );
}
