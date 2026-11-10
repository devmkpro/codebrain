# Continuidade e rollback

Escolha a estratégia pela topologia observada, não por uma receita universal.

| Ambiente | Estratégia | Verificação |
| --- | --- | --- |
| Proxy com reload | Validar configuração e recarregar somente o serviço alterado | Novas conexões saudáveis; antigas drenadas |
| Releases versionadas | Preparar e validar antes da troca atômica | Nova release ativa e anterior disponível |
| Múltiplas réplicas | Atualizar gradualmente com readiness | Capacidade e respostas externas preservadas |
| Processo ou container único | Procurar troca de upstream; limitar interrupção se inevitável | Volumes e jobs preservados; informar interrupção |
| Filas e jobs longos | Consumidor substituto compatível e drenagem graciosa | Sem perda, duplicação ou encerramento forçado |
| Banco de dados | Migração compatível e backup consistente | Bloqueios, transações e rollback conhecidos |

Jobs ativos não são motivo isolado para recusar um deploy autorizado. Antes da troca, revise política de restart, idempotência e compatibilidade entre consumidores antigos e novos. Não use `SIGKILL`, `down` ou remoção de volumes para destravar uma atualização sem diagnóstico e autorização correspondentes.

Healthcheck de processo não substitui o teste do fluxo. Não prometa zero downtime quando não há capacidade de troca. Se mudar SSH, firewall ou credenciais fizer parte do pedido, mantenha uma conexão de recuperação e confirme uma segunda conexão antes de encerrar a primeira.
