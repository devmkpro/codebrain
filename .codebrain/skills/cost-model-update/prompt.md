# Update Model Pricing — Codebrain

Use esta skill para adicionar ou atualizar preços de modelos no cost-tracker.

## Arquivo Alvo

`packages/mcp/bridge/cost-tracker.js` — objeto `DEFAULT_MODEL_COSTS`

## Estrutura de Entrada por Modelo

```javascript
"<model-id>": { input: X.X, output: Y.Y, cache_read: Z.Z }
```

Valores em **USD por 1 milhão de tokens**.

## Seções do Arquivo

```
ANTHROPIC - CLAUDE 4.x   → modelos internos (claude-4.x-opus, etc.)
API MODEL NAME ALIASES    → nomes retornados pela API (claude-opus-4-7, etc.)
OPENROUTER               → formato "provider/model"
MIMO                     → mimo-v2.x-pro, etc.
GEMINI                   → gemini-X.Y-flash/pro, etc.
```

## Regras de Nomenclatura

| Provider | Formato interno | Formato alias API |
|----------|----------------|-------------------|
| Anthropic | `claude-4.8-opus` | `claude-opus-4-8` |
| Anthropic | `claude-4.6-sonnet` | `claude-sonnet-4-6` |
| OpenRouter | `anthropic/claude-opus-4.8` | — |
| Google | `gemini-2.5-pro` | — |
| MIMO | `mimo-v2.5-pro` | — |

## Passo a Passo

### 1. Adicionar novo modelo

Localize a seção correta e insira **dois registros**:
- Formato interno na seção do provider
- Alias de API na seção `API MODEL NAME ALIASES`

```javascript
// Seção Anthropic
"claude-4.8-opus": { input: 5.0, output: 25.0, cache_read: 0.5 },

// Seção aliases
"claude-opus-4-8": { input: 5.0, output: 25.0, cache_read: 0.5 },
```

### 2. Atualizar modelo existente

Localize pelo nome e atualize os valores. Lembre de atualizar **ambos** (interno + alias).

### 3. Verificar via MCP

```
mcp__codebrain__cost_models()
```

Confirme que o modelo aparece na lista.

### 4. Testar estimativa

```
mcp__codebrain__cost_estimate({
  model: "claude-opus-4-8",
  input_tokens: 1000,
  output_tokens: 500
})
```

## Tabela de Referência Anthropic (2026)

| Modelo | Input | Output | Cache Read |
|--------|-------|--------|------------|
| Opus 4.5–4.8 | $5/MTok | $25/MTok | $0.50/MTok |
| Sonnet 4.5–4.6 | $3/MTok | $15/MTok | $0.30/MTok |
| Haiku 4.5 | $1/MTok | $5/MTok | $0.10/MTok |
| Opus 4.1 | $15/MTok | $75/MTok | $1.50/MTok |

## Nota

O cost-tracker tem fallback automático para modelos desconhecidos (usa $3/$15 como padrão Sonnet).
Sempre adicione modelos explicitamente para rastreamento preciso.
