# Codebrain × MiMo-Code — Roadmap de Features

> **Status:** Plano de estruturação | **Features já portadas:** 8 | **Novas identificadas:** 25
> **Gerado:** 2026-06-16 | **Fonte:** Auditoria completa de `C:\Users\Maike\Downloads\MiMo-Code-main`

---

## 📊 Panorama Geral

```
┌─────────────────────────────────────────────────────────────────┐
│                   CODEBRAIN FEATURE LANDSCAPE                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ✅ JÁ PORTADAS (8)                                              │
│  ├── FTS5 Memory Search + BM25                                   │
│  ├── Actor Stuck Detection                                       │
│  ├── Repeated-Step Loop Detection (tool calls)                   │
│  ├── Context Pressure Levels                                     │
│  ├── Budgeted File Read                                          │
│  ├── Memory Auto-Pruning                                         │
│  ├── Task Tree Structure                                         │
│  └── Auto-Dream + Auto-Distill                                   │
│                                                                  │
│  🔴 TIER 1 — GAME CHANGERS (4 features)                         │
│  ├── Session Compaction (LLM Summarization)                      │
│  ├── Goal / Stop Condition (Judge Model)                         │
│  ├── Checkpoint Writer + Context Reconstruction                  │
│  └── Max Mode (Best-of-N with Judge)                             │
│                                                                  │
│  🟡 TIER 2 — HIGH VALUE (5 features)                            │
│  ├── LSP Integration (9 semantic operations)                     │
│  ├── History Search (Cross-Session FTS)                          │
│  ├── Checkpoint Validation + Section Budgets                     │
│  ├── Session Revert + Snapshot System                            │
│  └── Text Loop Recovery (Mild + Strong)                          │
│                                                                  │
│  🟢 TIER 3 — MEDIUM VALUE (16 features)                         │
│  ├── Step Classification System                                  │
│  ├── Task Gate (Pre-Stop Validation)                             │
│  ├── Memory Path Guard                                           │
│  ├── Provider-Specific System Prompts                            │
│  ├── Actor Lifecycle (Ephemeral vs Persistent)                   │
│  ├── Actor Return Header Parsing                                 │
│  ├── Subagent Progress Checker                                   │
│  ├── Checkpoint Splitover                                        │
│  ├── Instruction File Hierarchy                                  │
│  ├── Question Tool                                               │
│  ├── Compose Mode (Specs-Driven Dev)                             │
│  ├── Plan Agent Mode                                             │
│  ├── Bus Event System                                            │
│  ├── Multi-Edit Tool                                             │
│  ├── Enhanced Loop Detection (key-order independent)             │
│  └── Actor Orphan Recovery                                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🗺️ Fases de Implementação

### FASE 1 — Foundation: Context & Session Management
**Objetivo:** Resolver o maior gap do Codebrain — sessões longas estouram contexto.

| # | Feature | Complexidade | Impacto | Dependências |
|---|---------|:---:|:---:|---|
| 1.1 | Session Compaction | MÉDIA | 🔴 ALTO | Nenhuma |
| 1.2 | Step Classification | BAIXA | 🟡 MÉDIO | Nenhuma |
| 1.3 | Text Loop Recovery | BAIXA | 🟡 MÉDIO | 1.2 |
| 1.4 | Enhanced Loop Detection | BAIXA | 🟡 MÉDIO | Nenhuma |

**Detalhes:**

#### 1.1 Session Compaction (LLM Summarization)
- **O quê:** Quando o contexto se aproxima do limite, resume automaticamente mensagens antigas via LLM
- **Arquivos MiMo:** `session/compaction.ts`, `agent/prompt/compaction.txt`
- **Arquivos Codebrain:**
  - `packages/mcp/bridge/compaction-handlers.js` (novo)
  - `packages/mcp/index.js` (nova tool: `mcp__codebrain__session_compact`)
  - `electron/main/services/prompts.ts` (lógica de trigger)
  - `prompts/compaction.md` (novo prompt template)
- **Implementação:**
  1. Detectar quando output chars + messages > threshold (usar pressure levels existentes)
  2. Identificar turnos a compactar (proteger últimos N turnos)
  3. Chamar LLM com prompt de compaction para gerar resumo
  4. Substituir mensagens antigas pelo resumo no contexto
  5. Expor tool MCP para trigger manual: `session_compact({ paneId, preserveRecentTurns? })`

#### 1.2 Step Classification System
- **O quê:** Classifica cada step do agente: final/continue/filtered/think-only/invalid/failed
- **Arquivos MiMo:** `session/classify.ts`
- **Arquivos Codebrain:**
  - `packages/mcp/bridge/step-classifier.js` (novo)
  - Integrar na lógica de idle detection do `bridge.js`
- **Implementação:**
  1. Função pura que inspeciona output do agente
  2. Classifica por padrões: tem pending tool call → `continue`, output vazio → `invalid`, erro → `failed`
  3. Usar como input para loop detection e pre-stop gates

#### 1.3 Text Loop Recovery
- **O quê:** Detecta agente repetindo output de texto idêntico (não tool calls)
- **Arquivos MiMo:** `session/prompt/text-loop-recovery.ts`
- **Arquivos Codebrain:**
  - `packages/mcp/bridge/text-loop-recovery.js` (novo)
  - Integrar com `bridge.js` idle handler
- **Implementação:**
  1. Buffer dos últimos 5 outputs normalizados (strip whitespace, lowercase, truncate 200 chars)
  2. Se 3 consecutivos idênticos → mild nudge ("tente uma abordagem diferente")
  3. Se repetir → strong warning ("abandone o plano, pergunte ao usuário")
  4. Max 2 tentativas de recuperação

#### 1.4 Enhanced Loop Detection
- **O quê:** Melhora a detecção existente com `stableStringify` (chaves ordenadas)
- **Arquivos Codebrain:** `packages/memory/store.js` (melhorar `recordStep`)
- **Implementação:**
  1. Aplicar `stableStringify` com chaves recursivamente ordenadas
  2. Assinatura: `"tool:" + toolName + ":" + stableStringify(input)`
  3. Buffer de 3 assinaturas; se todas iguais → loop detectado

---

### FASE 2 — Autonomous Agents: Goals & Quality
**Objetivo:** Tornar agentes autônomos mais confiáveis e de maior qualidade.

| # | Feature | Complexidade | Impacto | Dependências |
|---|---------|:---:|:---:|---|
| 2.1 | Goal / Stop Condition | MÉDIA | 🔴 ALTO | 1.2 |
| 2.2 | Task Gate (Pre-Stop) | BAIXA | 🟡 MÉDIO | Task Tree (✅) |
| 2.3 | Actor Return Header | BAIXA | 🟡 MÉDIO | Nenhuma |
| 2.4 | Actor Lifecycle (Persistent) | BAIXA | 🟡 MÉDIO | Nenhuma |
| 2.5 | Provider-Specific Prompts | BAIXA | 🟡 MÉDIO | Nenhuma |

**Detalhes:**

#### 2.1 Goal / Stop Condition (Judge Model)
- **O quê:** Modelo juiz independente avalia se o objetivo foi atingido antes de parar
- **Arquivos MiMo:** `session/goal.ts`
- **Arquivos Codebrain:**
  - `packages/mcp/bridge/goal-handlers.js` (novo)
  - `packages/mcp/index.js` (novas tools: `goal_set`, `goal_get`, `goal_clear`)
  - `prompts/goal-judge.md` (novo prompt para o juiz)
- **Implementação:**
  1. Tool MCP `goal_set({ paneId, goal })` registra objetivo no pane
  2. Quando agente sinaliza "pronto para parar", chamar juiz
  3. Juiz recebe: goal + transcript → retorna { satisfied: bool, impossible: bool, reason }
  4. Se não satisfeito → inyectar nudge no pane (max 12 re-entries)
  5. Usar LLM diferente do working agent para "visão fria"

#### 2.2 Task Gate (Pre-Stop Validation)
- **O quê:** Antes de parar, verifica tarefas incompletas e nudgeia conclusão
- **Arquivos MiMo:** `task/gate.ts`
- **Arquivos Codebrain:**
  - `packages/memory/store.js` (adicionar `taskTreeGate()` — JÁ EXISTE!)
  - Integrar no run loop do `bridge.js`
- **Implementação:**
  1. `taskTreeGate()` já existe — precisa ser WIRADO no fluxo de pre-stop
  2. Quando agente termina, checar tarefas open/in_progress
  3. Se houver → injetar lembrete (max 3 re-entries para main, 2 para subagent)
  4. Blocked tasks são excluídas (agente genuinamente não pode prosseguir)

#### 2.3 Actor Return Header Parsing
- **O quê:** Parsing estruturado do resultado de subagentes (Status, Summary, Files, Findings)
- **Arquivos MiMo:** `actor/return-header.ts`
- **Arquivos Codebrain:**
  - `packages/mcp/bridge/handoff-parsing.js` (novo)
  - Atualizar `squad-worker.md` com formato de header
- **Implementação:**
  1. Regex que captura: `**Status**: success|partial|failed|blocked`
  2. `**Summary**: <one line>`, `**Files touched**: <paths>`, `**Findings worth promoting**: <bullets>`
  3. Integrar com `handoff_submit` existente como formato alternativo

#### 2.4 Actor Lifecycle (Ephemeral vs Persistent)
- **O quê:** Workers persistentes ficam vivos até falha/cancelamento
- **Arquivos Codebrain:**
  - `packages/mcp/bridge/pane-handlers.js` (adicionar lifecycle field)
  - Actor registry (adicionar `lifecycle` column)
- **Implementação:**
  1. Adicionar campo `lifecycle: "ephemeral" | "persistent"` ao actor registry
  2. Ephemeral = resolve on idle (comportamento atual)
  3. Persistent = resolve only on non-success outcome
  4. `pane_spawn` recebe parâmetro opcional `lifecycle`

#### 2.5 Provider-Specific System Prompts
- **O quê:** Prompts otimizados por família de modelo (Claude, Gemini, GPT, MIMO)
- **Arquivos MiMo:** `session/system.ts`, `session/prompt/*.txt`
- **Arquivos Codebrain:**
  - `electron/main/services/prompts.ts` (seleção baseada no modelo)
  - `prompts/anthropic-specific.md`, `prompts/gemini-specific.md` (novos)
- **Implementação:**
  1. Mapear model ID → família (claude-* → anthropic, gemini-* → google, mimo-* → mimo)
  2. Carregar prompt base + append específico da família
  3. Exemplos: Claude → "use artifacts para código longo", Gemini → "use code execution"

---

### FASE 3 — Context Persistence: Checkpoints & Snapshots
**Objetivo:** Agentes não perdem estado entre sessões ou em crash.

| # | Feature | Complexidade | Impacto | Dependências |
|---|---------|:---:|:---:|---|
| 3.1 | Session Revert + Snapshots | MÉDIA | 🟡 MÉDIO | Nenhuma |
| 3.2 | Checkpoint Writer | ALTA | 🔴 ALTO | 1.1, 2.2 |
| 3.3 | Checkpoint Validation | MÉDIA | 🔴 ALTO | 3.2 |
| 3.4 | Checkpoint Splitover | MÉDIA | 🟡 MÉDIO | 3.2, 3.3 |
| 3.5 | Subagent Progress Checker | BAIXA | 🟡 MÉDIO | 3.2 |
| 3.6 | Memory Path Guard | BAIXA | 🟡 MÉDIO | 3.2 |

**Detalhes:**

#### 3.1 Session Revert + Snapshot System
- **O quê:** Reverte sessão inteira para ponto anterior, desfazendo mudanças de arquivo
- **Arquivos MiMo:** `session/revert.ts`, `snapshot/index.ts`
- **Arquivos Codebrain:**
  - `packages/mcp/bridge/snapshot-handlers.js` (novo)
  - `packages/mcp/index.js` (novas tools: `snapshot_track`, `snapshot_revert`, `snapshot_unrevert`)
  - Diretório: `~/.codebrain/snapshots/<project>/<hash>/`
- **Implementação:**
  1. Git directory separado (não interfere com git do projeto)
  2. `snapshot_track()` → commit do estado atual dos arquivos
  3. `snapshot_revert({ targetMessageId })` → checkout do estado anterior
  4. `snapshot_unrevert()` → re-aplica o revert
  5. Diff computation via `git diff` entre snapshots

#### 3.2 Checkpoint Writer + Context Reconstruction
- **O quê:** Subagente dedicado escreve checkpoint estruturado. Quando contexto se esgota, reconstrói dos arquivos.
- **Arquivos MiMo:** `session/checkpoint.ts`, `agent/prompt/checkpoint-writer.txt`
- **Arquivos Codebrain:**
  - `packages/mcp/bridge/checkpoint-handlers.js` (novo)
  - `packages/mcp/index.js` (novas tools: `checkpoint_write`, `checkpoint_read`, `checkpoint_reconstruct`)
  - `prompts/checkpoint-writer.md` (novo)
  - Diretório: `~/.codebrain/checkpoints/<workspace>/<sessionId>/`
- **Estrutura do checkpoint:**
  ```
  # Checkpoint — [Topic]
  ## Active Intent — o que o agente está tentando fazer
  ## Next Action — próximo passo concreto
  ## Directives — regras e restrições ativas
  ## Task Tree — tarefas pendentes/em progresso
  ## Current Work — o que está sendo feito agora
  ## Files — arquivos relevantes com paths
  ## Discovered Knowledge — fatos aprendidos
  ## Errors — erros encontrados e workarounds
  ## Live Resources — URLs, IDs, endpoints ativos
  ## Design Decisions — decisões tomadas e por quê
  ## Open Notes — observações soltas
  ```
- **Implementação:**
  1. Spawnar checkpoint-writer como subagente com mesmo system prompt prefix
  2. Escrever para: `checkpoint.md`, `MEMORY.md`, `notes.md`, `tasks/<id>/progress.md`
  3. Reconstrução: ler arquivos com token budget, injetar no system prompt
  4. Trigger: quando pressure level >= 2 (high) ou antes de pre-stop

#### 3.3 Checkpoint Validation + Section Budgets
- **O quê:** Valida qualidade do checkpoint após escrita. 13 regras. Over-budget → spillover.
- **Arquivos MiMo:** `checkpoint-validator.ts`, `checkpoint-retry.ts`, `checkpoint-templates.ts`
- **Arquivos Codebrain:**
  - `packages/mcp/bridge/checkpoint-validator.js` (novo)
- **Implementação:**
  1. Validar: seções obrigatórias presentes, ordering correto, sem títulos duplicados
  2. Budgets por seção: Active Intent 500tk, Current Work 2000tk, Files 1500tk, etc.
  3. Total budget: ~8000 tokens
  4. Violações: warn/error/extract-required
  5. Se extract-required → gerar instruções para o writer split
  6. Se falha persistente → renomear para `checkpoint.invalid.md` (quarantine)

#### 3.4 Checkpoint Splitover
- **O quê:** Divide checkpoints over-budget em arquivos spillover
- **Implementação:** Extrair conteúdo menos importante primeiro (decisões estáveis, dead ends, steps históricos)

#### 3.5 Subagent Progress Checker
- **O quê:** Valida que subagente documentou trabalho antes de permitir término
- **Implementação:** Hook em `actor.postStop` → verificar seções obrigatórias no progress file

#### 3.6 Memory Path Guard
- **O quê:** Valida paths de escrita contra escopos permitidos
- **Implementação:** Pure function que valida componentes do path contra regras de escopo

---

### FASE 4 — Code Intelligence: LSP & History
**Objetivo:** Agentes navegam código semanticamente e buscam histórico.

| # | Feature | Complexidade | Impacto | Dependências |
|---|---------|:---:|:---:|---|
| 4.1 | LSP Integration | ALTA | 🔴 ALTO | Nenhuma |
| 4.2 | History Search (Cross-Session) | MÉDIA | 🔴 ALTO | FTS5 (✅) |
| 4.3 | Instruction File Hierarchy | BAIXA | 🟡 MÉDIO | Nenhuma |

**Detalhes:**

#### 4.1 LSP Integration (9 Operations)
- **O quê:** Language Server Protocol para navegação semântica de código
- **Arquivos MiMo:** `lsp/`, `tool/lsp.ts`
- **Arquivos Codebrain:**
  - `packages/mcp/bridge/lsp-handlers.js` (novo)
  - `packages/mcp/index.js` (nova tool group: `lsp` com 9 operations)
  - LSP server management em `electron/main/services/`
- **Operations:**
  1. `lsp_go_to_definition` — ir para definição
  2. `lsp_find_references` — encontrar todas referências
  3. `lsp_hover` — ver tipo/docs de símbolo
  4. `lsp_document_symbol` — outline do arquivo
  5. `lsp_workspace_symbol` — buscar símbolo no workspace
  6. `lsp_go_to_implementation` — ir para implementação
  7. `lsp_prepare_call_hierarchy` — hierarquia de chamadas
  8. `lsp_incoming_calls` — quem chama esta função
  9. `lsp_outgoing_calls` — o que esta função chama
- **Implementação:**
  1. Detectar LSP servers disponíveis (typescript-language-server, pyright, etc.)
  2. Gerenciar lifecycle do server (start/stop/document sync)
  3. Tool group lazy-loaded (como browser/fetch)
  4. Validar existência do arquivo antes de operar

#### 4.2 History Search (Cross-Session FTS)
- **O quê:** Busca FTS5 em TODAS as conversas históricas com filtros avançados
- **Arquivos MiMo:** `history/service.ts`, `tool/history.ts`
- **Arquivos Codebrain:**
  - `packages/memory/store.js` (nova tabela `history_fts`)
  - `packages/mcp/bridge/history-handlers.js` (novo)
  - `packages/mcp/index.js` (nova tool: `history_search`)
- **Implementação:**
  1. Tabela `session_messages` (session_id, role, content, kind, tool_name, timestamp)
  2. FTS5 virtual table `history_fts` com triggers de sync
  3. Filters: scope (project/global), session, kind, tool_name, time_range
  4. Operation `around`: mensagens antes/depois de message_id com contexto
  5. Indexação assíncrona (writer service dedicado)

#### 4.3 Instruction File Hierarchy
- **O quê:** Busca hierárquica de AGENTS.md/CLAUDE.md subindo diretórios
- **Implementação:**
  1. `findUp` a partir do arquivo sendo lido
  2. Global: `~/.codebrain/AGENTS.md`
  3. Project: `<workspace>/AGENTS.md`
  4. Per-directory: qualquer `AGENTS.md` no caminho
  5. Remote: fetch de URLs HTTP/HTTPS (timeout 5s)
  6. Deduplicação por message ID

---

### FASE 5 — Advanced: Workflows & Max Mode
**Objetivo:** Capacidades avançadas para tarefas complexas.

| # | Feature | Complexidade | Impacto | Dependências |
|---|---------|:---:|:---:|---|
| 5.1 | Max Mode (Best-of-N) | ALTA | 🔴 ALTO | 2.1 |
| 5.2 | Question Tool | BAIXA | 🟡 MÉDIO | Nenhuma |
| 5.3 | Compose Mode | MÉDIA | 🟡 MÉDIO | Skills system |
| 5.4 | Plan Agent Mode | BAIXA | 🟡 MÉDIO | Nenhuma |
| 5.5 | Multi-Edit Tool | BAIXA | 🟢 BAIXO | Nenhuma |

**Detalhes:**

#### 5.1 Max Mode (Best-of-N)
- **O quê:** Roda N candidatos em paralelo (propose-only), juiz seleciona o melhor
- **Arquivos MiMo:** `session/max-mode.ts`, `session/processor.ts`
- **Arquivos Codebrain:**
  - `packages/mcp/bridge/max-mode-handlers.js` (novo)
  - `packages/mcp/index.js` (nova tool: `max_mode_run`)
- **Implementação:**
  1. Tool `max_mode_run({ prompt, candidates?, judgeModel? })`
  2. Spawnar N panes em paralelo com propose-only mode (tools sem execute)
  3. Coletar candidatos (reasoning + text + proposed tool calls)
  4. Chamar juiz para selecionar o melhor
  5. Executar tool calls do vencedor
  6. Default: 5 candidatos, juiz usa mesmo modelo ou mais capaz

#### 5.2 Question Tool
- **O quê:** Agente faz perguntas estruturadas ao usuário com opções pré-definidas
- **Implementação:** Tool MCP `question_ask({ question, options[], allowCustom? })` → IPC → UI renderiza → resposta volta ao agente

#### 5.3 Compose Mode
- **O quê:** Workflow specs-driven: planejar → executar → code review → TDD → debug → verificar → merge
- **Implementação:** Skill template com fases estruturadas

#### 5.4 Plan Agent Mode
- **O quê:** Agente read-only para exploração de código. Não edita arquivos.
- **Implementação:** Novo agente com permission deny em edit/write, prompt de planejamento

#### 5.5 Multi-Edit Tool
- **O quê:** Batch de múltiplas edições em um arquivo em uma chamada
- **Implementação:** Wrapper do edit tool existente com array de operações

---

### FASE 6 — Polish: Orchestration & Observability
**Objetivo:** Melhorias de infraestrutura e UX.

| # | Feature | Complexidade | Impacto | Dependências |
|---|---------|:---:|:---:|---|
| 6.1 | Bus Event System | BAIXA | 🟡 MÉDIO | Nenhuma |
| 6.2 | Actor Orphan Recovery | BAIXA | 🟡 MÉDIO | Nenhuma |
| 6.3 | Session Summary + Diffs | BAIXA | 🟢 BAIXO | 3.1 |

---

## 📐 Arquitetura — Diagrama de Dependências

```
FASE 1 (Foundation)          FASE 2 (Autonomous)
┌──────────────────┐         ┌──────────────────┐
│ 1.1 Compaction   │────────▶│ 3.2 Checkpoint   │
│ 1.2 Step Classif │────────▶│ 2.1 Goal/Judge   │
│ 1.3 Text Loop    │         │ 2.2 Task Gate    │
│ 1.4 Loop Detect↑ │         │ 2.3 Return Header│
└──────────────────┘         │ 2.4 Persistent   │
                             │ 2.5 Provider Prompts│
                             └──────────────────┘
                                      │
FASE 3 (Persistence)                  ▼
┌──────────────────┐         ┌──────────────────┐
│ 3.1 Snapshots    │         │ 5.1 Max Mode     │
│ 3.2 Checkpoint W │◀────────│ 5.2 Question Tool│
│ 3.3 Validation   │         │ 5.3 Compose Mode │
│ 3.4 Splitover    │         │ 5.4 Plan Agent   │
│ 3.5 Progress Check│        │ 5.5 Multi-Edit   │
│ 3.6 Path Guard   │         └──────────────────┘
└──────────────────┘
                             FASE 6 (Polish)
FASE 4 (Intelligence)        ┌──────────────────┐
┌──────────────────┐         │ 6.1 Bus Events   │
│ 4.1 LSP (9 ops)  │         │ 6.2 Orphan Recov │
│ 4.2 History FTS  │         │ 6.3 Session Diffs│
│ 4.3 Instruct Hier│         └──────────────────┘
└──────────────────┘
```

---

## 🎯 Estimativas por Fase

| Fase | Features | Complexidade Total | Tempo Estimado | Impacto |
|------|:---:|:---:|:---:|:---:|
| Fase 1 — Foundation | 4 | MÉDIA | 2-3 dias | 🔴 Resolve sessões longas |
| Fase 2 — Autonomous | 5 | MÉDIA | 2-3 dias | 🔴 Agentes mais confiáveis |
| Fase 3 — Persistence | 6 | ALTA | 4-5 dias | 🔴 Nunca mais perder estado |
| Fase 4 — Intelligence | 3 | ALTA | 3-4 dias | 🔴 Navegação semântica |
| Fase 5 — Advanced | 5 | ALTA | 3-4 dias | 🟡 Qualidade de ponta |
| Fase 6 — Polish | 3 | BAIXA | 1-2 dias | 🟡 Infraestrutura |
| **TOTAL** | **26** | — | **15-21 dias** | — |

---

## 🏗️ Padrão de Implementação por Feature

Cada feature segue o padrão 3 camadas do Codebrain:

```
1. Bridge Handler  →  packages/mcp/bridge/<name>-handlers.js
   │ Factory function create<Name>Handlers(opts)
   │ Retorna objeto com métodos async
   │ Sempre: { ok: boolean, data?, error? }
   │
2. Tool Registration  →  packages/mcp/index.js
   │ server.tool("mcp__codebrain__<name>", description, zodSchema, handler)
   │ Error handling com isError: true
   │
3. Bridge Wiring  →  packages/mcp/bridge.js
   │ Import create<Name>Handlers
   │ Compor no objeto bridge
   │ Passar dependências do main process
   │
4. (Opcional) Prompt Template  →  prompts/<name>.md
   │ Template para LLM calls internas
   │
5. (Opcional) SQLite Schema  →  packages/memory/store.js
   │ CREATE TABLE / CREATE INDEX
   │ Migration-safe (IF NOT EXISTS)
```

---

## ⚡ Quick Wins (Implementar HOJE)

Estas features são **BAIXA complexidade + MÉDIO impacto** — podem ser feitas em 1-2 horas cada:

1. **Text Loop Recovery** — ~50 linhas, novo arquivo `text-loop-recovery.js`
2. **Enhanced Loop Detection** — ~20 linhas, melhorar `recordStep` existente
3. **Task Gate Wiring** — ~30 linhas, `taskTreeGate()` já existe, só precisa ser chamado
4. **Step Classification** — ~40 linhas, função pura sem dependências
5. **Actor Orphan Recovery** — ~15 linhas, UPDATE no boot do actor registry
6. **Provider-Specific Prompts** — ~30 linhas, modelo→família→prompt template
7. **Multi-Edit Tool** — ~25 linhas, wrapper do edit existente
8. **Actor Return Header** — ~60 linhas, regex parsing + integração com handoff

---

## 📋 Checklist de Tracking

### Fase 1 — Foundation
- [ ] 1.1 Session Compaction
- [ ] 1.2 Step Classification
- [ ] 1.3 Text Loop Recovery
- [ ] 1.4 Enhanced Loop Detection

### Fase 2 — Autonomous
- [ ] 2.1 Goal / Stop Condition
- [ ] 2.2 Task Gate Wiring
- [ ] 2.3 Actor Return Header
- [ ] 2.4 Actor Lifecycle (Persistent)
- [ ] 2.5 Provider-Specific Prompts

### Fase 3 — Persistence
- [ ] 3.1 Session Revert + Snapshots
- [ ] 3.2 Checkpoint Writer
- [ ] 3.3 Checkpoint Validation
- [ ] 3.4 Checkpoint Splitover
- [ ] 3.5 Subagent Progress Checker
- [ ] 3.6 Memory Path Guard

### Fase 4 — Intelligence
- [ ] 4.1 LSP Integration (9 ops)
- [ ] 4.2 History Search (Cross-Session)
- [ ] 4.3 Instruction File Hierarchy

### Fase 5 — Advanced
- [ ] 5.1 Max Mode (Best-of-N)
- [ ] 5.2 Question Tool
- [ ] 5.3 Compose Mode
- [ ] 5.4 Plan Agent Mode
- [ ] 5.5 Multi-Edit Tool

### Fase 6 — Polish
- [ ] 6.1 Bus Event System
- [ ] 6.2 Actor Orphan Recovery
- [ ] 6.3 Session Summary + Diffs

---

> **Nota:** Este roadmap é vivo. Features podem ser re-priorizadas conforme necessidades do projeto.
> Cada fase é independente o suficiente para ser implementada em qualquer ordem, exceto onde há dependências explícitas.
