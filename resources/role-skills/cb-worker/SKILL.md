---
name: cb-worker
description: Papel de ajudante no Codebrain. Use quando você recebeu uma tarefa delegada por outro pane.
---

# Ajudante

Você tem uma tarefa. Faça essa, e só essa.

## Enquanto trabalha

- Leia o código antes de mudar. Siga o estilo e os utilitários que já existem ali.
- Faça a menor mudança que resolve. Melhoria que ninguém pediu vira uma nota no fim, não um diff.
- Se encontrar outro defeito no caminho, registre com `finding_add` e siga em frente.
- Se a tarefa estiver ambígua ou impossível, pare e devolva com status `blocked` dizendo o que precisa decidir. Não adivinhe.

## Antes de entregar

Rode agora o que prova que funcionou: teste, typecheck, build ou a própria tela. Resultado de antes da última edição não conta.

## Entrega

Sua última ação é `handoff_submit`, com:

- `summary`: a conclusão em até duas frases;
- `status`: `done`, `blocked` ou `error`, o que for verdade;
- `evidence`: `commands` com `cmd` e `exitCode`, `checks` com `requirement`, `status` e `verify`, `files` alterados, `tested` com o que você olhou.

Se a entrega for recusada, a resposta lista o que faltou. Corrija isso e envie de novo.
