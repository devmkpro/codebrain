# ADR 0001 — Design tokens e a paleta ANSI como fonte única

**Status:** aceito · **Data:** 2026-08-13 · **Fase:** 1 (Fundação)

## Contexto

O Codebrain não tinha camada de tokens. Componentes escreviam cor literal
direto na classe do Tailwind:

```tsx
<div className="bg-[#0c0c14] border-white/[0.04] text-slate-700">
```

Sem um lugar central para definir cor, o tema claro foi implementado como uma
folha de ~300 linhas em `index.css` que caçava cada hex por seletor de
atributo e sobrescrevia com `!important`:

```css
.light [class*="bg-[#0c0c14]"] { background: #ffffff !important; }
.light .text-slate-700         { color: #4a4a68 !important; }
```

Três consequências:

1. **Cada componente novo nasce quebrado no claro.** Um hex inédito não tem
   override e vira texto escuro sobre fundo escuro. O arquivo tinha comentários
   como `/* fix crítico: era #8888a8 — contraste 2.2:1 */`, sinal de que isso
   já vinha sendo caçado bug a bug.
2. **A guerra de especificidade.** Os overrides precisavam de `!important` para
   vencer as utilitárias, o que impedia qualquer componente de alterar sua
   própria cor legitimamente.
3. **Terminal e UI divergiam.** A paleta do xterm.js e a da interface eram
   definidas em lugares diferentes, e o app parecia um site em volta de um
   terminal em vez de uma peça só.

## Decisão

**A paleta da UI é a paleta ANSI do terminal.** As 16 cores ANSI são a base;
superfícies, texto, linhas e semântica derivam delas. Um badge de erro e um
`stderr` vermelho usam o mesmo token.

Três arquivos, em ordem de import:

| Arquivo | Papel |
|---|---|
| `src/styles/tokens.css` | Declara todo token `--cb-*`, nos dois temas |
| `src/styles/theme.css` | Mapeia token → utilitário Tailwind via `@theme inline` |
| `src/styles/base.css` | Primitivas estruturais (`.cb-panel`, `.cb-row`, `.cb-kbd`) |

Trocar de tema é **só redefinir token** em `:root.light`. Nenhum
`!important`, nenhum seletor que conheça componente.

`@theme inline` é obrigatório: o valor de cada token é ele mesmo uma `var()`
que muda em runtime. Sem `inline`, o Tailwind resolveria a indireção uma vez
no `:root` e a troca de tema não propagaria. Com `inline`, o utilitário emite
`background-color: var(--cb-bg-1)` e reage à redefinição.

## Consequências

**Ganhos**

- Componente que usa token funciona nos dois temas de graça.
- Alto contraste (`prefers-contrast: more`) sai como redefinição de token, não
  como mais uma folha de overrides.
- Densidade (`data-density`) reescala a grade de células globalmente.
- A escala de z-index virou nomeada (`--cb-z-*`), acabando com a briga entre
  `z-[9999]`, `z-[10000]` e `zIndex: 200` espalhados pelos componentes.

**Custos**

- Os ~300 componentes existentes continuam com hex hardcoded. Os overrides
  legados de light mode **permanecem em `index.css`** enquanto o shell antigo
  existir — remover agora quebraria o tema claro atual.
- A migração acontece por componente, na Fase 2: ao portar um componente para
  o shell v2, os hex saem e os overrides correspondentes podem cair.

**Regra para código novo:** nenhum hex literal em componente. Se falta um
token, adicione em `tokens.css` — não improvise no `className`.

## Alternativas descartadas

- **Corrigir os overrides de light mode.** Trata o sintoma; o componente
  seguinte reintroduz o problema.
- **CSS-in-JS / styled-components.** Traz runtime e uma segunda forma de
  escrever estilo num projeto que já é Tailwind inteiro.
- **`dark:` variant do Tailwind.** Dobra a classe em cada elemento
  (`bg-white dark:bg-black`) e não cobre alto contraste nem densidade.
