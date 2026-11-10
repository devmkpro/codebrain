import React from "react";
import { central, useAction, useResource } from "./api";
import { cliOptionLabel, RegistryStatus, useCliRegistry, type CliRegistry } from "./cli-registry";
import {
  catalogCategories,
  catalogClis,
  catalogCopyModeMessage,
  copyTargets,
  filterCatalog,
  isBuiltin,
  type CatalogFilter,
} from "./logic";
import {
  Btn,
  ChipPicker,
  Dot,
  Field,
  Gate,
  listArrowNav,
  Prompt,
  SectionHead,
  Select,
  StateMessage,
  Tag,
} from "./primitives";
import type { CatalogItem } from "./types";

const keyOf = (item: CatalogItem) => `${item.kind}:${item.name}`;

function Detail({
  item,
  skills,
  registry,
  workspace,
  onChanged,
}: {
  item: CatalogItem;
  skills: string[];
  registry: CliRegistry;
  workspace: string | null;
  onChanged: () => void;
}) {
  const builtin = isBuiltin(item);
  const action = useAction();
  // Codebrain é o host, não uma CLI. Todo harness pode receber o fallback portável.
  const allClis = ["codebrain", ...registry.entries.map((entry) => entry.id)];
  const targets = copyTargets(item, allClis);
  const [target, setTarget] = React.useState("");
  const [category, setCategory] = React.useState(item.category ?? "");
  const [copied, setCopied] = React.useState<{
    cli: string;
    mode: unknown;
    unchanged: boolean;
  } | null>(null);
  const chosen = targets.includes(target) ? target : (targets[0] ?? "");

  const setMeta = (patch: { disabled?: boolean; category?: string; allowedSkills?: string[] }) =>
    action.run(async () => {
      await central.catalog.setMeta({ kind: item.kind, name: item.name, ...patch });
      onChanged();
    });

  const copy = () =>
    action.run(async () => {
      const result = await central.catalog.copyTo({
        name: item.name,
        kind: item.kind,
        cli: chosen,
        workspace,
      });
      setCopied({
        cli: chosen,
        mode: result.mode,
        unchanged: Array.isArray(result.copied) && result.copied.length === 0,
      });
      onChanged();
    });

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h3 className="text-md font-bold text-cb-fg-0 break-words">
          <Prompt /> {item.name}
        </h3>
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <Tag>{item.kind === "skill" ? "skill" : "agente"}</Tag>
          {item.category && <Tag>{item.category}</Tag>}
          {builtin && (
            <Tag color="var(--cb-accent)" title="Vem com o Codebrain">
              nativo, só leitura
            </Tag>
          )}
          {item.disabled && <Tag color="var(--cb-warn)">desligado</Tag>}
        </div>
        {item.description && <p className="mt-3 text-sm text-cb-fg-1">{item.description}</p>}
      </header>

      {action.error && (
        <p className="cbc-error-line" role="alert">
          {action.error}
        </p>
      )}

      <section>
        <p className="cb-label mb-1">Onde está instalado</p>
        {item.installedIn?.length ? (
          <ul className="list-none m-0 p-0">
            {item.installedIn.map((install) => (
              <li
                key={`${install.cli}:${install.path}`}
                className="flex gap-3 text-xs py-0.5 min-w-0"
              >
                <span className="text-cb-fg-0 shrink-0">
                  {registry.find(install.cli)?.label ?? install.cli}
                </span>
                <span className="text-cb-fg-2 break-all">{install.path}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-cb-fg-2">Em nenhuma CLI ainda.</p>
        )}
      </section>

      {builtin ? (
        <p className="text-xs text-cb-fg-2">
          Este item vem com o Codebrain e é atualizado junto com o app, por isso não dá para editar.
        </p>
      ) : (
        <>
          <Field
            label="Em uso"
            gain="ele aparece para os agentes"
            risk="mais uma opção competindo por contexto"
          >
            <label className="cbc-check">
              <input
                type="checkbox"
                checked={!item.disabled}
                disabled={action.busy}
                onChange={(event) => setMeta({ disabled: !event.target.checked })}
              />
              {item.disabled ? "desligado" : "ligado"}
            </label>
          </Field>

          <Field label="Categoria" htmlFor="cat-category">
            <div className="flex gap-2">
              <input
                id="cat-category"
                className="cbc-control"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              />
              <Btn
                disabled={action.busy || category === (item.category ?? "")}
                onClick={() => setMeta({ category })}
              >
                salvar
              </Btn>
            </div>
          </Field>

          {item.kind === "agent" && (
            <Field
              label="Skills que este agente pode usar"
              gain="agente previsível e focado"
              risk="faltar a skill que resolveria"
            >
              <ChipPicker
                label="Skills permitidas"
                value={item.allowedSkills ?? []}
                options={skills}
                disabled={action.busy}
                onChange={(allowedSkills) => setMeta({ allowedSkills })}
                emptyHint="Nenhuma skill no catálogo."
              />
            </Field>
          )}
        </>
      )}

      <Field
        label="Copiar para outro harness ou Codebrain"
        htmlFor="cat-copy"
        gain="o mesmo item em outra ferramenta"
        risk="virar duas cópias para manter"
      >
        {targets.length ? (
          <>
            <div className="flex gap-2">
              <Select
                id="cat-copy"
                value={chosen}
                onChange={(value) => {
                  setTarget(value);
                  setCopied(null);
                }}
                options={targets.map((id) => {
                  const entry = registry.find(id);
                  return {
                    value: id,
                    label:
                      id === "codebrain" ? "Codebrain (host)" : entry ? cliOptionLabel(entry) : id,
                  };
                })}
              />
              <Btn disabled={action.busy || !chosen} onClick={copy}>
                copiar
              </Btn>
            </div>
            <p className="text-xs text-cb-fg-2">
              {chosen === "codebrain"
                ? "Host canônico: arquivos em .codebrain, sem criar uma nova CLI."
                : registry.find(chosen)?.capabilities?.skills !== true
                  ? "Compatibilidade por arquivos Codebrain disponível mesmo sem suporte nativo de skills."
                  : item.kind === "agent"
                    ? "O agente pode ser adaptado como skill-persona ou arquivos portáveis; isso não cria um agente nativo."
                    : "O backend confirma o formato nativo ou o fallback portável após a cópia."}{" "}
              Não exige conta gerenciada nem CLI instalada. Arquivos existentes são preservados.
            </p>
          </>
        ) : (
          <p className="text-xs text-cb-fg-2">Nenhum outro destino disponível no registro.</p>
        )}
        {copied && (
          <p className="text-2xs text-cb-success" role="status">
            {copied.unchanged
              ? `Nenhum arquivo novo em ${copied.cli}; arquivos existentes preservados.`
              : `Copiado para ${copied.cli}.`}{" "}
            {catalogCopyModeMessage(copied.mode)}
          </p>
        )}
      </Field>
    </div>
  );
}

function Catalog({
  items,
  workspace,
  onChanged,
}: {
  items: CatalogItem[];
  workspace: string | null;
  onChanged: () => void;
}) {
  const registry = useCliRegistry();
  const [filter, setFilter] = React.useState<CatalogFilter>({
    query: "",
    kind: "all",
    category: "",
    cli: "",
  });
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);

  const visible = React.useMemo(() => filterCatalog(items, filter), [items, filter]);
  const categories = React.useMemo(() => catalogCategories(items), [items]);
  const clis = React.useMemo(() => catalogClis(items), [items]);
  const skills = React.useMemo(
    () => items.filter((item) => item.kind === "skill").map((item) => item.name),
    [items]
  );
  const selected = visible.find((item) => keyOf(item) === selectedKey) ?? visible[0];

  const patch = (next: Partial<CatalogFilter>) => setFilter((current) => ({ ...current, ...next }));

  return (
    <>
      <RegistryStatus registry={registry} />
      <div className="cbc-toolbar">
        <input
          className="cbc-control flex-1 min-w-[160px]"
          style={{ width: "auto" }}
          value={filter.query}
          onChange={(event) => patch({ query: event.target.value })}
          placeholder="procurar por nome ou descrição"
          aria-label="Procurar no catálogo"
        />
        <div className="flex gap-1" role="group" aria-label="Filtrar por tipo">
          {(["all", "skill", "agent"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className="cbc-chip"
              aria-pressed={filter.kind === kind}
              onClick={() => patch({ kind })}
            >
              {kind === "all" ? "tudo" : kind === "skill" ? "skills" : "agentes"}
            </button>
          ))}
        </div>
        <div className="w-32">
          <Select
            aria-label="Filtrar por categoria"
            value={filter.category}
            onChange={(category) => patch({ category })}
            options={[
              { value: "", label: "toda categoria" },
              ...categories.map((value) => ({ value, label: value })),
            ]}
          />
        </div>
        <div className="w-32">
          <Select
            aria-label="Filtrar por CLI"
            value={filter.cli}
            onChange={(cli) => patch({ cli })}
            options={[
              { value: "", label: "toda CLI" },
              ...clis.map((value) => ({ value, label: registry.find(value)?.label ?? value })),
            ]}
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <StateMessage
          title={items.length ? "Nada com esse filtro" : "O catálogo está vazio"}
          text={
            items.length
              ? "Tente outro termo ou limpe os filtros."
              : "Instale uma skill ou agente em alguma CLI e volte aqui."
          }
          role="status"
        >
          {items.length > 0 && (
            <Btn onClick={() => setFilter({ query: "", kind: "all", category: "", cli: "" })}>
              limpar filtros
            </Btn>
          )}
        </StateMessage>
      ) : (
        <div className="cbc-split">
          <div className="cbc-split-list">
            <p className="cb-label px-6 py-2 border-b border-cb-line-0">
              {visible.length} de {items.length}
            </p>
            <div className="cb-scroll flex-1 min-h-0" onKeyDown={listArrowNav}>
              {visible.map((item) => {
                const current = selected && keyOf(item) === keyOf(selected);
                return (
                  <button
                    key={keyOf(item)}
                    type="button"
                    data-list-item
                    className="cbc-list-row"
                    aria-current={current ? "true" : undefined}
                    onClick={() => setSelectedKey(keyOf(item))}
                    style={
                      {
                        "--cbc-rail": current ? "var(--cb-accent)" : "transparent",
                      } as React.CSSProperties
                    }
                  >
                    <Dot
                      color={
                        item.disabled
                          ? "var(--cb-fg-3)"
                          : item.kind === "skill"
                            ? "var(--cb-ansi-cyan)"
                            : "var(--cb-ansi-blue)"
                      }
                    />
                    <span
                      className={`flex-1 min-w-0 cbc-cut ${item.disabled ? "text-cb-fg-2" : ""}`}
                    >
                      {item.name}
                    </span>
                    {isBuiltin(item) && (
                      <span className="text-2xs text-cb-accent" title="Nativo do Codebrain">
                        nativo
                      </span>
                    )}
                    <span className="text-2xs text-cb-fg-3">
                      {item.kind === "skill" ? "skill" : "agente"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="cbc-split-detail cb-scroll">
            {selected && (
              <Detail
                key={keyOf(selected)}
                item={selected}
                skills={skills}
                registry={registry}
                workspace={workspace}
                onChanged={onChanged}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function CatalogSection({ workspace }: { workspace: string | null }) {
  const resource = useResource(() => central.catalog.scan(workspace), [workspace]);
  return (
    <>
      <SectionHead
        title="Agentes e skills"
        lead="Tudo o que suas CLIs sabem fazer, num lugar só."
      />
      <Gate resource={resource} noun="o catálogo">
        {(items) => <Catalog items={items} workspace={workspace} onChanged={resource.reload} />}
      </Gate>
    </>
  );
}
