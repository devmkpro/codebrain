---
name: cb-evidence
description: Use antes de afirmar que algo funciona, passou ou está pronto. Exige saída de comando recente.
---

# Evidência

Não diga que funciona sem ter visto funcionar agora.

1. Decida qual comando prova a afirmação.
2. Rode depois da sua última edição.
3. Leia a saída inteira: código de saída, número de falhas, avisos.
4. Afirme somente o que a saída mostra, citando os números.

## Não vale como prova

- "deveria funcionar", ou um resultado de antes da mudança;
- o typecheck provando comportamento: ele só prova tipos;
- teste parcial usado para falar da suíte toda;
- o relato de outro agente que você não conferiu.

## Quando não dá para verificar

Diga isso com todas as letras: o que não foi verificado e por quê. "Não testei com a API real porque não há chave" é uma resposta boa. Silêncio não é.

Em `handoff_submit`, cada comando vai em `evidence.commands` com o código de saída real, inclusive os que falharam.
