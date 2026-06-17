# Version Bump — Codebrain

Realiza o processo completo de bump de versão do Codebrain.

## ⚠️ REGRA CRÍTICA: gen-releases ignora commits `chore:`

O script `scripts/gen-releases.mjs` (linha 66) **descarta** commits com prefixo `chore:`, `docs:`, `refactor:`, `perf:`, `test:`. Apenas `feat:`, `fix:` e `security:` geram highlights na release.

**Portanto, o bump NÃO PODE ser um único commit `chore:`.** Se for, a versão não aparecerá no releases-data.ts e a statusline não mostrará a release.

### Fluxo OBRIGATÓRIO

```
1. Commits SEPARADOS com prefixo fix:/feat: para cada mudança de código
2. Commit chore: bump v<VERSÃO> apenas para package.json + settings.json + CHANGELOG.md
3. Tag v<VERSÃO> no último commit
4. Se NÃO houve commits fix:/feat: separados → criar commit vazio fix: antes da tag
```

**Exemplo correto (se já commited tudo como chore:):**
```bash
# 1. O bump já existe como chore:
git log --oneline -3
# 6967581 chore: bump v1.11.2 — fix MCP startup crash...

# 2. Criar commit fix: VAZIO para gen-releases capturar
git commit --allow-empty -m "fix: <descrição dos fixes desta versão>"

# 3. Recriar tag no novo commit
git tag -d v1.11.2
git push origin :refs/tags/v1.11.2  # deletar tag remote
git tag v1.11.2

# 4. Push
git push origin master --tags
```

**Exemplo correto (bump novo, commits separados):**
```bash
# 1. Code changes já committed com prefixos corretos
git log --oneline -5
# abc1234 fix: MCP crash on startup — */ in JS comment
# def5678 fix: stale stdio paths in ~/.mcp.json

# 2. Bump commit (apenas metadata)
git add package.json .claude/settings.json CHANGELOG.md
git commit -m "chore: bump v1.11.2"
git tag v1.11.2
git push origin master --tags
```

---

## ⚠️ Boa Prática: Lugares para Atualizar

A versão e o count de tools devem estar sempre sincronizados em:

| Arquivo | Campo | Exemplo |
|---------|-------|---------|
| `package.json` | `"version"` | `"1.7.0"` |
| `.claude/settings.json` | `env.CODEBRAIN_VERSION` | `"1.7.0"` |
| `.claude/settings.json` | `codebrain.version` | `"1.7.0"` |
| `.claude/settings.json` | `codebrain.mcp.totalTools` | contar `server.tool(` em `packages/mcp/index.js` |
| `CHANGELOG.md` | Nova seção `## [X.Y.Z]` | Data + resumo das mudanças |

> **Bug real:** Na v1.6.7, o `package.json` estava em 1.6.7 mas o `.claude/settings.json` ainda mostrava 1.5.0 — versão errada na statusline. O `totalTools` também estava em 91 quando eram 156.

### Verificar count de tools atual

```bash
node -e "const s=require('fs').readFileSync('./packages/mcp/index.js','utf-8'); console.log((s.match(/server\\.tool\\(/g)||[]).length)"
```

## Input esperado

```
VERSION: <nova versão, ex: "1.7.0">
NOTES: <resumo do que mudou nesta versão>
```

## Passo 1 — Verificar estado do repo

```bash
git status
git log --oneline -5
```

**Verificar se já existem commits fix:/feat: desde a última tag.** Se NÃO existirem, o Passo 4 precisa criar commits separados.

## Passo 2 — Atualizar package.json

Edite `package.json`, campo `"version"`:

```json
{
  "version": "<VERSION>"
}
```

## Passo 3 — Atualizar .claude/settings.json ← NÃO ESQUECER

Edite `.claude/settings.json` e atualize **dois campos**:

```json
{
  "env": {
    "CODEBRAIN_VERSION": "<VERSION>"
  },
  "codebrain": {
    "version": "<VERSION>"
  }
}
```

> O campo `codebrain.version` é lido pela statusline (`.claude/helpers/statusline.cjs`).
> O campo `env.CODEBRAIN_VERSION` é injetado no system prompt dos agentes.

## Passo 3.5 — Atualizar CHANGELOG.md ← OBRIGATÓRIO

Adicione uma nova seção **no topo** do `CHANGELOG.md` (logo abaixo do título), ANTES da versão anterior:

```markdown
## [<VERSION>] — YYYY-MM-DD

### Features
- Feature 1 description

### Fixes
- Fix 1 description
```

**Regras:**
- Data no formato ISO: `YYYY-MM-DD`
- Categorias: `Features`, `Fixes`, `CI/CD`, `Other`
- Cada item começa com `- ` (bullet point)
- Descrições curtas e claras (1 linha)
- Incluir contagem de tools se mudou (ex: "244 total MCP tools")
- Incluir nomes de arquivos novos se relevante

## Passo 4 — Commits ← CRÍTICO

### Cenário A: Mudanças de código já commited com prefixo fix:/feat:

```bash
# Apenas o bump de metadata
git add package.json .claude/settings.json CHANGELOG.md
git commit -m "chore: bump v<VERSION>"
```

### Cenário B: Mudanças de código ainda NÃO commited

```bash
# 1. Commit SEPARADO para cada fix/feat
git add <arquivos-do-fix-1>
git commit -m "fix: <descrição do fix 1>"

git add <arquivos-do-fix-2>
git commit -m "fix: <descrição do fix 2>"

# 2. Bump de metadata
git add package.json .claude/settings.json CHANGELOG.md
git commit -m "chore: bump v<VERSION>"
```

### Cenário C: Tudo já commited como `chore:` (erro comum)

```bash
# 1. Criar commit fix: VAZIO para gen-releases capturar
git commit --allow-empty -m "fix: <descrição resumida de TODOS os fixes>"

# 2. O chore: bump já existe, não precisa criar outro
```

## Passo 5 — Tag

```bash
git tag v<VERSION>
```

## Passo 6 — Push com tags

```bash
git push origin master --tags
```

**Se a tag já existir no remote (re-tagging):**
```bash
git push origin :refs/tags/v<VERSION>  # deletar remote
git push origin v<VERSION>              # push nova
```

## Passo 7 — Regenerar releases-data.ts

```bash
npm run gen:releases
```

**VERIFICAR** que a versão aparece no output:
```
✓ Generated ... with N release(s)
  v1.11.2 — 1 highlights    ← SE NÃO APARECER, falta commit fix:/feat:
  v1.11.0 — 1 highlights
```

Se NÃO aparecer → falta commit com prefixo `fix:` ou `feat:` entre esta tag e a anterior. Voltar ao Passo 4 Cenário C.

## Passo 8 — Commit do releases-data

```bash
git add src/components/navigation/releases-data.ts
git commit -m "chore: regenerate releases-data for v<VERSION>"
git push origin master
```

## Checklist Completo

- [ ] `package.json` → `version` atualizado
- [ ] `.claude/settings.json` → `env.CODEBRAIN_VERSION` atualizado
- [ ] `.claude/settings.json` → `codebrain.version` atualizado
- [ ] `.claude/settings.json` → `codebrain.mcp.totalTools` correto
- [ ] `CHANGELOG.md` → nova seção `## [<VERSION>]` adicionada no topo
- [ ] Existe pelo menos 1 commit `fix:` ou `feat:` desde a última tag (gen-releases)
- [ ] Commit `chore: bump v<VERSION>` criado
- [ ] Tag `v<VERSION>` criada e pushada
- [ ] `npm run gen:releases` mostra a versão no output
- [ ] `releases-data.ts` commitado e pushado

## Verificar Sincronização

```bash
# package.json
node -e "console.log(require('./package.json').version)"

# settings.json
node -e "const s=require('./.claude/settings.json'); console.log(s.env?.CODEBRAIN_VERSION, s.codebrain?.version)"

# Tag
git tag -l v<VERSION>

# gen-releases vê a versão?
node scripts/gen-releases.mjs 2>&1 | grep <VERSION>
```

## Convenção de Versões

- **patch** (x.y.Z): bugfix, ajuste de preço, pequena melhoria, nova skill
- **minor** (x.Y.0): nova feature, novo MCP tool, novo provider
- **major** (X.0.0): breaking change, reescrita de módulo core
