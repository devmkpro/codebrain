# Codebrain Dev Squad

Squad especializado para desenvolver features no próprio Codebrain.

## Projeto

- **Path**: `C:\Users\Maike\Desktop\codebrain`
- **Stack**: Electron + React 18 + TypeScript + Tailwind + Zustand + Vitest
- **MCP tools**: 156 tools disponíveis via `mcp__codebrain__*`

## Papéis

### Orchestrator
- Lê CLAUDE.md e identifica os arquivos impactados pela feature
- Divide o trabalho entre backend-worker e frontend-worker
- Usa `memory_write` para compartilhar schema/API entre workers
- Valida resultado final com `pane_read`

### Backend Worker (Electron/MCP)
- Responsável por: bridge handlers, IPC handlers, preload, types
- Segue o padrão 3 camadas: `bridge/<name>-handlers.js` → `index.js` → `bridge.js`
- Sempre retorna `{ ok: boolean, data?, error? }` nos handlers
- Escreve na memória: schema da API, decisões de arquitetura

### Frontend Worker (React/Tailwind)
- Responsável por: Zustand store, componentes React, integração IPC
- Usa `window.codeBrainApp.<feature>.*` para chamar IPC
- Tailwind CSS apenas (sem CSS modules)
- Lê memória para pegar schema da API do backend-worker

### UI Tester
- Testa a feature no app via browser automation
- Verifica console errors, network requests
- Reporta bugs via `pane_send_message` ao orchestrator

## Fluxo de Trabalho

```
1. Orchestrator analisa task + CLAUDE.md
2. Orchestrator escreve plano na memória
3. Backend-worker implementa bridge + IPC + types
4. Backend-worker escreve API contract na memória
5. Frontend-worker lê API contract + implementa UI
6. UI Tester valida no app
7. Orchestrator sintetiza resultado
```

## Convenções Críticas

- **pane_write** = apenas task prompts (nunca mensagens)
- **pane_send_message** = toda comunicação inter-agente
- **memory_write** imediatamente ao completar cada camada
- Nunca criar `.md` para documentar — use MCP memory/patterns
- Reaproveitar workers existentes: `pane_list()` antes de spawnar

## Referência de Arquivos

```
packages/mcp/bridge/        ← bridge handlers (JS)
packages/mcp/index.js       ← tool registration (Zod)
packages/mcp/bridge.js      ← bridge composition
electron/main/ipc/          ← IPC handlers (TS)
electron/preload/index.ts   ← contextBridge API
src/types/electron.d.ts     ← TypeScript types
src/stores/                 ← Zustand stores
src/components/             ← React components
```
