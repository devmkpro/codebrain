# SSH do workspace atual

Antes da conexão, faça uma descoberta curta, local e focada:

1. Confirme o workspace ativo, raiz Git, branch, alterações locais e remote. Redija URLs se contiverem credenciais. Leia AGENTS.md e instruções aplicáveis.
2. Consulte `.codebrain/context.md`, `repository-map` e `workflow` quando presentes. Busque em README, documentação de operações, CI, Compose, manifests e scripts de deploy por ambiente, aplicação, serviços, diretório remoto e mecanismo de publicação. Leia scripts antes de executá-los: o nome não prova segurança.
3. Busque memória do projeto e `access_host_list`. Relacione o cadastro ao repositório e ambiente usando evidência explícita. A URL do remote Git identifica o repositório, não necessariamente a máquina que hospeda a aplicação. Não use o hostname interno de um Ubuntu como endereço acessível pelo controlador: respeite alias, túnel e ProxyJump cadastrados.
4. Havendo um vínculo inequívoco, abra esse acesso autorizado e informe brevemente projeto, ambiente e alvo. Se houver dois alvos plausíveis sem ambiente definido, peça apenas a informação faltante; não tente usuários, IPs ou credenciais para adivinhar.
5. Após conectar, confirme hostname, usuário, diretório da aplicação, versão e topologia reais com consultas. Compare com o contexto local antes de alterar qualquer coisa. Descrições antigas são pistas, não prova do estado atual.

Descobrir contexto não autoriza deploy ou restart. Não abra `.env` inteiro, chaves ou cofre como documentação. Consulte apenas nomes/configurações não secretas necessários; nunca salve tokens em memória. Preserve instruções locais mais específicas.

Depois de comprovar o acesso, salve em memória do projeto um vínculo mínimo: raiz/repositório sem credenciais, ambiente, ID do host no cofre, diretório remoto, serviços e documentação de deploy. Registre data e evidência da confirmação. Não duplique segredos ou transforme esse inventário privado em skill global distribuída. Na próxima tarefa, reutilize o vínculo e revalide os pontos que podem ter mudado.
