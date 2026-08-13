import { defineConfig } from "vitest/config";
import path from "node:path";

/* ═══════════════════════════════════════════════════════════════════════════
   VITEST
   ═══════════════════════════════════════════════════════════════════════════

   O projeto não tinha teste nenhum, apesar de CLAUDE.md e README prometerem
   `npm run test`. Este é o harness.

   Dois ambientes, escolhidos por caminho, porque o app tem dois mundos:

   • node   — `packages/` e `electron/`: lógica de main process, SQLite, MCP.
              Sem DOM, testes rápidos, better-sqlite3 real em :memory:.
   • jsdom  — `src/`: renderer React.

   Testes ficam junto do código (`foo.ts` + `foo.test.ts`) em vez de numa
   árvore `__tests__` paralela: mais fácil de notar que existe um teste, e
   mais fácil de notar que não existe.
   ═══════════════════════════════════════════════════════════════════════════ */

export default defineConfig({
  test: {
    globals: true,
    // Padrão jsdom (a maior parte do código testável é renderer); os testes de
    // node se marcam com `// @vitest-environment node` no topo do arquivo.
    environment: "jsdom",
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "packages/**/*.{test,spec}.{js,ts}",
      "electron/**/*.{test,spec}.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/out/**", "src/out/**"],
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      // Só o que tem teste conta. Cobertura de arquivo sem teste vira ruído
      // que ninguém olha — a meta é subir isso fase a fase, não fingir.
      include: [
        "src/lib/**/*.{ts,tsx}",
        "packages/memory/migrations.js",
        "packages/memory/schema-migrations.js",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
