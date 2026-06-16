# Debug Pane / Agent — Codebrain

Use esta skill quando um pane ou agente parece travado, silencioso ou com comportamento inesperado.

## Diagnóstico Passo a Passo

### 1. Listar todos os panes ativos

```
mcp__codebrain__pane_list()
```

Verifique: `status`, `label`, `hasAgent`, `isOrchestrator`

### 2. Ler output do pane suspeito

```
mcp__codebrain__pane_read({ paneId: "<id>", lastN: 100 })
```

Procure por: erros, prompts aguardando input, loops, rate limits

### 3. Verificar mensagens não lidas

```
mcp__codebrain__pane_read_messages({ paneId: "<id>", unreadOnly: true })
```

Se houver mensagens presas, o agente pode estar bloqueado esperando processá-las.

### 4. Saúde do worker no swarm

```
mcp__codebrain__swarm_worker_health({ paneId: "<id>" })
```

### 5. Verificar console de erros do browser (se for UI tester)

```
mcp__codebrain__browser_console_log({ level: "error", since_ms: 60000 })
```

### 6. Ver hooks recentes

```
mcp__codebrain__hooks_log({ limit: 20 })
```

Verifique se houve `pane_exited` inesperado.

## Ações Corretivas

| Sintoma | Ação |
|---------|------|
| Pane exited inesperadamente | `mcp__codebrain__swarm_respawn({ paneId })` |
| Agente em loop | `mcp__codebrain__pane_write({ paneId, text: "stop\n" })` |
| Mensagens empilhadas | Ler e processar manualmente via `pane_send_message` |
| Rate limit | Aguardar 60s, depois `pane_write` novo prompt |
| Pane sem output há >5min | Respawn ou kill + novo spawn |

## Respawn de Worker

```
mcp__codebrain__swarm_respawn({ paneId: "<id_travado>" })
```

Isso cria novo pane com mesma configuração do original.

## Diagnóstico de Memória

Se o agente parece "esquecido" do contexto:

```
mcp__codebrain__memory_search({ query: "last task completed" })
mcp__codebrain__memory_search({ query: "error api schema" })
```

## Verificar Provider/Modelo

Se suspeitar de erro de provider:

```
mcp__codebrain__provider_health()
```

Verifique `errorRate` — se >10%, o provider está degradado.
