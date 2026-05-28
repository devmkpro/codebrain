# CodeBrain Cloud — Plano de Arquitetura

> Sistema profissional de review autonomo de codigo rodando 24/7 em VPS
> com painel de controle Laravel/React

---

## Estado Atual

O pipeline ja funciona localmente:

```
GitLab MR webhook → MCP server → review agent (hidden) → JSON findings → inline comments
```

**Componentes prontos:**
- `packages/mcp/server.js` — HTTP server com webhook endpoint
- `packages/mcp/bridge.js` — compoe 16 handler modules (standalone, sem Electron)
- `packages/mcp/bridge/review-run.js` — spawn agent, analisa diff, posta findings
- `packages/mcp/bridge/git-handlers.js` — 13 ferramentas GitLab
- `packages/mcp/bridge/background-workers.js` — polling worker (2min)
- `packages/mcp/bridge/review-config.js` — config por repo
- `packages/memory/store.js` — SQLite memory store

**Gaps identificados:**
| Gap | Atual | Necessario |
|-----|-------|------------|
| Bind address | `127.0.0.1` | `0.0.0.0` atras de nginx |
| Tokens | unico PAT | multi-tenant por projeto (SQLite + AES-256) |
| Execucao | fire-and-forget | fila duravel com retry + backoff |
| PTY Manager | Electron `pty-manager.ts` | standalone com `node-pty` |
| Browser | Electron BrowserView | Playwright headless |
| Webhook auth | plain token comparison | HMAC-SHA256 |
| Processo | dev.bat | systemd / Docker |
| Painel | Settings page basica | Laravel + React completo |

---

## Arquitetura

```
                        Internet
                           │
                    ┌──────┴──────┐
                    │   Nginx     │
                    │  SSL/443    │
                    └──┬──────┬──┘
                       │      │
            /api/webhooks/    /*
                │              │
        ┌───────┴───────┐  ┌──┴──────────────┐
        │ Agent Service  │  │ Control Panel    │
        │ (Node.js)      │  │ (Laravel+React)  │
        │ port 3100      │  │ port 8000        │
        │                │  │                  │
        │ ┌────────────┐ │  │ ┌──────────────┐│
        │ │ MCP Server  │ │  │ │ API (Sanctum)││
        │ │ 172 tools   │ │  │ │ Projects     ││
        │ ├────────────┤ │  │ │ Reviews      ││
        │ │ Review Queue│ │  │ │ Tokens       ││
        │ │ SQLite      │ │  │ │ Suggestions  ││
        │ ├────────────┤ │  │ ├──────────────┤│
        │ │ Headless PTY│ │  │ │ GitLab OAuth ││
        │ │ node-pty    │ │  │ │ Webhooks     ││
        │ ├────────────┤ │  │ │ Auto-MR      ││
        │ │ Playwright  │ │  │ └──────────────┘│
        │ └────────────┘ │  └─────────────────┘
        └────────────────┘
```

---

## Parte A — Agent Service (Node.js)

Novo diretorio: `packages/agent/`

### Arquivos

```
packages/agent/
  package.json
  config.js              # Config baseada em env vars
  bootstrap.js           # Inicializa subsistemas (substitui electron/main/services/mcp.ts)
  headless-pty.js        # PTY manager standalone (substitui electron/main/pty-manager.ts)
  headless-browser.js    # Playwright (substitui Electron BrowserView)
  token-manager.js       # Multi-tenant GitLab tokens
  review-queue.js        # Fila SQLite com retry
  server.js              # Entry point HTTP
  Dockerfile
```

### bootstrap.js

Cria o `opts` que `bridge.js` espera, sem Electron:

```javascript
const opts = {
  memoryStore,                    // packages/memory/store.js
  getCurrentWorkspacePath: () => config.workspacePath,
  spawnPaneFn: headlessPty.spawn,
  tokenManager,                   // resolve token por projeto
  reviewQueue,                    // fila duravel
  hooksManager,
  dataDir: config.dataDir,
  bindAddress: config.host,
};
const bridge = createMCPBridge(ptyManager, opts);
startMCPServer(ptyManager, opts);
```

**Zero mudancas em bridge.js ou index.js** — apenas implementacoes diferentes das mesmas interfaces.

### headless-pty.js

Copia `OutputBuffer` e `IdleDetector` de `electron/main/` (logica pura, sem Electron).

Interface (EventEmitter):
- `spawn(config)` → paneId
- `write(paneId, data)` / `writeSilent(paneId, data)`
- `read(paneId, lastN)` → string[]
- `kill(paneId)` / `hasPane(paneId)` / `list()`
- Eventos: `"output"`, `"exit"`, `"idle"`

### token-manager.js

```sql
CREATE TABLE gitlab_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT,
  project_id   TEXT,           -- null = token global
  host         TEXT DEFAULT 'https://gitlab.com',
  token_enc    TEXT NOT NULL,  -- AES-256-GCM
  token_iv     TEXT NOT NULL,
  token_tag    TEXT NOT NULL,
  created_at   INTEGER DEFAULT (unixepoch())
);
```

Resolucao: project_id → global → env var (fallback)

### review-queue.js

```sql
CREATE TABLE review_queue (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,
  mr_id        INTEGER NOT NULL,
  source       TEXT DEFAULT 'webhook',
  status       TEXT DEFAULT 'pending',
  priority     INTEGER DEFAULT 5,
  attempts     INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  last_error   TEXT,
  result       TEXT,
  created_at   INTEGER DEFAULT (unixepoch()),
  next_retry   INTEGER
);
```

- Poll a cada 5s
- Max 2 reviews concorrentes
- Backoff exponencial: `2^attempts * 30s`

### config.js (env vars)

```bash
CODEBRAIN_HOST=0.0.0.0
CODEBRAIN_PORT=3100
GITLAB_URL=https://gitlab.com
GITLAB_TOKEN=glpat-xxx           # token default/fallback
GITLAB_WEBHOOK_SECRET=xxx
CODEBRAIN_ENCRYPTION_KEY=64hex   # 32 bytes AES-256
CODEBRAIN_DATA_DIR=/opt/codebrain/data
REVIEW_MODEL=gemini-3.1-pro-preview
REVIEW_CONCURRENCY=2
CONTROL_PANEL_URL=http://panel:8000
CONTROL_PANEL_API_KEY=xxx
```

---

## Parte B — Control Panel (Laravel)

Novo diretorio: `control-panel/`

### Database Schema

**users**
```sql
id, name, email, gitlab_id, gitlab_username, gitlab_token (encrypted),
role (admin/user), created_at, updated_at
```

**projects**
```sql
id, user_id → users, gitlab_project_id (UNIQUE), name, namespace, web_url,
default_branch, settings (JSON: skipDraft, autoFix, branches),
webhook_id, is_active, last_reviewed_at
```

**reviews**
```sql
id, project_id → projects, mr_id, mr_title, mr_author, mr_url,
source_branch, target_branch, status (queued/processing/completed/failed),
source (webhook/polling/manual), model_used, findings_count,
comments_posted, comments_failed, raw_output, error_message, cost_usd,
started_at, completed_at
```

**findings**
```sql
id, review_id → reviews (CASCADE), file_path, line_number,
severity (critical/high/medium/low/info), category, description,
suggestion, comment_id, comment_posted
```

**feature_suggestions**
```sql
id, project_id → projects, title, description, rationale,
estimated_effort (small/medium/large), category, source_files (JSON),
status (pending/approved/rejected/implemented), mr_url,
reviewed_by → users, reviewed_at
```

**agent_configs**
```sql
id, key (UNIQUE), value (JSON), description
```

### API Routes

**Agent → Panel** (API key auth):
```
POST   /api/agent/reviews              # Agent reporta resultado
POST   /api/agent/findings             # Agent reporta findings
GET    /api/agent/projects/{id}/token  # Agent pega token
GET    /api/agent/config               # Agent pega configs
GET    /api/agent/queue/next           # Agent polla trabalho
```

**User → Panel** (Sanctum + GitLab OAuth):
```
GET    /api/dashboard/stats
GET    /api/projects
POST   /api/projects                   # Add repo → auto-registra webhook
GET    /api/reviews
GET    /api/reviews/{id}/findings
GET    /api/feature-suggestions
PUT    /api/feature-suggestions/{id}/approve
POST   /api/feature-suggestions/{id}/create-mr
GET    /api/agent-config
PUT    /api/agent-config/{key}
```

### GitLab OAuth Flow

1. Frontend → `/api/auth/gitlab/redirect`
2. Laravel gera URL OAuth (scope: `read_api`)
3. GitLab callback → troca code por token → armazena encrypted
4. Token usado pra: listar repos, registrar webhooks, criar MRs

### Webhook Auto-Registration

Quando usuario adiciona projeto no painel, `WebhookService` registra automaticamente:
```
POST https://gitlab.com/api/v4/projects/{id}/hooks
  url: https://<vps>/api/webhooks/gitlab
  token: <secret>
  merge_requests_events: true
  push_events: false
```

---

## Parte C — Frontend (React)

Novo diretorio: `control-panel/frontend/` (Vite + React + Tailwind)

### Paginas

**Dashboard**
- 4 stat cards: Total Reviews, Total Findings, Critical, Success Rate
- Grafico: findings por severity (30 dias)
- Timeline: reviews por dia
- Tabela: ultimos 10 reviews

**Projects**
- Grid de repos registrados
- Status webhook, ultima review
- "Add Project" com seletor do GitLab
- Detail: config, historico, trigger manual, trigger feature analysis

**Reviews**
- Tabela filtravel (projeto, status, data)
- Detail: MR info + findings inline no codigo

**Feature Suggestions**
- Cards com sugestoes do agent
- Botoes: Approve / Reject / Create MR
- Filtro por status

**Settings**
- Agent config (modelo, max comments, auto-fix)
- Token manager (add/remove, per-project ou global)
- API key management

---

## Parte D — Infraestrutura VPS

### Docker Compose

```yaml
services:
  agent:        # Node.js — port 3100 (interno)
  panel:        # Laravel — port 8000 (interno)
  nginx:        # Reverse proxy — port 443 (externo)
  certbot:      # Let's Encrypt SSL
```

### Nginx

```
/api/webhooks/gitlab → agent     (rate limit 10r/s)
/api/internal/*      → agent     (so Docker network)
/*                   → panel
SSL: Let's Encrypt
```

### systemd (alternativa a Docker)

```ini
# /etc/systemd/system/codebrain-agent.service
ExecStart=/usr/bin/node packages/agent/bootstrap.js
Restart=always
RestartSec=5
EnvironmentFile=/opt/codebrain/.env
```

---

## Parte E — Fluxos de Dados

### Review via Webhook

```
GitLab MR aberto/atualizado
  → POST /api/webhooks/gitlab
  → Insere na review_queue
  → Retorna 200 OK

Queue worker (5s):
  → Pega proximo pending
  → reviewRun()
    → gitlabGetMr() via TokenManager
    → Build custom system prompt file (review instructions + diff + MR context)
    → Spawn hidden agent com systemPromptFile (bypasses codebrain-system.md)
    → Agent analisa diff e chama mcp__codebrain__gitlab_comment_mr via MCP
    → OBRIGATÓRIO: kill(paneId) após conclusão — fecha o terminal
  → Salva review + findings no SQLite
  → POST /api/agent/reviews no painel
```

### Pane Lifecycle — OBRIGATÓRIO

**Toda review agent pane DEVE ser finalizado após conclusão.** O fluxo é:

1. `spawnPane({ hidden: true, systemPromptFile })` — cria pane oculto
2. `writePane()` + `waitPaneIdle()` — executa review
3. `readPane()` — le output para logging
4. **`ptyManager.kill(paneId)` — OBRIGATÓRIO: fecha o terminal**
5. Limpar `roleMap` e `paneLabels`

**Sem o kill(), panes ficam abertos indefinidamente** — consumo de memória e processos acumulam. Em produção (VPS), isso causa OOM após dezenas de webhooks.

O mesmo padrão se aplica a qualquer agent spawnado para tarefa pontual:
- Feature suggestion agent
- Auto-MR agent
- Qualquer agent hidden

### Feature Suggestion

```
Usuario clica "Analyze" no painel
  → POST /api/projects/{id}/analyze-features
  → Agent le arquivos do projeto via gitlabGetFile()
  → Analisa arquitetura, dependencias, features existentes
  → LLM sugere features estruturadas
  → Salva em feature_suggestions
  → Usuario ve, aprova/rejeita, pode criar MR
```

### Auto-MR

```
Usuario aprova sugestao → clica "Create MR"
  → Agent clona repo
  → Cria branch: feature/suggestion-{id}
  → Implementa feature via LLM agent
  → Commit + push
  → Cria MR via gitlabCreateMr()
  → Atualiza suggestion com mr_url
```

---

## Fases de Implementacao

### Fase 1 — Agent Standalone (Semana 1-2)
- `packages/agent/package.json`
- `packages/agent/config.js`
- `packages/agent/headless-pty.js`
- `packages/agent/bootstrap.js`
- `packages/agent/server.js`
- Modificar `packages/mcp/server.js`: bind address configuravel
- Testar: agent roda standalone, review funciona

### Fase 2 — Tokens + Fila (Semana 2-3)
- `packages/agent/token-manager.js`
- `packages/agent/review-queue.js`
- Modificar `git-handlers.js`: getApi() aceita projectId
- Modificar webhook handler: enqueue em vez de fire-and-forget
- Modificar polling worker: enqueue
- Testar: multiplos projetos, tokens diferentes

### Fase 3 — Control Panel Backend (Semana 3-4)
- Scaffold Laravel + migrations
- GitLab OAuth
- Projects CRUD + webhook auto-registration
- Review + Finding storage
- Dashboard stats
- Testar: adicionar projeto → webhook → review aparece

### Fase 4 — Control Panel Frontend (Semana 4-5)
- Scaffold React + Vite + Tailwind
- Auth flow, Dashboard, Projects, Reviews, Settings
- Testar: fluxo completo UI → review → findings

### Fase 5 — Features Avancadas (Semana 5-6)
- Feature Suggestion Service + prompt
- Auto-MR creation
- Playwright browser
- Docker Compose + nginx + SSL
- Deploy VPS

### Fase 6 — Hardening (Semana 6+)
- Rate limiting, monitoring, backup SQLite
- Alertas de custo, multi-user permissions

---

## Modificacoes no Codigo Existente

Apenas **3 arquivos** (backward-compatible):

| Arquivo | Mudanca |
|---------|---------|
| `packages/mcp/server.js` | bind address `opts.bindAddress` |
| `packages/mcp/bridge/git-handlers.js` | `getApi()` aceita projectId, delega pra tokenManager |
| `packages/mcp/bridge/background-workers.js` | enqueue em vez de fire-and-forget |

Tudo mais e codigo novo.

---

## Verificacao End-to-End

1. `docker-compose up` no VPS
2. Login no painel via GitLab OAuth
3. Adicionar projeto → webhook auto-registra
4. Criar MR no GitLab → webhook → review → findings inline
5. Dashboard mostra stats
6. Feature analysis → sugestoes → approve → MR criado
