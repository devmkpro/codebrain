import React from "react";
import { useModalsStore } from "../../stores/modals-store";
import { central, useAction, useProviderRefresh, useResource } from "./api";
import { providersForKind, timeAgo, validateMediaDraft } from "./logic";
import { Btn, Field, Gate, SectionHead, Select, StateMessage } from "./primitives";
import type { MediaItem, MediaProvider } from "./types";

const SIZES = ["1024x1024", "1536x1024", "1024x1536"];
const VIDEO_SIZES = ["1280x720", "720x1280"];
const SIZE_LABEL: Record<string, string> = {
  "1024x1024": "quadrado",
  "1536x1024": "paisagem",
  "1024x1536": "retrato",
  "1280x720": "paisagem",
  "720x1280": "retrato",
};

function openProviders() {
  useModalsStore.getState().openProviders("list");
}

function Tile({ item, now }: { item: MediaItem; now: number }) {
  const when = timeAgo(item.createdAt, now);
  const action = useAction();
  const [copied, setCopied] = React.useState(false);
  const inline = item.url && (item.kind !== "video" || !item.url.startsWith("file:"));
  return (
    <figure className="cbc-tile m-0">
      {inline ? (
        item.kind === "video" ? (
          <video
            className="cbc-tile-media"
            src={item.url}
            controls
            preload="metadata"
            aria-label={item.name}
          />
        ) : (
          <img className="cbc-tile-media" src={item.url} alt={item.name} loading="lazy" />
        )
      ) : (
        <div className="cbc-tile-media flex items-center justify-center text-2xs text-cb-fg-3">
          {item.kind === "video" ? "vídeo salvo no projeto" : "sem prévia"}
        </div>
      )}
      <figcaption className="px-2 py-1 min-w-0">
        <p className="cbc-cut text-2xs text-cb-fg-1" title={item.path}>
          {item.name}
        </p>
        <p className="text-2xs text-cb-fg-3">
          {[item.kind === "video" ? "vídeo" : "imagem", when].filter(Boolean).join(" · ")}
        </p>
        <Btn
          tone="ghost"
          disabled={action.busy}
          onClick={() =>
            action.run(async () => {
              const ok = await window.codeBrainApp?.app?.copyToClipboard?.(item.path);
              if (!ok) throw new Error("Não foi possível copiar o caminho.");
              setCopied(true);
            })
          }
        >
          {copied ? "caminho copiado" : "copiar caminho"}
        </Btn>
        {action.error && (
          <p className="cbc-error-line" role="alert">
            {action.error}
          </p>
        )}
      </figcaption>
    </figure>
  );
}

function GenerateForm({
  providers,
  workspace,
  onGenerated,
}: {
  providers: MediaProvider[];
  workspace: string;
  onGenerated: () => void;
}) {
  const [kind, setKind] = React.useState("image");
  const [prompt, setPrompt] = React.useState("");
  const [provider, setProvider] = React.useState("");
  const [size, setSize] = React.useState(SIZES[0]);
  const [style, setStyle] = React.useState("");
  const [problem, setProblem] = React.useState<string | null>(null);
  const action = useAction();
  const available = providersForKind(providers, kind);
  const sizes = kind === "video" ? VIDEO_SIZES : SIZES;
  const selectedProvider = available.find((item) => item.id === provider)?.id ?? "";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const blocked = validateMediaDraft({ kind, prompt, provider: selectedProvider }, providers);
    setProblem(blocked);
    if (blocked) return;
    const result = await action.run(() =>
      central.media.generate({
        kind,
        prompt: prompt.trim(),
        provider: selectedProvider || undefined,
        size,
        style: style.trim() || undefined,
        workspace,
      })
    );
    if (result) {
      setPrompt("");
      onGenerated();
    }
  };

  return (
    <form className="px-6 py-4 border-b border-cb-line-0" onSubmit={submit}>
      <fieldset disabled={action.busy} className="m-0 p-0 border-0 min-w-0">
        <div className="cbc-grid">
          <Field label="O que gerar" htmlFor="media-prompt" wide>
            <textarea
              id="media-prompt"
              className="cbc-control"
              rows={2}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="um ícone de terminal sobre fundo escuro, traço fino"
            />
          </Field>
          <Field label="Tipo" htmlFor="media-kind">
            <Select
              id="media-kind"
              value={kind}
              onChange={(value) => {
                setKind(value);
                setProvider("");
                setSize(value === "video" ? VIDEO_SIZES[0] : SIZES[0]);
              }}
              options={[
                { value: "image", label: "imagem" },
                {
                  value: "video",
                  label: `vídeo${providersForKind(providers, "video").length ? "" : " (sem provedor)"}`,
                },
              ]}
            />
          </Field>
          <Field label="Provedor" htmlFor="media-provider">
            <Select
              id="media-provider"
              value={selectedProvider}
              onChange={setProvider}
              disabled={!available.length}
              options={[
                {
                  value: "",
                  label: available.length ? "escolher sozinho" : "nenhum para este tipo",
                },
                ...available.map((item) => ({ value: item.id, label: item.label })),
              ]}
            />
          </Field>
          <Field label="Tamanho" htmlFor="media-size">
            <Select
              id="media-size"
              value={size}
              onChange={setSize}
              options={sizes.map((value) => ({ value, label: `${SIZE_LABEL[value]} ${value}` }))}
            />
          </Field>
          <Field label="Estilo" htmlFor="media-style">
            <input
              id="media-style"
              className="cbc-control"
              value={style}
              onChange={(event) => setStyle(event.target.value)}
              placeholder="opcional, como: flat, foto, pixel art"
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <Btn
            tone="accent"
            type="submit"
            disabled={action.busy || !available.length || !prompt.trim()}
          >
            {action.busy ? "gerando…" : "gerar"}
          </Btn>
          {action.busy && (
            <span className="text-2xs text-cb-fg-2" role="status">
              Pode levar alguns minutos, principalmente vídeo.
            </span>
          )}
          {(problem || action.error) && (
            <span className="cbc-error-line" role="alert">
              {problem ?? action.error}
            </span>
          )}
        </div>
      </fieldset>
    </form>
  );
}

export function MediaSection({ workspace }: { workspace: string | null }) {
  const providers = useResource(central.media.providers, []);
  useProviderRefresh(providers.reload);
  const resource = useResource(
    async () => (workspace ? central.media.list(workspace) : ([] as MediaItem[])),
    [workspace]
  );
  const now = Date.now();

  return (
    <>
      <SectionHead title="Mídia" lead="Imagens e vídeos gerados neste workspace." />
      <Gate resource={resource} noun="a mídia">
        {(items) => (
          <div className="cb-scroll flex-1 min-h-0">
            {!workspace ? (
              <StateMessage
                title="Abra um workspace para gerar mídia"
                text="Os arquivos ficam dentro da pasta do projeto."
                role="status"
              />
            ) : providers.state !== "ready" ? (
              <Gate resource={providers} noun="os provedores de mídia">
                {() => null}
              </Gate>
            ) : providers.data?.length === 0 ? (
              <StateMessage
                title="Nenhum provedor de mídia conectado"
                text="Gerar imagem ou vídeo precisa de uma chave de API. Sem ela, nada é gerado aqui."
                color="var(--cb-warn)"
                role="status"
              >
                <Btn tone="accent" onClick={openProviders}>
                  conectar um provedor
                </Btn>
              </StateMessage>
            ) : (
              <GenerateForm
                key={workspace}
                providers={providers.data ?? []}
                workspace={workspace}
                onGenerated={resource.reload}
              />
            )}
            {items.length > 0 ? (
              <div className="p-6">
                <p className="cb-label mb-2">
                  {items.length} gerado{items.length === 1 ? "" : "s"}
                </p>
                <div className="cbc-gallery">
                  {items.map((item) => (
                    <Tile key={item.path} item={item} now={now} />
                  ))}
                </div>
              </div>
            ) : (
              workspace &&
              Boolean(providers.data?.length) && (
                <StateMessage
                  title="Nada gerado ainda"
                  text="O que você gerar aparece aqui."
                  role="status"
                />
              )
            )}
          </div>
        )}
      </Gate>
    </>
  );
}
