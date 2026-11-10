# Conexão e identidade

Use valores do cadastro autorizado ou fornecidos para a tarefa, nunca credenciais de exemplos. Chaves e senhas permanecem no cofre ou no mecanismo nativo da sessão.

- Descubra OpenSSH e o agente local antes de instalar ferramentas. `ssh-add -l` lista fingerprints; não exponha chaves privadas nem liste todas as identidades sem necessidade.
- Uma tentativa de leitura com `BatchMode=yes` e `ConnectTimeout=10` testa chave/agente sem bloquear. Falha por senha não prova ausência de acesso: use a autenticação interativa autorizada.
- A chave pública pode ser identificada com `ssh-keygen -lf arquivo.pub`. Derive a pública da privada somente quando solicitado, sem imprimir a privada e usando prompt protegido de passphrase.
- Confira fingerprints com console de nuvem, administrador ou outro registro confiável. Uma chave nova ou alterada exige verificação, não redução de proteção.
- Envie patches e scripts por transferência autenticada ou stdin com delimitação segura. Separe o shell local do remoto e confirme destinos absolutos antes da escrita.
- Não registre senhas digitadas interativamente. Não instale a chave privada do PC controlador nos servidores nem configure backups/sincronização de credenciais para destinos não solicitados.

O cofre local protege dados em repouso; ele não protege contra comprometimento da conta do sistema operacional ou de uma sessão autorizada. Não prometa isolamento contra outros processos do mesmo usuário.
