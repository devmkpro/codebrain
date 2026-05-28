# GitLab MCP Tools — Documentacao Completa

> 15 tools para operacoes GitLab, git local, e revisao autonoma de MRs.

---

## Setup

### 1. Token de Acesso

Crie um **Personal Access Token** no GitLab:

1. GitLab → seu avatar → **Settings** → **Access Tokens**
2. Nome: `codebrain-mcp`
3. Scopes: marque **`api`**
4. Expiration: escolha a data
5. Copie o token (`glpat-xxxx`)

### 2. Variavel de Ambiente

**Windows (PowerShell — sessao atual):**
```powershell
$env:GITLAB_TOKEN="glpat-seu-token-aqui"
```

**Windows (permanente):**
```powershell
[System.Environment]::SetEnvironmentVariable("GITLAB_TOKEN", "glpat-seu-token-aqui", "User")
# Abra um NOVO terminal depois disso
```

**Linux/Mac:**
```bash
export GITLAB_TOKEN="glpat-seu-token-aqui"
# Para persistir: adicione ao ~/.bashrc ou ~/.zshrc
```

### 3. Variaveis Opcionais

| Variavel | Default | Descricao |
|----------|---------|-----------|
| `GITLAB_TOKEN` | (obrigatorio) | Personal Access Token com scope `api` |
| `GITLAB_URL` | `https://gitlab.com` | URL da instancia GitLab (self-hosted) |
| `GITLAB_PROJECT_ID` | (nenhum) | Project ID padrao (pode ser override por chamada) |

### 4. Reiniciar o Codebrain

O MCP server carrega o codigo novo so no restart. Apos reiniciar, os 15 tools estarao disponiveis.

---

## GitLab API Tools (8 tools)

### `gitlab_list_mrs`

Lista MRs de um projeto GitLab.

**Parametros:**

| Param | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `projectId` | string | Nao | Project ID (default: `GITLAB_PROJECT_ID` env) |
| `state` | string | Nao | `opened`, `closed`, `merged`, `all` (default: `opened`) |
| `labels` | string[] | Nao | Filtrar por labels |

**Exemplo:**
```
gitlab_list_mrs projectId="82138843" state="opened"
```

**Resposta:**
```json
{
  "ok": true,
  "data": [
    {
      "id": 42,
      "title": "feat: add dark mode",
      "author": "maike",
      "state": "opened",
      "sourceBranch": "feature/dark-mode",
      "targetBranch": "main",
      "createdAt": "2026-05-27T10:00:00Z",
      "updatedAt": "2026-05-27T12:00:00Z",
      "labels": ["feature"],
      "draft": false,
      "webUrl": "https://gitlab.com/...",
      "description": "..."
    }
  ]
}
```

---

### `gitlab_get_mr`

Obtem detalhes completos de um MR incluindo diff parseado com hunks por arquivo/linha.

**Parametros:**

| Param | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `projectId` | string | Nao | Project ID |
| `mrId` | number | **Sim** | MR IID (numero local, nao o ID global) |

**Exemplo:**
```
gitlab_get_mr projectId="82138843" mrId=42
```

**Resposta (estrutura do diff):**
```json
{
  "ok": true,
  "data": {
    "id": 42,
    "title": "feat: add dark mode",
    "author": "maike",
    "state": "opened",
    "sourceBranch": "feature/dark-mode",
    "targetBranch": "main",
    "sha": "abc123...",
    "diffRefs": {
      "base_sha": "...",
      "start_sha": "...",
      "head_sha": "..."
    },
    "filesChanged": 3,
    "files": [
      {
        "oldPath": "src/App.tsx",
        "newPath": "src/App.tsx",
        "newFile": false,
        "renamedFile": false,
        "deletedFile": false,
        "diff": "@@ -10,6 +10,8 @@ ...",
        "hunks": [
          {
            "oldStart": 10,
            "oldLines": 6,
            "newStart": 10,
            "newLines": 8,
            "content": [
              { "type": "add", "line": 12, "content": "+  const [dark, setDark] = useState(false);" },
              { "type": "del", "line": 11, "content": "-  // TODO: theme" }
            ]
          }
        ]
      }
    ]
  }
}
```

**Uso para review:**
O campo `hunks[].content` mostra exatamente quais linhas foram adicionadas/removidas, com o numero da linha. Use isso para postar inline comments.

---

### `gitlab_comment_mr`

Posta um comentario num MR. Pode ser comentario geral ou inline (em linha especifica).

**Parametros:**

| Param | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `projectId` | string | Nao | Project ID |
| `mrId` | number | **Sim** | MR IID |
| `body` | string | **Sim** | Corpo do comentario (markdown) |
| `position` | object | Nao | Para inline: `{ new_path, new_line }` |

**Exemplo — comentario geral:**
```
gitlab_comment_mr projectId="82138843" mrId=42 body="## Review\nLGTM! Apenas um ponto de atencao na linha 42."
```

**Exemplo — inline comment:**
```
gitlab_comment_mr projectId="82138843" mrId=42 body="**Bug:** SQL injection via concatenacao. Use query parametrizada." position={new_path:"src/auth.ts", new_line:42}
```

**Posicao inline:**
O `position` precisa de:
- `new_path`: caminho do arquivo como aparece no diff
- `new_line`: numero da linha na versao NOVA do arquivo

O sistema extrai automaticamente `base_sha`, `start_sha`, `head_sha` do MR para montar o payload do GitLab.

---

### `gitlab_create_mr`

Cria um novo MR no GitLab.

**Parametros:**

| Param | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `projectId` | string | Nao | Project ID |
| `title` | string | **Sim** | Titulo do MR |
| `sourceBranch` | string | **Sim** | Branch de origem |
| `targetBranch` | string | Nao | Branch destino (default: `main`) |
| `description` | string | Nao | Descricao (markdown) |

**Exemplo:**
```
gitlab_create_mr projectId="82138843" title="fix: SQL injection no login" sourceBranch="fix/sql-injection" targetBranch="main" description="## Fix\nCorrige vulnerabilidade de SQL injection no endpoint de login."
```

---

### `gitlab_update_mr`

Merge, close ou reopen de um MR.

**Parametros:**

| Param | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `projectId` | string | Nao | Project ID |
| `mrId` | number | **Sim** | MR IID |
| `state` | string | **Sim** | `merge`, `close`, `reopen` |

**Exemplo:**
```
gitlab_update_mr projectId="82138843" mrId=42 state="merge"
```

---

### `gitlab_create_issue`

Cria uma issue no GitLab.

**Parametros:**

| Param | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `projectId` | string | Nao | Project ID |
| `title` | string | **Sim** | Titulo da issue |
| `description` | string | Nao | Descricao (markdown) |
| `labels` | string[] | Nao | Labels |

**Exemplo:**
```
gitlab_create_issue projectId="82138843" title="Bug: crash ao salvar config" description="..." labels=["bug","critical"]
```

---

### `gitlab_get_file`

Le um arquivo de um repo GitLab via API (sem clonar localmente).

**Parametros:**

| Param | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `projectId` | string | Nao | Project ID |
| `filePath` | string | **Sim** | Caminho do arquivo no repo |
| `ref` | string | Nao | Branch, tag, ou SHA (default: `main`) |

**Exemplo:**
```
gitlab_get_file projectId="82138843" filePath="src/auth.ts" ref="main"
```

**Resposta:**
```json
{
  "ok": true,
  "data": {
    "path": "src/auth.ts",
    "content": "import express from 'express';\n...",
    "size": 1234,
    "ref": "main"
  }
}
```

---

### `gitlab_list_repos`

Lista todos os repos acessiveis pelo token configurado.

**Parametros:** Nenhum.

**Exemplo:**
```
gitlab_list_repos
```

**Resposta:**
```json
{
  "ok": true,
  "data": [
    {
      "id": 82138843,
      "name": "codebrain",
      "namespace": "maikeofc18",
      "webUrl": "https://gitlab.com/maikeofc18/codebrain",
      "defaultBranch": "main",
      "lastActivity": "2026-05-27T12:00:00Z"
    }
  ]
}
```

---

## Git Local Tools (4 tools)

### `git_clone`

Clona um repo localmente.

**Parametros:**

| Param | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `url` | string | **Sim** | URL do repo |
| `path` | string | **Sim** | Diretorio local destino |

**Exemplo:**
```
git_clone url="https://gitlab.com/maikeofc18/codebrain.git" path="/tmp/codebrain-review"
```

---

### `git_branch`

Cria uma branch local.

**Parametros:**

| Param | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `path` | string | **Sim** | Caminho do repo local |
| `name` | string | **Sim** | Nome da branch |
| `base` | string | Nao | Branch base (default: HEAD atual) |

**Exemplo:**
```
git_branch path="/tmp/codebrain-review" name="fix/mr-42-sql-injection" base="main"
```

---

### `git_commit_push`

Adiciona, commita e faz push dos arquivos.

**Parametros:**

| Param | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `path` | string | **Sim** | Caminho do repo local |
| `message` | string | **Sim** | Mensagem do commit |
| `files` | string[] | Nao | Arquivos para stage (default: todos) |
| `branch` | string | Nao | Branch para push (default: atual) |

**Exemplo:**
```
git_commit_push path="/tmp/codebrain-review" message="fix: use parameterized query in login" files=["src/auth.ts"] branch="fix/mr-42-sql-injection"
```

---

### `git_diff`

Obtem diff entre refs num repo local.

**Parametros:**

| Param | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `path` | string | **Sim** | Caminho do repo local |
| `base` | string | Nao | Ref base (default: HEAD) |
| `head` | string | Nao | Ref head (default: working tree) |

**Exemplo:**
```
git_diff path="/tmp/codebrain-review" base="main" head="fix/mr-42-sql-injection"
```

---

## Review System Tools (3 tools)

### `review_config_get`

Le a configuracao atual do sistema de revisao.

**Parametros:** Nenhum.

**Exemplo:**
```
review_config_get
```

**Resposta:**
```json
{
  "ok": true,
  "data": {
    "repos": [
      {
        "projectId": "82138843",
        "name": "codebrain",
        "branches": ["main", "master"],
        "skipDraft": true,
        "autoFix": false,
        "autoFixSeverity": "critical"
      }
    ],
    "polling": { "enabled": true, "intervalMs": 120000 },
    "webhook": { "enabled": true, "secret": "" },
    "maxComments": 20,
    "maxCostPerReview": 0.5
  }
}
```

---

### `review_config_set`

Atualiza a configuracao do sistema de revisao.

**Parametros:**

| Param | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `addRepo` | object | Nao | Adiciona/atualiza um repo |
| `removeRepo` | string | Nao | Remove repo por projectId |
| `repos` | object[] | Nao | Substitui lista completa de repos |
| `polling` | object | Nao | `{ enabled, intervalMs }` |
| `webhook` | object | Nao | `{ enabled, secret }` |
| `maxComments` | number | Nao | Max comentarios por review |
| `maxCostPerReview` | number | Nao | Custo max (USD) por review |

**Objeto repo (`addRepo` / `repos[]`):**

| Campo | Tipo | Default | Descricao |
|-------|------|---------|-----------|
| `projectId` | string | (obrigatorio) | ID do projeto GitLab |
| `name` | string | `repo-{id}` | Nome amigavel |
| `branches` | string[] | `["main","master"]` | Branches para monitorar |
| `skipDraft` | boolean | `true` | Ignorar MRs em draft |
| `autoFix` | boolean | `false` | Criar MR de fix automatico para bugs criticos |
| `autoFixSeverity` | string | `"critical"` | Severidade minima para auto-fix |

**Exemplos:**

Adicionar um repo:
```
review_config_set addRepo={projectId:"82138843", name:"codebrain", skipDraft:true, autoFix:false}
```

Adicionar com auto-fix:
```
review_config_set addRepo={projectId:"99999", name:"backend-api", autoFix:true, autoFixSeverity:"critical"}
```

Remover um repo:
```
review_config_set removeRepo="99999"
```

Configurar polling:
```
review_config_set polling={enabled:true, intervalMs:60000}
```

Configurar webhook:
```
review_config_set webhook={enabled:true, secret:"meu-secret"}
```

Ajustar politicas:
```
review_config_set maxComments=15 maxCostPerReview=1.0
```

---

### `review_status`

Retorna o status atual do sistema de revisao.

**Parametros:** Nenhum.

**Exemplo:**
```
review_status
```

**Resposta:**
```json
{
  "ok": true,
  "data": {
    "reposConfigured": 1,
    "pollingEnabled": true,
    "pollingIntervalMs": 120000,
    "webhookEnabled": true,
    "webhookHasSecret": false,
    "maxComments": 20,
    "maxCostPerReview": 0.5,
    "recentReviews": []
  }
}
```

---

## Webhook

### Configuracao no GitLab

1. No repo → **Settings** → **Webhooks**
2. URL: `https://seu-dominio.com/api/webhooks/gitlab`
3. Secret token: (o mesmo do `review_config_set webhook={secret:"xxx"}`, ou vazio)
4. Trigger: marque **Merge request events**
5. SSL verification: desmarque se usar ngrok com HTTP

### Endpoint

```
POST /api/webhooks/gitlab
```

**Headers:**
- `X-Gitlab-Token`: secret para validacao (se configurado)
- `X-Gitlab-event`: `Merge Request Hook`

**Comportamento:**
1. Valida o token (se `webhook.secret` estiver configurado)
2. Aceita apenas `Merge Request Hook`
3. Ignora acoes nao-acionaveis (so processa `open`, `reopen`, `update`)
4. Ignora drafts se `skipDraft=true` no repo config
5. Armazena o evento na memoria episodica
6. Dispara hook `mr_webhook` para o pipeline de review

### Teste com ngrok

```powershell
# Terminal 1: encontrar a porta do MCP server
# Procura no log: "[MCP] CodeBrain MCP server listening on http://127.0.0.1:XXXXX"

# Terminal 2: expor com ngrok
ngrok http http://127.0.0.1:XXXXX

# Copiar a URL publica (ex: https://abc123.ngrok-free.app)
# Configurar no GitLab: https://abc123.ngrok-free.app/api/webhooks/gitlab
```

### Teste manual com curl

```bash
curl -X POST http://127.0.0.1:XXXXX/api/webhooks/gitlab \
  -H "Content-Type: application/json" \
  -H "X-Gitlab-event: Merge Request Hook" \
  -d '{
    "object_kind": "merge_request",
    "object_attributes": {
      "iid": 42,
      "title": "feat: test webhook",
      "action": "open",
      "source_branch": "feature/test",
      "target_branch": "main",
      "url": "https://gitlab.com/...",
      "work_in_progress": false
    },
    "user": { "name": "Maike", "username": "maikeofc18" },
    "project": { "id": 82138843 }
  }'
```

---

## Polling Worker

O worker `gitlab-reviewer` roda a cada 2 minutos e lista MRs abertos de todos os repos configurados.

### Iniciar

```
worker_start("gitlab-reviewer")
```

### Parar

```
worker_stop("gitlab-reviewer")
```

### Verificar status

```
worker_status
```

### Comportamento:
1. Carrega `~/.codebrain/review-config.json`
2. Para cada repo: lista MRs abertos via API
3. Compara com cache local (por `updatedAt`)
4. MRs novos/atualizados sao salvos na memoria episodica
5. Dispara hook `mr_detected` para o pipeline de review (Fase 3)

---

## Fluxo Completo de Teste

```
1.  Setar GITLAB_TOKEN e reiniciar Codebrain
2.  gitlab_list_repos                  → confirma que o token funciona
3.  review_config_set addRepo={...}   → configura o repo
4.  review_config_get                  → verifica config
5.  worker_start("gitlab-reviewer")   → inicia polling
6.  ngrok http 127.0.0.1:PORTA        → expoe webhook
7.  Configurar webhook no GitLab       → aponta pro ngrok
8.  Criar MR de teste no GitLab        → observa deteccao
9.  review_status                      → ve o sistema em acao
```

---

## Arquitetura

```
                    ┌─────────────┐
                    │   GitLab    │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
         Webhook       Polling      API direta
         (push)       (pull 2min)   (on-demand)
              │            │            │
              ▼            ▼            ▼
    ┌─────────────────────────────────────────┐
    │         MCP Server (server.js)          │
    │  POST /api/webhooks/gitlab              │
    │  + background-workers.js                │
    │  + bridge.js (git-handlers)             │
    └────────────────┬────────────────────────┘
                     │
         ┌───────────┼───────────┐
         │           │           │
    ┌────▼────┐ ┌────▼────┐ ┌───▼────┐
    │ memory  │ │  hooks  │ │ config │
    │ (SQLite)│ │(events) │ │(JSON)  │
    └─────────┘ └─────────┘ └────────┘
```

### Config File

Localizacao: `~/.codebrain/review-config.json`

```json
{
  "repos": [
    {
      "projectId": "82138843",
      "name": "codebrain",
      "branches": ["main", "master"],
      "skipDraft": true,
      "autoFix": false,
      "autoFixSeverity": "critical"
    }
  ],
  "polling": {
    "enabled": true,
    "intervalMs": 120000
  },
  "webhook": {
    "enabled": true,
    "secret": ""
  },
  "maxComments": 20,
  "maxCostPerReview": 0.5
}
```

---

## Troubleshooting

| Problema | Causa | Solucao |
|----------|-------|---------|
| `GITLAB_TOKEN not set` | Variavel nao carregada | Abra um NOVO terminal apos setar |
| `gitlab_list_repos` retorna `[]` | Token sem permissao | Verifique scope `api` no token |
| Webhook nao recebe eventos | URL errada ou ngrok parado | Verifique URL + ngrok ativo |
| Polling nao detecta MRs | Repo nao configurado | `review_config_set addRepo={...}` |
| `403` no webhook | Secret mismatch | Ajuste `webhook.secret` no config |
