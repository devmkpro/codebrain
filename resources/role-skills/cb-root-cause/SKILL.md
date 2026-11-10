---
name: cb-root-cause
description: Use ao investigar bug, falha de teste ou comportamento inesperado, antes de propor qualquer correção.
---

# Causa raiz

Corrigir sintoma só muda o lugar onde o defeito aparece.

1. **Reproduza.** Tenha um jeito confiável de ver o erro acontecer. Sem isso, você ainda não sabe o que está corrigindo.
2. **Rastreie.** Siga o dado errado para trás até onde ele nasceu. Leia a mensagem de erro inteira.
3. **Uma hipótese por vez.** Escreva "acontece porque X" e faça o menor experimento que confirma ou derruba X. Mudar duas coisas juntas não ensina nada.
4. **Teste falhando primeiro.** Escreva o teste que reproduz o defeito e veja falhar pelo motivo certo.
5. **Corrija na origem.** Depois rode o teste novo e a suíte ao redor.

## Regra de parada

Três correções que falharam querem dizer que o entendimento está errado, não que falta uma quarta. Pare, escreva o que foi tentado e o que cada tentativa mostrou, e devolva com status `blocked`.
