# Retomada nativa de conversas

No seletor **Novo pane → Retomar conversa**, selecione uma conversa salva ou
abra **Retomar por ID**. O histórico continua pertencendo à CLI: Codebrain
guarda sua identidade, projeto, conta, modelo e limites de skills. A prévia
do terminal não é usada como substituta da conversa.

## Contratos verificados em 10/11/2026

Os argumentos abaixo são adicionados à chamada existente da CLI; `chat` de
Kiro/Hermes vem do registro de harnesses. A fonte de cada contrato também
está em `electron/main/services/spawn/session-resume.ts`.

| Harness | Seleção de conversa exata | Evidência |
| --- | --- | --- |
| Claude Code | `--resume ID` | `claude --help`, [referência](https://code.claude.com/docs/en/cli-reference) |
| OpenClaude | `--resume ID` | `openclaude --help` instalado |
| Codex | `resume ID` | `codex resume --help` instalado |
| Gemini | `--resume ID` | [sessões](https://geminicli.com/docs/cli/session-management/) |
| Kimi | `--session ID` | [sessões](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/sessions) |
| Cursor | `--resume ID` | [parâmetros](https://cursor.com/docs/cli/reference/parameters) |
| Copilot | `--resume=ID` | [referência](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference) |
| Kiro | `chat --resume-id ID` | `kiro-cli chat --help`, [sessões](https://kiro.dev/docs/cli/chat/session-management/) |
| OpenCode | `--session ID` | [CLI](https://opencode.ai/docs/cli/) |
| Grok | `--resume ID` | [referência](https://docs.x.ai/build/cli/reference) |
| Antigravity | `--conversation ID` | [referência](https://antigravity.google/docs/cli/reference) |
| Hermes | `chat --resume ID` | [comandos](https://hermes-agent.nousresearch.com/docs/reference/cli-commands) |
| Muse | `resume ID` | [sessões](https://dev.meta.ai/docs/muse-code/interactive) |
| Command Code | `--resume ID` | [referência](https://commandcode.ai/docs/reference/cli) |

Não se usa `--last`, seleção global da última conversa, flags presumidas nem
fallback para outro harness/provider. `hermes resume` não é o comando de
retomada de uma conversa; Muse usa um subcomando, não `--resume`.

## Captura e limites

- Claude/OpenClaude: o Codebrain atribui um UUID usando `--session-id`,
  confirmado no help local, ao criar a conversa. Retomadas usam `--resume`.
- Codex/Gemini/Kimi/Cursor/Copilot: os observadores de arquivos existentes
  passam a publicar a identidade ao pane e persistir seus metadados. Perfis
  gerenciados são observados separadamente. Casos ambíguos não são vinculados
  pela escolha do arquivo mais recente. Codex usa o identificador do pane nas
  instruções de desenvolvedor para separar conversas paralelas no mesmo cwd.
- Nos demais harnesses, ou quando não há captura inequívoca, informe uma vez
  o ID completo por **Retomar por ID**. Depois a conversa fica na lista salva.
  Esta implementação não promete captura automática universal de IDs.
- Conversas anteriores sem ID são prévias legadas: não são abertas como se
  uma nova conversa recuperasse o contexto inteiro. Uma troca de conversa via
  `/new`/`/resume` dentro da própria CLI pode exigir informar o novo ID.
- A mesma CLI e seus arquivos nativos precisam continuar instalados. Limpeza
  de sessões pelo fornecedor pode tornar um ID indisponível. Não há conversão
  automática de histórico entre harnesses nem restauração de sessões SSH em
  outra máquina. Use o ambiente/perfil original.

## Persistência e segurança

Os metadados são arquivos locais atômicos em `userData/native-sessions`, sem
alterar a versão do banco de memória. Não incluem env, chaves, argumentos
antigos, prompts nem saída do terminal. A identidade é vinculada por hash ao
harness, máquina, cwd, perfil e conta. A conta removida ou perfil divergente
gera erro, não fallback. Solicitações simultâneas da mesma conversa são
coalescidas, evitando duas PTYs concorrentes sobre o mesmo histórico.

Snapshots incluem identidade e conta e filtram o workspace. A restauração
não reenvia o prompt original, não usa um LLM para recriar os workers, não
injeta as últimas linhas como uma conversa fictícia e preserva os limites
de skills registrados.

## Arraste da janela no Windows

A proteção de workArea não pode executar `setBounds` durante o loop nativo
de mover/redimensionar. Agora observa `will-move`/`will-resize` e aguarda
`moved`/`resized`, inclusive para callbacks pendentes atrasados pelo streaming.
Maximização continua limitada à área acima da barra de tarefas.

## Validação

Os testes cobrem os 14 contratos, conflitos, isolamento de contas, reinício
do armazenamento, restauração sem prompt sintético, concorrência de spawn,
Codex paralelo e proteção de arraste. A UI foi exercitada em Electron com
CLIs offline de Codex e Kiro, verificando os IDs reais recebidos pelo fixture
e a lista após reabrir a instância. Os demais contratos foram validados por
documentação/testes, não por inferências autenticadas em todos os fornecedores.
Eventos de arraste sob streaming foram simulados na janela Electron; o gesto
físico com mouse continua sendo uma validação manual separada.

Sem bump, tag, publicação ou reinstalação do aplicativo do usuário.
