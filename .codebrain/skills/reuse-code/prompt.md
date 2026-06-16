# Code Reuse Refactor — Codebrain

Identifica e elimina duplicações, centralizando dados na fonte de verdade correta.

## Fontes de Verdade no Codebrain

| Dado | Fonte de Verdade | NÃO duplicar em |
|------|-----------------|-----------------|
| Preços de modelos | `packages/mcp/bridge/cost-tracker.js` → `DEFAULT_MODEL_COSTS` | `AppHeader.tsx`, outros componentes React |
| Lista de modelos por provider | `electron/main/services/constants.ts` → `PROVIDER_REGISTRY` | outros arquivos TS/JS |
| MCP tool count | contagem dinâmica de `server.tool(` em `packages/mcp/index.js` | `settings.json` hardcoded, README |
| Versão do app | `package.json` → `version` | `.claude/settings.json` (sincronizar no bump) |
| Roles de squad | `electron/main/services/constants.ts` | outros arquivos |

## Como o Renderer Acessa Dados do Main Process

Sempre via IPC — nunca reimplementar lógica no renderer:

```typescript
// ✅ Correto: buscar do cost-tracker via IPC
const costModels = useCostStore(s => s.models);
// cost-store.tsx chama: window.codeBrainApp.cost.listModels()
// que chama: cost-tracker.js → listModels()

// ❌ Errado: tabela hardcoded no componente
const MODEL_PRICING = { 'claude-opus-4-8': { input: 5.0, output: 25.0 }, ... }
```

## Checklist de Duplicações Comuns

### 1. Preços no AppHeader
```bash
grep -n "input:.*output:" src/components/ui/AppHeader.tsx
```
Se encontrar: remover e usar `useCostStore(s => s.models)` + `loadModels()` no useEffect.

### 2. Listas de modelos fora do PROVIDER_REGISTRY
```bash
grep -rn "claude-opus-4-[0-9]" src/ --include="*.tsx" --include="*.ts"
```
Se encontrar: importar de `constants.ts` ou buscar via `useProvidersStore`.

### 3. MCP tool count hardcoded
```bash
grep -rn "totalTools\|97\|156\|91" .claude/settings.json
```
Se encontrar número desatualizado: rodar o script de contagem:
```bash
node -e "const s=require('fs').readFileSync('./packages/mcp/index.js','utf-8'); console.log((s.match(/server\\.tool\\(/g)||[]).length)"
```

### 4. Versão desincronizada
```bash
node -e "
  const pkg = require('./package.json').version;
  const cfg = require('./.claude/settings.json');
  const env = cfg.env?.CODEBRAIN_VERSION;
  const cb = cfg.codebrain?.version;
  console.log('package.json:', pkg);
  console.log('env.CODEBRAIN_VERSION:', env, pkg === env ? '✅' : '❌ DESSINCRONIZADO');
  console.log('codebrain.version:', cb, pkg === cb ? '✅' : '❌ DESSINCRONIZADO');
"
```

## Padrão de Refatoração

### Antes (dados duplicados no componente)
```tsx
// AppHeader.tsx — ruim
const MODEL_PRICING = {
  'claude-opus-4-8': { input: 5.0, output: 25.0 },
  // 30 linhas duplicando cost-tracker.js...
};
```

### Depois (fonte única via store)
```tsx
// AppHeader.tsx — correto
const costModels = useCostStore(s => s.models);
const loadCostModels = useCostStore(s => s.loadModels);
React.useEffect(() => { if (Object.keys(costModels).length === 0) loadCostModels(); }, []);

// uso:
const label = modelPricingLabelFromMap(model, costModels);
```

## Regras de Ouro

1. **Um dado = um lugar.** Se precisa em dois lugares, um lê do outro via IPC/store.
2. **Main process = fonte de verdade.** Renderer sempre busca via `window.codeBrainApp.*`.
3. **Sem `fetch` no renderer para dados locais.** Use IPC (`ipcRenderer.invoke`).
4. **Zustand store = cache do renderer.** O store busca do main e mantém atualizado.
5. **Ao adicionar um modelo novo:** edite apenas `cost-tracker.js`. Tudo mais se atualiza.

## Após Refatorar

- Verificar que o app ainda funciona: `npm run dev`
- Confirmar que preços aparecem corretamente no menu `+shell`
- Commitar com: `refactor: centralize <dado> in <fonte>`
