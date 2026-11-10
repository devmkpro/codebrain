---
name: cb-safe-deploy
description: Publicar aplicações e corrigir produção com descoberta do workspace, backup, rollback, drenagem de jobs e validação da versão e do fluxo real, em qualquer stack.
---

# Deploy seguro

Use quando o usuário autorizar uma publicação ou intervenção operacional. Diagnóstico sozinho não autoriza deploy. Use `cb-ssh-operations` para o acesso remoto e a descoberta do vínculo com o workspace. Respeite instruções do projeto e o catálogo de skills autorizado.

## Preparar antes da troca

- Identifique ambiente, commit/artefato exato, estado Git remoto e local, pipeline e comandos reais. Preserve alterações desconhecidas; não faça reset, stash, push ou migração destrutiva por conveniência.
- Observe serviços, proxy, portas, filas de espera e processamento, jobs reais, scheduler, processos de fundo, banco, Redis, volumes, disco e RAM. Healthcheck saudável não prova ociosidade.
- Prepare backup consistente do que mudará, configuração anterior e rollback executável. Não copie arquivos de um banco ativo como backup. Preserve `.env`, uploads, sessões e persistência. Não exponha credenciais na evidência.
- Inspecione o script escolhido. Um script chamado graceful pode interromper toda a pilha. Não use `compose down`, prune de volumes ou limpeza ampla para publicar uma aplicação.

## Publicar com continuidade

Trabalho ativo não bloqueia automaticamente um deploy autorizado nem exige nova permissão só por estar ocupado. Escolha pela topologia: release isolada e troca atômica, rolling update, upstream substituto ou atualização pontual. Não prometa zero downtime numa instância única sem capacidade de troca; informe e reduza a interrupção inevitável.

Construa e valide antes da troca, sem alterar arquivos servidos parcialmente. Mantenha ativos frontend antigos para abas abertas. Use migrações compatíveis com consumidores antigos e novos. Revalide os jobs imediatamente antes da troca; forneça consumidores substitutos compatíveis e drene os antigos sem matar tarefas. Não force encerramento de workers ocupados. Redis, filas e volumes devem sobreviver.

Valide configuração antes de reload. Troque somente componentes necessários; não reinicie toda a VM. Se a nova versão falhar, contenha a regressão e reverta quando seguro. Rollback de código não desfaz migrações ou efeitos externos automaticamente.

Para Laravel/PHP-FPM/Supervisor, leia [operações Laravel](references/laravel.md).

## Provar e entregar

Confirme commit e processo realmente em execução, endpoint público, fluxo afetado, assets, filas e persistência. Verifique novamente após retirar a capacidade antiga. Para UI, valide no navegador. HTTP 202, processo ativo ou comando sem erro não provam o resultado final.

Relate o que foi publicado, evidência recente, interrupção, rollback disponível e limitações. Não declare sucesso sem teste do fluxo solicitado; diferencie teste simulado de consulta real. Salve decisões não secretas no contexto privado do projeto para reduzir redescoberta.
