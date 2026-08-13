# ADR 0003 — Router com histórico e feature flags

**Status:** aceito, atualizado · **Data:** 2026-08-13 · **Fase:** 1 (Fundação)

## Parte A — Router

### Contexto

O router era isto, inteiro:

```tsx
export type Route = '/' | '/workspaces' | '/settings';
const [route, setRoute] = useState<Route>('/');
```

Sem histórico, sem voltar, sem deep-link, sem parâmetros. Um app que abre
painéis, workspaces e (a partir da Fase 6) specs precisa dos quatro.

### Decisão

Núcleo puro em `src/lib/router-core.ts` — pilha de histórico com cursor,
normalização de caminho, parse/serialize de hash e matcher de segmentos
dinâmicos, tudo sem React e sem DOM, testado direto (22 casos).

Ligação React em `src/lib/router.tsx` via `useSyncExternalStore`.

Duas decisões que valem registro:

**O store vive no escopo de módulo, não em Context.** O command palette, os
atalhos de teclado e os handlers de IPC precisam navegar de fora da árvore
React. `navigate()` é importável de qualquer lugar. `RouterProvider` fica só
por compatibilidade com a árvore atual.

**Hash routing, não history API.** O renderer é servido de `file://` em
produção, onde roteamento por path não funciona. O hash sobrevive a reload e
pode ser colado para abrir o app direto numa tela.

A pilha satura em 100 entradas, podando pela frente. Navegar a partir do meio
do histórico trunca o futuro, como num browser. Navegar para onde já se está é
ignorado, para que clicar duas vezes no mesmo item de menu não empilhe
duplicata.

### Compatibilidade

`useRouter().route`, `navigate()` e `<Link href>` mantêm as assinaturas
antigas — os 6 consumidores atuais não mudaram. `route` agora é `string` em
vez de união literal, o que aceita as rotas novas sem alterar quem compara com
`'/settings'`.

## Parte B — Feature flags

### Contexto

A refatoração do shell é grande demais para acontecer no lugar, e o app está
em produção (1.15.9). Refatorar direto deixaria o app instável a cada fase.

### Decisão

Shell novo cresce em paralelo, atrás de flag, e vira o padrão só quando
estiver melhor em todos os aspectos.

Registro em `src/lib/flags.ts`, preferências em `src/stores/flags-store.tsx`.
Precedência, do mais forte ao mais fraco:

| Origem | Exemplo | Alcance |
|---|---|---|
| Query string | `?ff_shellV2=1` | Uma sessão — reproduzir bug sem mexer nas preferências |
| Ambiente | `CODEBRAIN_FF_SHELLV2=1` | Build / CI |
| Preferência salva | toggle nas configurações | Persistente |
| Default da flag | declarado no registro | Fallback |

O renderer não tem `process.env`, então o preload lê as variáveis
`CODEBRAIN_FF_*` e expõe em `window.__CODEBRAIN_FLAGS__`. O casamento é
insensível a caixa, porque variável de ambiente é MAIÚSCULA e chave de flag é
camelCase.

`flagOverrideSource()` diz se uma flag está travada por override, para que as
configurações mostrem o controle desabilitado com o motivo — em vez de deixar
o usuário clicar num toggle sem efeito.

### Consequências

- Código duplicado temporário entre shell antigo e novo. É o preço aceito por
  manter o app utilizável em toda commit.
- Flags são para transição, não para sempre. Quando o shell v2 virar padrão e
  estabilizar, a flag e o shell antigo saem juntos.
- Preferências de flags removidas do código são descartadas na hidratação, para
  não ficarem penduradas no localStorage.

## Atualização após as fases 2–6

Com o shell terminal-first validado por testes e build, `shellV2` passou a ser
o padrão. A persistência foi versionada: instalações que receberam o antigo
valor inicial `false` migram para o novo default. A flag continua temporariamente
como fallback explícito, não mais como barreira de descoberta.
