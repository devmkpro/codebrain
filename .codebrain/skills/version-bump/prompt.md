# Version Bump — Codebrain

Realiza o processo completo de bump de versão do Codebrain.

## ⚠️ Boa Prática: Lugares para Atualizar

A versão e o count de tools devem estar sempre sincronizados em:

| Arquivo | Campo | Exemplo |
|---------|-------|---------|
| `package.json` | `"version"` | `"1.7.0"` |
| `.claude/settings.json` | `env.CODEBRAIN_VERSION` | `"1.7.0"` |
| `.claude/settings.json` | `codebrain.version` | `"1.7.0"` |
| `.claude/settings.json` | `codebrain.mcp.totalTools` | contar `server.tool(` em `packages/mcp/index.js` |

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

## Passo 4 — Commit

```bash
git add package.json .claude/settings.json
git commit -m "chore: bump v<VERSION>"
```

## Passo 5 — Tag

```bash
git tag v<VERSION>
```

## Passo 6 — Push com tags

```bash
git push origin master --tags
```

## Passo 7 — Regenerar releases-data.ts

```bash
npm run gen:releases
```

Isso atualiza `src/components/navigation/releases-data.ts`.

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
- [ ] Commit `chore: bump v<VERSION>` criado (inclui package.json + settings.json)
- [ ] Tag `v<VERSION>` criada
- [ ] Push com `--tags` feito
- [ ] `npm run gen:releases` executado
- [ ] `releases-data.ts` commitado e pushado

## Verificar Sincronização

Para conferir se os 3 estão iguais:

```bash
# package.json
node -e "console.log(require('./package.json').version)"

# settings.json
node -e "const s=require('./.claude/settings.json'); console.log(s.env?.CODEBRAIN_VERSION, s.codebrain?.version)"
```

## Convenção de Versões

- **patch** (x.y.Z): bugfix, ajuste de preço, pequena melhoria, nova skill
- **minor** (x.Y.0): nova feature, novo MCP tool, novo provider
- **major** (X.0.0): breaking change, reescrita de módulo core
