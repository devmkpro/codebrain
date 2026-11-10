---
name: cb-findings
description: Use para registrar, corrigir ou verificar defeitos com finding_add, finding_update e finding_list.
---

# Findings

Cada defeito é um registro, com prova e ciclo de vida.

## Registrar

`finding_add` exige `evidence`: `arquivo:linha` com o trecho, ou o caminho do print. Sem isso o registro é recusado. Inclua `steps`, `expected` e `observed` sempre que couber.

Repetir o mesmo título e local não cria duplicata: soma a prova no ID existente, e se ele já estava resolvido, reabre.

## Severidade

- `high`: impede o uso ou a entrega, ou perde dados.
- `medium`: atrapalha, mas existe alternativa.
- `low`: acabamento.

Na dúvida entre duas, descreva o impacto real e escolha a menor que o descreve.

## Ciclo de vida

```
open -> fixed -> verified
open -> needs_decision -> open
fixed -> reopened -> fixed
verified -> reopened
```

- `fixed` exige `note` com a causa e como validou; informe `commit` quando houver.
- `verified` e `reopened` exigem `evidence` de que os passos foram refeitos.
- Quem corrigiu não pode verificar a própria correção.
- `needs_decision` é para quando a escolha é do usuário, não do agente.

Use `finding_list` para ver o que está aberto antes de começar.
