# Correções de feedback — 2.0.1

## Instalação e persistência

O erro `Banco na versão 4, mas esta build conhece só até 3` foi rastreado ao
executável instalado: o `app.asar` e o executável naquele diretório ainda eram
1.21.5. O schema dessa instalação termina em 3; o schema da tag v2.0.0 e do
código atual termina em 4. O instalador baixado tem ProductVersion 2.0.0,
mas o executável instalado ainda informa 1.21.5.468. A origem da instalação
antiga não foi determinada.
Não reduzir `PRAGMA user_version`, remover tabelas ou apagar o banco para
contornar a proteção contra downgrade. Instalar um artefato atualizado é a
correção; rebaixar o banco não é um procedimento de rollback seguro.

## Feedback incorporado

Revisão dos oito relatórios locais, incluindo novas entradas em admin-c,
backend-insights, user-account e user-commerce. Os relatórios originais não
foram alterados nem copiados para o repositório.

- Descoberta compacta por grupo e `tool_invoke` para clientes que mantêm um
  catálogo antigo: consulta e execução de uma ferramenta sem carregar centenas
  de schemas. Validação original do SDK e controles do handler são preservados.
- Leitura paginada com linhas, colunas e continuação; orçamento considera a
  serialização UTF-8. Pesquisa retorna trechos e linhas, aceita um único arquivo
  e diferencia caminho inexistente de nenhum resultado.
- Escrita com append e edição com pré-validação de todo o lote, dry-run,
  contadores, linhas correspondentes e diff limitado. Publicação é atômica por
  arquivo, não transação multiarquivo resistente a crash; falha de restauração
  concorrente é explicitada.
- `shell_run` fornece stdout, stderr, exit code, timeout e confirmação de
  encerramento. Exige política do workspace e aprovação desktop nova a cada
  execução. Não é sandbox do sistema operacional. Ambiente herdado é restrito;
  comandos usam shell explícito e processos filhos são encerrados em grupo/job.
- Spawn limitado em concorrência, recibos de submissão sem reenvio cego,
  identificação de shell e recuperação do brief da tarefa. Kiro reconhece os
  estados reais de inicialização, trabalho e entrada disponível.
- Tarefas associadas ao workspace/missão, sem fallback global para chamador
  desconhecido. Caminhos Windows equivalentes não separam artificialmente a
  mesma lista. IDs de panes são contexto de coordenação, não autenticação.
- Mensagens preservam o conteúdo completo dentro do limite anunciado e
  distinguem armazenamento de submissão ao terminal. Mensagens a agentes não
  podem ser injetadas em panes de shell como comandos.
- Busca de memórias reduz ruído automático e trata termos/tags de forma
  consistente. Caminhos são registrados relativos ao workspace correto;
  previews de arquivos conhecidos de credenciais são omitidos.
- Screenshots retornam caminho e metadados compactos; imagem MCP é opt-in.
  Avaliação do navegador aguarda promises e mantém a porta CDP ativa.
  Planos de verificação aceitam arquivos/rotas explícitos. Fallback UC exige
  sessão existente, capacidades confirmadas e opção explícita, sem reaproveitar
  cookies/perfis de outro usuário ou contornar login. Viewports a partir de
  320 px são aceitos; o tamanho solicitado é aplicado por CDP e seu resultado
  é informado. Erros de console são limitados ao período de cada navegação;
  redirecionamentos para login são reportados como autenticação necessária.

## Limites da validação

Testes usam arquivos temporários, SQLite de teste, transporte MCP real em
memória e instância Electron com perfil separado. A suíte completa passou com
1.308 testes após as verificações de empacotamento/mobile e metadados. O pacote Windows
2.0.1 passou no afterPack com schema 4 e três arquivos de persistência
byte a byte idênticos ao source. Esse executável abriu com banco de teste já
na versão 4; missão/brief foram recuperados pelo MCP, uma tarefa criada com
caminho Windows equivalente apareceu tanto no MCP quanto no painel da UI.
Chrome isolado confirmou viewport CSS 390×844, Promise aguardada e screenshot
de 390×844 sem alterar o viewport; a imagem gerada foi inspecionada.
O instalador NSIS Windows x64 foi gerado com ProductVersion 2.0.1. No último
smoke do executável empacotado, a integração informou versão 2.0.1 e 320 tools;
o MCP ficou online e não houve aviso de configuração ausente do atualizador.
O banco real do usuário e a instalação antiga não foram alterados pelo teste.

O typecheck do processo principal passa. O typecheck explícito da interface
encontra 481 diagnósticos: a comparação com uma extração limpa do commit
v2.0.0 produziu os mesmos 481 diagnósticos, sem diferenças. O comando antigo
`tsc --noEmit` usava um projeto raiz vazio e não verificava os projetos
referenciados. `npm run typecheck` agora aponta explicitamente para o projeto
web e não mascara essa dívida existente. Isso não equivale a typecheck global
limpo. A CI de tags executa testes, orçamento e typecheck do processo principal
antes dos instaladores.

Não foram feitas chamadas pagas a modelos nem login em contas reais. Uma
sessão Kiro executando inferência e o fallback UC completo não foram validados
contra serviços reais. Alterações no catálogo externo de `tool_load`, eventos
de histórico sem resposta, worktree automático por worker, coalescência de
mensagens e canário de HMR/typecheck após cada escrita não fazem parte desta
correção. Autenticação visual continua exigindo autorização apropriada.
