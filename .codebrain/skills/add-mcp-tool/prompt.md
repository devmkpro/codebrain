# Add MCP Tool — Codebrain

Você vai adicionar um novo MCP tool ao Codebrain. Siga **exatamente** este fluxo de 3 camadas.

## Contexto do Projeto

- Projeto: `C:\Users\Maike\Desktop\codebrain`
- MCP bridge handlers: `packages/mcp/bridge/<name>-handlers.js`
- Tool registration: `packages/mcp/index.js`
- Bridge composition: `packages/mcp/bridge.js`
- Main process wiring: `electron/main/services/mcp.ts`

## Input esperado

```
TOOL_NAME: <nome do tool, ex: "feature_action">
HANDLER_FILE: <nome do arquivo bridge, ex: "feature-handlers.js">
DESCRIPTION: <o que o tool faz>
PARAMS: <lista de parâmetros com tipos>
LOGIC: <o que o handler deve fazer>
```

## Passo 1 — Bridge Handler

Crie ou edite `packages/mcp/bridge/<HANDLER_FILE>`:

```javascript
"use strict";

function create<Name>Handlers(opts) {
  return {
    async <toolCamelCase>(args) {
      // implementação usando opts.dependencies
      return { ok: true, data: result };
    },
  };
}

module.exports = { create<Name>Handlers };
```

## Passo 2 — Tool Registration (packages/mcp/index.js)

Adicione o tool com schema Zod:

```javascript
server.tool(
  "mcp__codebrain__<TOOL_NAME>",
  "<DESCRIPTION>",
  { param: z.string().describe("...") },
  async ({ param }) => {
    try {
      const result = await bridge.<toolCamelCase>({ param });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);
```

## Passo 3 — Wiring (packages/mcp/bridge.js)

1. Importe o handler no topo do arquivo
2. Adicione ao objeto `bridge` retornado

## Passo 4 — Dependências (electron/main/services/mcp.ts)

Se o handler precisa de dependências do processo principal (ptyManager, db, etc.), passe-as ao criar o bridge.

## Passo 5 — Verificação

```bash
npm run dev
# No terminal do agente: mcp__codebrain__<TOOL_NAME>()
```

## Checklist

- [ ] Handler criado em `packages/mcp/bridge/`
- [ ] Tool registrado em `packages/mcp/index.js` com schema Zod
- [ ] Handler importado e composto em `packages/mcp/bridge.js`
- [ ] Dependências passadas em `electron/main/services/mcp.ts` se necessário
- [ ] Teste manual no app
- [ ] Count de tools atualizado no README.md

## Regras

- **Sempre** use `isError: true` no catch para que o agente veja o erro
- **Nunca** `throw` sem catch no handler — retorne `{ ok: false, error: msg }`
- Nome do tool MCP **deve** seguir padrão `mcp__codebrain__<snake_case>`
