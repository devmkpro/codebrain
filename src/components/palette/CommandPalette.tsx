import React from "react";
import * as Icons from "lucide-react";
import {
  type Action,
  ACTION_GROUP_ORDER,
  actionSearchFields,
  availableActions,
  getAction,
  getActions,
  getActionsVersion,
  subscribeActions,
} from "../../lib/actions";
import { highlightSegments, rankItems } from "../../lib/fuzzy";
import { usePaletteStore } from "../../stores/palette-store";

/* ═══════════════════════════════════════════════════════════════════════════
   COMMAND PALETTE
   ═══════════════════════════════════════════════════════════════════════════

   Ctrl+K. Busca única sobre tudo que o app sabe fazer.

   Este é o componente que resolve o problema central de descoberta do
   Codebrain: painéis inteiros (Cron, Recipes, Memória, Histórico, Remote)
   eram alcançáveis por um único ícone de 15px sem rótulo no header. Quem não
   sabia que existiam não os encontrava. Agora tudo tem nome, sinônimo e
   atalho visível — o palette também *ensina* os atalhos, mostrando-os ao lado
   de cada ação.

   É o primeiro componente escrito inteiramente sobre tokens: nenhum hex, e
   por isso funciona nos dois temas sem uma linha de override.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Lê o registro de ações reagindo a mudanças. */
function useActions(): Action[] {
  React.useSyncExternalStore(subscribeActions, getActionsVersion, getActionsVersion);
  return getActions();
}

/** Ícone lucide pelo nome, ou um ponto quando o nome não existe. */
function ActionIcon({ name }: { name?: string }) {
  const Icon = name ? (Icons as unknown as Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>>)[name] : undefined;
  if (!Icon) return <span className="w-[13px] shrink-0" aria-hidden />;
  return <Icon size={13} strokeWidth={1.5} />;
}

/** Título com as letras casadas destacadas. */
function HighlightedTitle({ text, indices }: { text: string; indices: number[] }) {
  const segments = React.useMemo(() => highlightSegments(text, indices), [text, indices]);
  return (
    <>
      {segments.map((segment, index) =>
        segment.matched ? (
          <span key={index} className="text-cb-accent-bright">
            {segment.text}
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

function Shortcut({ keys }: { keys: string[] }) {
  return (
    <span className="flex items-center gap-1 shrink-0">
      {keys.map((key) => (
        <kbd key={key} className="cb-kbd">
          {key}
        </kbd>
      ))}
    </span>
  );
}

/** Uma linha da lista. */
const Row = React.memo(function Row({
  action,
  indices,
  selected,
  onRun,
  onHover,
}: {
  action: Action;
  indices: number[];
  selected: boolean;
  onRun: (action: Action) => void;
  onHover: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={() => onRun(action)}
      onMouseMove={onHover}
      className="cb-row w-full text-left h-cell-lg"
      style={
        action.dangerous && selected
          ? ({ "--cb-rail-color": "var(--cb-danger)" } as React.CSSProperties)
          : undefined
      }
    >
      <span className={action.dangerous ? "text-cb-danger" : "text-cb-fg-2"}>
        <ActionIcon name={action.icon} />
      </span>

      <span className="flex-1 min-w-0 flex items-baseline gap-2">
        <span className="text-sm truncate">
          <HighlightedTitle text={action.title} indices={indices} />
        </span>
        {action.subtitle && (
          <span className="text-xs text-cb-fg-3 truncate">{action.subtitle}</span>
        )}
      </span>

      {action.shortcut && <Shortcut keys={action.shortcut} />}
    </button>
  );
});

/** Item achatado da lista, com cabeçalho de grupo opcional acima. */
interface ListEntry {
  action: Action;
  indices: number[];
  /** Cabeçalho a renderizar antes desta linha. */
  heading?: string;
}

export function CommandPalette() {
  const open = usePaletteStore((state) => state.open);
  const closePalette = usePaletteStore((state) => state.closePalette);
  const recent = usePaletteStore((state) => state.recent);
  const markUsed = usePaletteStore((state) => state.markUsed);

  const actions = useActions();
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState(0);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  /* Lista exibida. Sem query, agrupada por seção com os recentes no topo;
     com query, uma lista plana ordenada por relevância — agrupar resultado de
     busca esconde o melhor match no meio de um cabeçalho. */
  const entries = React.useMemo<ListEntry[]>(() => {
    const available = availableActions(actions);

    if (query.trim()) {
      const ranked = rankItems(query.trim(), available, {
        primary: (action) => action.title,
        secondary: actionSearchFields,
      });
      return ranked.map(({ item, indices }) => ({ action: item, indices }));
    }

    const list: ListEntry[] = [];

    const recentActions = recent
      .map((id) => getAction(id))
      .filter((action): action is Action => Boolean(action))
      .filter((action) => !action.enabled || action.enabled());

    const recentIds = new Set(recentActions.map((action) => action.id));

    recentActions.forEach((action, index) => {
      list.push({
        action,
        indices: [],
        heading: index === 0 ? "Recentes" : undefined,
      });
    });

    for (const group of ACTION_GROUP_ORDER) {
      const inGroup = available.filter(
        (action) => action.group === group && !recentIds.has(action.id),
      );
      inGroup.forEach((action, index) => {
        list.push({ action, indices: [], heading: index === 0 ? group : undefined });
      });
    }

    return list;
  }, [actions, query, recent]);

  /* Reabrir sempre começa limpo: um palette que lembra a busca anterior faz o
     usuário apagar texto antes de pesquisar. */
  React.useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      // Foco direto: o input já está montado quando este efeito roda, porque
      // a mesma renderização que ligou `open` também criou o diálogo.
      //
      // Nada de requestAnimationFrame aqui — rAF não dispara enquanto a
      // página não está compondo quadros (janela minimizada, ocluída ou em
      // segundo plano), e o palette abriria sem foco justamente nesses casos.
      inputRef.current?.focus();
    }
  }, [open]);

  /* A seleção pode ficar fora da lista quando o filtro encolhe. */
  React.useEffect(() => {
    setSelected((current) => Math.min(current, Math.max(0, entries.length - 1)));
  }, [entries.length]);

  /* Mantém o item selecionado visível ao navegar por teclado. */
  React.useEffect(() => {
    if (!open) return;
    const container = listRef.current;
    const element = container?.querySelector<HTMLElement>(`[data-index="${selected}"]`);
    element?.scrollIntoView({ block: "nearest" });
  }, [selected, open]);

  const runAction = React.useCallback(
    async (action: Action) => {
      // Fecha antes de executar: várias ações abrem modal, e um palette ainda
      // aberto por cima fica estranho e rouba o foco.
      closePalette();
      markUsed(action.id);
      try {
        await action.run();
      } catch (error) {
        console.error(`[palette] ação "${action.id}" falhou:`, error);
      }
    },
    [closePalette, markUsed],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setSelected((current) => (current + 1) % Math.max(1, entries.length));
        break;
      case "ArrowUp":
        event.preventDefault();
        setSelected(
          (current) => (current - 1 + entries.length) % Math.max(1, entries.length),
        );
        break;
      case "Home":
        event.preventDefault();
        setSelected(0);
        break;
      case "End":
        event.preventDefault();
        setSelected(Math.max(0, entries.length - 1));
        break;
      case "Enter": {
        event.preventDefault();
        const entry = entries[selected];
        if (entry) void runAction(entry.action);
        break;
      }
      case "Escape":
        event.preventDefault();
        closePalette();
        break;
    }
  };

  if (!open) return null;

  return (
    <>
      <div
        className="cb-scrim"
        onClick={closePalette}
        aria-hidden
        style={{ zIndex: "var(--cb-z-palette)" }}
      />

      <div
        className="fixed left-1/2 -translate-x-1/2 top-[12vh] w-[min(640px,92vw)] cb-float overflow-hidden"
        style={{ zIndex: "var(--cb-z-palette)" }}
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
        onKeyDown={onKeyDown}
      >
        {/* Prompt — a barra de busca é escrita como um prompt de shell, que é
            o vocabulário visual do shell v2. */}
        <div className="flex items-center gap-3 px-4 h-cell-lg border-b border-cb-line-0">
          <span className="text-cb-accent text-sm select-none" aria-hidden>
            ❯
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            placeholder="Buscar ação, painel ou workspace…"
            aria-label="Buscar ação"
            role="combobox"
            aria-expanded
            aria-controls="cb-palette-list"
            aria-activedescendant={`cb-palette-item-${selected}`}
            className="flex-1 bg-transparent border-0 outline-none text-md text-cb-fg-0 placeholder:text-cb-fg-3"
          />
          <kbd className="cb-kbd">Esc</kbd>
        </div>

        {/* Resultados */}
        <div
          ref={listRef}
          id="cb-palette-list"
          role="listbox"
          className="cb-scroll max-h-[52vh] py-1"
        >
          {entries.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-cb-fg-2">Nada encontrado para “{query}”.</p>
              <p className="text-xs text-cb-fg-3 mt-1">
                Tente o nome do painel, o termo em inglês ou o nome da MCP tool.
              </p>
            </div>
          ) : (
            entries.map((entry, index) => (
              <React.Fragment key={entry.action.id}>
                {entry.heading && (
                  <div className="cb-label px-4 pt-3 pb-1">{entry.heading}</div>
                )}
                <div data-index={index} id={`cb-palette-item-${index}`} className="px-1">
                  <Row
                    action={entry.action}
                    indices={entry.indices}
                    selected={index === selected}
                    onRun={runAction}
                    onHover={() => setSelected(index)}
                  />
                </div>
              </React.Fragment>
            ))
          )}
        </div>

        {/* Rodapé — ensina a navegação. */}
        <div className="flex items-center gap-4 px-4 h-cell border-t border-cb-line-0 text-2xs text-cb-fg-3">
          <span className="flex items-center gap-1.5">
            <kbd className="cb-kbd">↑</kbd>
            <kbd className="cb-kbd">↓</kbd>
            navegar
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="cb-kbd">↵</kbd>
            executar
          </span>
          <span className="ml-auto">
            {entries.length} {entries.length === 1 ? "ação" : "ações"}
          </span>
        </div>
      </div>
    </>
  );
}
