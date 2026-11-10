# Laravel em produção

Audite Nginx, versão PHP CLI e FPM, Supervisor/systemd, filas e argumentos dos workers, Redis, scheduler, Reverb, storage e usuário de serviço. Não assuma versões, nomes de units ou que Redis da porta 6379 pertença à aplicação.

Prepare dependências e assets em release isolada com lockfiles. Compartilhe `.env` e storage preservados, verifique boot e cache/configuração na release correta e só então troque o link/upstream. Não execute `config:clear` indiscriminadamente em outro projeto da mesma VM. Mantenha assets com hash da release anterior para clientes já abertos.

Antes de migrations, confira backup, locks, compatibilidade e efeitos de dados. Use expand/contract para convivência entre versões. Não execute rollback de schema automaticamente após falha.

Valide Nginx e FPM antes de reload; backups de virtual hosts ficam fora de sites-enabled. Recarregue somente o FPM aplicável. Workers longos precisam carregar o novo código de forma graciosa, com timeout de parada suficiente para os jobs. Verifique retry_after/visibility timeout contra timeout dos jobs para evitar duplicação. `queue:restart` não prova que todos já trocaram; confirme PIDs, versão e conclusão dos jobs. Verifique também scheduler e Reverb se usados.

Para capacidade, meça RAM por processo, CPU, latência e fila antes de aumentar pm.max_children ou numprocs. Não consuma toda a memória nem limpe caches do kernel periodicamente para mascarar pressão. Redis permanece privado e persistente. Limpezas exigem retenção explícita e alvos auditados: nunca remova uploads, volumes, bancos ou todas as releases.

Após a troca, valide página pública, rota da aplicação, health, CSS/JS e seus content types, storage público quando usado, WebSocket se aplicável, filas e scheduler. Preserve release anterior e configuração para rollback, considerando compatibilidade do schema.
