/* ═══════════════════════════════════════════════════════════════════════════
   REGISTRO DE AÇÕES
   ═══════════════════════════════════════════════════════════════════════════

   Fonte única de tudo que o app sabe fazer.

   O problema que isto resolve: hoje uma funcionalidade só existe se houver um
   ícone para ela no AppHeader — que já tem 1675 linhas e ~15 features
   espremidas numa barra. Painéis inteiros (Cron, Recipes, Memória, Histórico,
   Remote) são alcançáveis por exatamente um botão sem rótulo, e nada é
   pesquisável. Quem não sabe que o recurso existe não o encontra.

   Com um registro, cada capacidade se declara uma vez, com nome, palavras-
   chave e atalho. A partir daí ela aparece automaticamente no command palette,
   nos atalhos de teclado e (Fase 4) na barra de comando do shell v2. Adicionar
   funcionalidade deixa de exigir espaço na barra.

   Registrar é dinâmico de propósito: ações contextuais (as de um pane, as de
   uma spec aberta) entram e saem conforme o contexto, sem que o palette
   precise conhecê-las.
   ═══════════════════════════════════════════════════════════════════════════ */

export type ActionGroup =
  | "navegação"
  | "agentes"
  | "workspace"
  | "painéis"
  | "sessão"
  | "aparência"
  | "spec"
  | "sistema";

/** Ordem de exibição dos grupos no palette. */
export const ACTION_GROUP_ORDER: ActionGroup[] = [
  "agentes",
  "navegação",
  "workspace",
  "painéis",
  "sessão",
  "spec",
  "aparência",
  "sistema",
];

export interface Action {
  /** Estável e único. Usado para deduplicar e para lembrar uso recente. */
  id: string;
  /** O que aparece na lista. Em português, como o resto da UI. */
  title: string;
  /** Linha de apoio — o que a ação faz, ou o estado atual. */
  subtitle?: string;
  group: ActionGroup;
  /** Termos alternativos de busca: sinônimos, o nome em inglês, a MCP tool
   *  equivalente. É o que faz "spawn" achar "Novo pane". */
  keywords?: string[];
  /** Atalho, para exibição e para o binding global. Ex.: ["Ctrl", "K"]. */
  shortcut?: string[];
  /** Nome do ícone lucide-react. */
  icon?: string;
  /** Executa. Pode ser assíncrona; o palette fecha antes de rodar. */
  run: () => void | Promise<void>;
  /** Disponibilidade. Ação indisponível some da lista em vez de falhar ao
   *  ser executada. */
  enabled?: () => boolean;
  /** Ações destrutivas ganham confirmação e cor de perigo. */
  dangerous?: boolean;
  /** Peso manual de ordenação para a lista sem query. Maior aparece antes. */
  priority?: number;
}

/* ── Store ────────────────────────────────────────────────────────────────
   Escopo de módulo, como o router: atalhos globais e código fora da árvore
   React precisam disparar ações.                                            */

type Listener = () => void;

const actions = new Map<string, Action>();
const listeners = new Set<Listener>();

/** Incrementado a cada mudança — dá um snapshot estável ao useSyncExternalStore. */
let version = 0;
let snapshot: Action[] = [];

function emit(): void {
  version++;
  snapshot = Array.from(actions.values());
  for (const listener of listeners) listener();
}

/**
 * Registra uma ou mais ações. Devolve a função de remoção — pensada para ser
 * o retorno de um `useEffect`, para que ação contextual saia junto com o
 * componente que a trouxe.
 *
 * Registrar um id que já existe substitui a ação anterior; é o que permite a
 * um componente atualizar o subtítulo (ex.: "Tema: escuro" → "Tema: claro")
 * sem lidar com remoção.
 */
export function registerActions(...toRegister: Action[]): () => void {
  for (const action of toRegister) actions.set(action.id, action);
  emit();

  return () => {
    for (const action of toRegister) {
      // Só remove se ainda for a mesma ação — um registro posterior com o
      // mesmo id não deve ser apagado pela limpeza do anterior.
      if (actions.get(action.id) === action) actions.delete(action.id);
    }
    emit();
  };
}

export function unregisterAction(id: string): void {
  if (actions.delete(id)) emit();
}

/** Todas as ações registradas. Snapshot estável entre mudanças. */
export function getActions(): Action[] {
  return snapshot;
}

export function getAction(id: string): Action | undefined {
  return actions.get(id);
}

export function subscribeActions(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Versão atual do registro — usado como snapshot barato. */
export function getActionsVersion(): number {
  return version;
}

/**
 * Executa uma ação pelo id. Ignora silenciosamente id desconhecido — o
 * chamador costuma ser um atalho, e travar por causa de um binding obsoleto
 * seria pior que não fazer nada.
 *
 * @returns true se a ação existia e estava disponível.
 */
export async function runAction(id: string): Promise<boolean> {
  const action = actions.get(id);
  if (!action) return false;
  if (action.enabled && !action.enabled()) return false;
  await action.run();
  return true;
}

/** Só para teste — limpa o registro entre casos. */
export function __resetActions(): void {
  actions.clear();
  emit();
}

/* ── Consultas ────────────────────────────────────────────────────────── */

/** Ações disponíveis agora, na ordem de exibição padrão (grupo, prioridade). */
export function availableActions(all: readonly Action[] = snapshot): Action[] {
  return all
    .filter((action) => !action.enabled || action.enabled())
    .slice()
    .sort((a, b) => {
      const groupDelta =
        ACTION_GROUP_ORDER.indexOf(a.group) - ACTION_GROUP_ORDER.indexOf(b.group);
      if (groupDelta !== 0) return groupDelta;
      const priorityDelta = (b.priority ?? 0) - (a.priority ?? 0);
      if (priorityDelta !== 0) return priorityDelta;
      return a.title.localeCompare(b.title, "pt-BR");
    });
}

/** Campos secundários que a busca do palette considera além do título. */
export function actionSearchFields(action: Action): string[] {
  const fields = [action.group, ...(action.keywords ?? [])];
  if (action.subtitle) fields.push(action.subtitle);
  return fields;
}
