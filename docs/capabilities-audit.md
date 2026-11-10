# Auditoria de capacidades — Codebrain 2.0.0

> Análise de 2026-11-09. Foco: funcionalidades, UX/onboarding, skills, orquestração e harness.

> Registro histórico do diagnóstico **antes da implementação desta revisão**.
> As lacunas abaixo não representam, por si só, o estado atual da versão 2.0.0.
> Esta revisão acrescenta registro de 14 harnesses, tabela por tarefa, contratos
> com evidências, skills nativas de papéis, modo agêntico, Central, contas e mídia.
> Compatibilidade e autenticação continuam condicionadas às capacidades reais
> de cada CLI. Testes locais não comprovam chamadas pagas nem login em outra conta.

## 1. O que foi analisado e os limites

O produto de referência usa **Tauri**, com um **sidecar Node** e `@anthropic-ai/claude-agent-sdk`.

| Parte | Como foi lida | Confiança |
|---|---|---|
| 18 skills + agente piloto (`resources/arsenal`) | texto puro, lido na íntegra ou por seções | alta |
| Frontend (160 assets dentro do `.exe`) | brotli extraído do binário; telas lidas pelos textos visíveis | alta para UX e copy |
| `sidecar/arms-mcp` | JS legível, só inventário de arquivos | média |
| Motor (`sidecar/dist/index.jsc`) | bytecode V8, **não descompilado**; só strings | baixa |

O app de referência não foi executado. O comportamento do motor vem do que as skills, a UI e as release notes descrevem. Bancos, credenciais SSH e pastas de dados do usuário não foram abertos.

**Atenção à proveniência.** A referência distribui o motor fechado em bytecode. Usar somente como referência de comportamento e escrever código e texto próprios. Comentários antigos de portabilidade em módulos como `handoff-wake-message.js`, `recipe-handlers.js`, `remote-bridge-handlers.js` e `cron-utils.js` exigem revisão de origem; remover uma marca da interface não resolve essa revisão. Este plano não copia skills nem código de terceiros.

## 2. Veredito

O Codebrain tem **mais capacidade bruta**. A referência tem uma experiência mais guiada: pega quem nunca abriu um terminal e o leva até um site no ar, e decide sozinho quem executa cada tarefa.

As maiores lacunas não são de quantidade de tools:

1. Contrato de entrega verificável entre piloto e worker.
2. Roteamento automático de CLI, modelo, esforço e skill por tipo de tarefa.
3. Onboarding que produz um resultado real.
4. Doutrina de papéis instalada em todas as CLIs.
5. Gestão de contas e limites.

## 3. Oportunidades de melhoria

### 3.1 Onboarding (a maior diferença)

| | Referência | Codebrain na análise inicial |
|---|---|---|
| Formato | trilha de 12+ passos com módulos, tempo estimado e progresso | tour de 3 slides, "1 minuto" (`TerminalFirstOnboarding.tsx`) |
| Ao terminar | site no ar, foto gerada, pedido próprio feito | a pessoa só leu sobre o app |
| Público | leigo; nada de jargão | assume dev (Ctrl+K, worktree, Spec Kit) |
| Instalar CLI | terminal embutido ao lado do passo, botão "digitar para mim", detecção automática | modal e banner que o working tree atual está removendo; sobra Configurações |

Padrões que valem copiar como ideia:

- **Uma frase conduz tudo.** O nome do negócio ("Doces da Luzia") entra no passo 1 e reaparece em todos os prompts. Pode ficar vazio: usa o exemplo.
- **Passos marcados como resultado.** Metadados `resultado: true`, tempo ("2 a 5 min") e o conceito que cada passo ensina.
- **Detecção em vez de confirmação.** "A gente percebe sozinho", "Fica verde quando a conta entrar". O app procura o binário e o login e reconhece `command not found` na saída.
- **Prova do valor por contraste.** Faz o site sem skill, instala a skill e refaz o mesmo site. A pessoa compara e escolhe.
- **Posicionamento depois da experiência.** A tela "4 formas de vibe coding" só aparece no fim, ancorada no que a pessoa acabou de ver.
- **Desarme de medo.** Explicar permissões do Windows, privacidade da senha e erros recuperáveis.
- **"Saiba mais" recolhido** em vez de texto na cara.
- **Cena animada curta** para cada conceito, carregada sob demanda.

### 3.2 Harness: quem faz cada tarefa

Tabela em Configurações, por **tipo de tarefa**: CLI, modelo, esforço, conta, agente, skills, lista de reservas, exemplos e contra-exemplos que o classificador lê.

O piloto só diz o quê: `pane_spawn({ task, name, prompt })`. A decisão segue uma escada fixa:

1. Alguém já trabalhou nisso, no mesmo tipo de trabalho? Retoma.
2. O humano pediu uma IA específica? Usa.
3. A tabela tem regra? Usa.
4. Classificador barato com confiança ≥ 60%? Usa (JEV via OpenRouter ou modelo local).
5. Senão, padrão declarado.

Detalhes que importam:

- O **recibo** do spawn diz o que foi decidido, em 1 ou 2 linhas.
- **Revisão nunca reusa o autor.**
- Reuso limitado: mesma CLI e modelo, fechado há menos de 2 h, abaixo de 100 mil tokens.
- O piloto **não lê a tabela** antes de delegar, para não gastar contexto do modelo caro.
- Agentes podem **propor** mudança na tabela; o humano aprova, recusa ou desfaz.
- Tela com o **fluxograma real da decisão** (6 abas: ajudante, navegador, durante/depois, squad, memória).

No Codebrain: `pane_spawn` pede `agent`, `providerId` e `model` explícitos (`packages/mcp/index.js:77`). Há presets de squad (`src/lib/squad-presets.ts`), `AgentScorer` e gatilhos por regex (`worker-dispatch.js`), mas nenhuma tabela por tipo de tarefa no spawn, nem recibo.

### 3.3 Orquestração

| Capacidade | Referência | Codebrain na análise inicial | Localização |
|---|---|---|---|
| Spawn já executando | `prompt` no spawn | `pane_spawn` + `pane_write` | `index.js:77` |
| N workers numa chamada | `panes: [...]` | não | `index.js:77` |
| Nome-objetivo do pane | obrigatório, verbo + resultado | `label` livre | |
| Contrato de saída | `expect: { schema, retries }`, recusa e devolve o que falta | não | |
| Evidência no handoff | `checks`, `commands {cmd, exitCode}`, `files`, `tested` | `summary`, `status`, `artifacts` | `index.js:680` |
| Status `auto` (worker parou sem handoff) | sim, não fecha o pane | parcial | `pane-handlers.js:443` |
| Modo piloto que só delega | modo Agêntico | só `livre` e `squad` | `missions-store.tsx:7` |
| Lembrete "não execute" por mensagem | sim | só no prompt inicial | `prompts/squad-orchestrator.md` |
| Briefing por ponteiro | doutrina com custo medido | não | |
| Retry após erro de conexão | configurável; avisa o piloto | não no PTY | |
| Restauração após fechar | "nada sobe até você escolher" | `--resume` por pane | `pane-spawn.ts:204` |

### 3.4 Contas, limites e custo

- **Várias contas por CLI**, cada uma com login e limite próprios. O Codebrain tem uma conta por CLI (`pane-spawn.ts:813`).
- **Redline**: quanto cada conta já queimou de cada janela (5 h, semana, por modelo) e travas por conta. O Codebrain mede tokens e custo, mas não janelas de limite.
- **Troca de conta** quando o limite acaba, ou aviso de que nada será feito.
- **13 CLIs** contra 7 mais o 9router. Faltam: Antigravity, Grok, OpenCode, Kiro, Muse, Hermes, Command Code.

### 3.5 Memória configurável

A OverMemory tem 11 chaves, todas desligadas por padrão, e cada uma explica o que faz, quando age, o que muda ao desligar e se gasta cota. A ordem de consulta vai do mais barato ao mais caro: contexto de nascimento, resumo, histórico, e só por último a conversa.

O Codebrain tem o **motor mais forte** (FTS5, grafo, lições, ledger, handoff virando memória em `pane-handlers.js:578`). Faltam a injeção em camadas no spawn, com limite de tamanho, e o controle na UI.

### 3.6 Copy das configurações

Cada opção responde "ganha" e "arrisca", em linguagem de pessoa. Exemplo: "com menos, retoma mais vezes e economiza mais". É um padrão barato com ganho alto.

### 3.7 Outras funcionalidades

| Funcionalidade | Codebrain |
|---|---|
| **Cofre**: segredos cifrados viram env no terminal; importa `~/.ssh/config`; endereço nunca aparece | só chaves de provider |
| **Mapa do workspace**: "missões que precisam de você", terminais fechados por dia | `SessionMap` parcial |
| **Mesa de leitura**: arquivos, CSV como tabela, editor | `files/Editor` parcial |
| **Squad montado por descrição**: "o que esse time entrega?" | manual |
| **Publicar** com link | não |
| **Geração de imagem e vídeo** como tools | não |
| **Jarvis/Clockinho**: voz controla o app, palavra de ativação | ditado apenas |
| **Celular**: pareamento por QR e relay | RemoteBridge parcial |
| **Decisor local** (modelo pequeno) | não |
| **Board externo** de cards (OverClick) | kanban interno |
| **Superfície enxuta**: ≤ 15 a 17 tools por plano | 260+, por grupos; mais de 100 aparecem ao conectar |

## 4. Skills: o que eles têm e nós não

| Skill | O que faz | Equivalente no Codebrain | Gap |
|---|---|---|---|
| `oc-guide` | explica o produto à pessoa; caminhos guiados | nenhum | **alto** |
| `oc-mcp` | manual do agente: receitas, anti-padrões medidos, parâmetros | `resources/codebrain-skill/codebrain.md`, referência de 177 linhas | **alto** |
| `oc-pilot` | decompor, delegar, verificar, convergir | `prompts/squad-orchestrator.md`, 27 linhas | **alto** |
| `oc-builder` | laço do executor | `prompts/squad-worker.md` | médio |
| `oc-scout` | pesquisa só leitura, tudo com `path:line` | `tech-researcher`, `code-analyst` | médio |
| `oc-conveyor` | revisor adversarial, condições de descarte | auditores por tema | **alto** |
| `oc-blackbox` | causa raiz antes do fix; 3 falhas = arquitetura errada | `debug-pane` só cobre pane travado | **alto** |
| `oc-stamp` | evidência fresca antes de "pronto" | tools `verify_*`, sem doutrina | **alto** |
| `oc-route` | plano que um estranho executa | Spec Kit parcial | médio |
| `qa-finding-protocol` | um arquivo por bug, ciclo de status | nenhum | médio |
| `qa-fix-protocol` | um commit por finding, clusters por arquivo | nenhum | médio |
| `oc-showcase` | regras de UI por prioridade | nenhum embutido | médio |
| `oc-site-premium` | site não genérico | nenhum embutido | baixo/médio |
| `oc-copywriting` | oferta e copy da entrega | nenhum | baixo/médio |
| `oc-image-assets` | lote de imagens com style-lock | nenhum; depende de tool de imagem | baixo |
| `oc-design-dna` | captura ao vivo de design system, com linter | nenhum | baixo/médio |
| `oc-browser` | doutrina de automação | `browser_guide` e skill própria | coberto |
| `oc-app-ui` | alias depreciado | não se aplica | nenhum |

**O que importa mais que a lista:** a referência instala esse conjunto no boot, em **todas as CLIs e contas**. Na análise inicial, o Codebrain instalava a skill principal por botão e só para o Claude (`register-skill.ts`), e as skills do repo usavam formato próprio (`skill.json` + `prompt.md`).

## 5. Onde o Codebrain é melhor (preservar)

- **Browser e scraping**: automação ampla, UC scraper com interceptação, sem equivalente identificado na referência.
- **Memória de fundo**: FTS5, grafo com PageRank, lições, work ledger retomável.
- **Verify**: prova visual de alteração de front-end como tool.
- **Spec Kit** versionado no repo.
- **Providers por API**: templates de provider, proxy e 9router.
- **Coordenação avançada**: consenso, pipelines, cron, LSP, Max/Compose mode.
- **Sem paywall** nas funções de orquestração, enquanto a referência restringe modo agêntico, memória e harness a um plano pago.
- **Código próprio legível**, sem motor em bytecode.

## 6. Plano de melhorias

Esforço: P pequeno, M médio, G grande.

### Fase 1: fundação do harness

| # | Entrega | Esforço | Arquivos principais |
|---|---|---|---|
| 1 | `pane_spawn` com `prompt`, `panes[]`, `name` obrigatório e recibo | M | `packages/mcp/index.js`, `bridge/pane-handlers.js` |
| 2 | `expect` + `handoff_submit.evidence`, com recusa e retry | M | idem, `packages/memory/store.js`, `OperationsBoard` |
| 3 | Pacote de skills de papel próprio, instalado no boot em todas as CLIs | M | `resources/`, `register-skill.ts` |
| 4 | Retry automático em erro de conexão; aviso ao orquestrador | P | `pty-manager.ts`, `idle-detector.ts` |

### Fase 2: roteamento e modo piloto

| # | Entrega | Esforço |
|---|---|---|
| 5 | Tabela por tipo de tarefa, escada de decisão, revisão nunca reusa autor | G |
| 6 | Tela "Quem faz cada tarefa" com fluxograma da decisão | M |
| 7 | Modo Agêntico em `MissionMode`: só delega, nome + objetivo, lembrete por mensagem | M |
| 8 | Memória em camadas no spawn, com limite de tamanho e chaves "ganha/arrisca" | M |

### Fase 3: onboarding

| # | Entrega | Esforço |
|---|---|---|
| 9 | Trilha guiada: objetivo, pasta, detectar/instalar CLI, login, primeiro resultado real | G |
| 10 | Passo "sem skill vs com skill" e skill `guia` para dúvidas | M |

O item 9 substitui o `CliInstallModal` e o `CliSetupBanner` que estão sendo removidos no working tree. Até ele existir, quem abre o app sem CLI só recebe orientação em Configurações.

### Fase 4: contas e o restante

| # | Entrega | Esforço |
|---|---|---|
| 11 | Múltiplas contas por CLI (`CLAUDE_CONFIG_DIR`, `CODEX_HOME` por conta) | G |
| 12 | Painel de limites por janela e failover de conta | G |
| 13 | Cofre com env por workspace e importação do `~/.ssh/config` | M |
| 14 | Squad por descrição, mapa de missões, mais CLIs | M cada |

Fora do plano por enquanto: Jarvis, geração de vídeo, relay móvel, decisor local e o pacote de sites/copy. Dependem de infraestrutura nova ou atendem outro público.

**Decisão de produto antes da Fase 3:** o onboarding deles mira leigos ("Doces da Luzia"). O Codebrain hoje fala com devs. Dá para aproveitar a mecânica (resultado real, detecção, contraste) sem mudar de público.
