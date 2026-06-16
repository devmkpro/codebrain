# Add IPC Feature — Codebrain

Você vai adicionar uma feature completa ao Codebrain com IPC (Electron main ↔ renderer).

## Contexto

- IPC handlers: `electron/main/ipc/register-<name>.ts`
- Registro central: `electron/main/ipc/register-all.ts`
- Preload bridge: `electron/preload/index.ts`
- Types: `src/types/electron.d.ts`
- Stores: `src/stores/<name>-store.tsx`
- Components: `src/components/<name>/`
- Context type: `electron/main/ipc/context.ts` (ou similar)

## Input esperado

```
FEATURE_NAME: <nome em kebab-case, ex: "notifications">
CHANNEL_PREFIX: <prefixo IPC, ex: "notifications">
ACTIONS: <lista de actions: list, create, delete, etc.>
UI: sim/não (se precisa de componente React)
```

## Passo 1 — IPC Handler (electron/main/ipc/register-<FEATURE_NAME>.ts)

```typescript
import type { AppContext } from "../context";

export function register<PascalName>Handlers(ctx: AppContext): void {
  ctx.ipc.handle("<CHANNEL_PREFIX>:list", async (_event, args) => {
    try {
      // implementação
      return { ok: true, data: [] };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  ctx.ipc.handle("<CHANNEL_PREFIX>:create", async (_event, args) => {
    try {
      // implementação
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });
}
```

## Passo 2 — Registro (electron/main/ipc/register-all.ts)

```typescript
import { register<PascalName>Handlers } from "./register-<feature-name>";

// Dentro de registerAllIpcHandlers():
register<PascalName>Handlers(ctx);
```

## Passo 3 — Preload (electron/preload/index.ts)

```typescript
<featureName>: {
  list: (args?: any) => ipcRenderer.invoke("<CHANNEL_PREFIX>:list", args),
  create: (args: any) => ipcRenderer.invoke("<CHANNEL_PREFIX>:create", args),
},
```

## Passo 4 — Types (src/types/electron.d.ts)

```typescript
<featureName>: {
  list: (args?: any) => Promise<{ ok: boolean; data?: Item[]; error?: string }>;
  create: (args: CreateArgs) => Promise<{ ok: boolean; error?: string }>;
};
```

## Passo 5 — Zustand Store (src/stores/<feature-name>-store.tsx)

```typescript
import { create } from "zustand";

interface <PascalName>Store {
  items: Item[];
  loading: boolean;
  fetchItems: () => Promise<void>;
}

export const use<PascalName>Store = create<<PascalName>Store>((set) => ({
  items: [],
  loading: false,
  fetchItems: async () => {
    set({ loading: true });
    const res = await window.codeBrainApp.<featureName>.list();
    if (res.ok) set({ items: res.data ?? [] });
    set({ loading: false });
  },
}));
```

## Passo 6 — React Component (src/components/<feature-name>/<PascalName>Panel.tsx)

Crie o componente usando Tailwind CSS e o store Zustand.

## Checklist

- [ ] `register-<name>.ts` criado com todos os handlers
- [ ] Importado em `register-all.ts`
- [ ] Exposto no preload `index.ts`
- [ ] Types adicionados em `electron.d.ts`
- [ ] Zustand store criado
- [ ] Componente React criado (se UI=sim)
- [ ] Testado com `npm run dev`

## Convenções Obrigatórias

- **TypeScript strict** em todos os arquivos `.ts/.tsx`
- **Tailwind** para estilo (não CSS modules)
- **Zustand** para estado (não Redux, não Context)
- Retorne sempre `{ ok: boolean, data?, error? }` nos handlers IPC
- Use `AppContext` como tipo do contexto nos handlers
