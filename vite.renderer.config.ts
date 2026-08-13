import { defineConfig } from "vite";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/* ═══════════════════════════════════════════════════════════════════════════
   VITE — SÓ O RENDERER
   ═══════════════════════════════════════════════════════════════════════════

   Sobe a interface num browser comum, sem Electron.

   Serve para inspecionar layout, tema e o command palette sem abrir a janela
   do app inteiro. As APIs de Electron ficam ausentes (`window.codeBrainApp`
   é undefined), e o código já as acessa com `?.` em toda parte — então a
   casca renderiza; o que depende de PTY, naturalmente, não funciona.

   Não substitui `npm run dev`: é ferramenta de inspeção visual.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Stub da ponte de preload.
 *
 * Fora do Electron, `window.codeBrainApp` não existe. A maior parte do
 * renderer acessa a ponte com `?.` e sobrevive, mas alguns componentes
 * encadeiam direto (`codeBrainApp.app.onX()`) e derrubam a árvore inteira.
 *
 * Um Proxy recursivo que devolve função no-op para qualquer caminho resolve:
 * qualquer acesso funciona, toda chamada devolve uma Promise resolvida, e
 * todo registro de listener devolve uma função de remoção.
 *
 * Só existe neste config — nunca entra no build de produção.
 */
const PRELOAD_STUB = `
<script>
(() => {
  const noop = () => {};
  const make = () => new Proxy(noop, {
    get: (_t, prop) => {
      // Delega then/catch/finally a uma Promise resolvida de verdade. Assim
      // tanto "await ponte.x()" quanto "ponte.x().then(...).catch(...)"
      // funcionam — devolver só um then() faria o .catch() encadeado
      // estourar, que é como o App.tsx chama app.version().
      if (prop === "then" || prop === "catch" || prop === "finally") {
        const settled = Promise.resolve(undefined);
        return settled[prop].bind(settled);
      }
      if (prop === Symbol.toPrimitive) return () => "";
      return make();
    },
    // Chamar devolve outro proxy — que é ao mesmo tempo chamável (serve como
    // a função de remoção que os registros de listener retornam) e awaitable.
    apply: () => make(),
  });
  window.codeBrainApp = make();
  window.__CODEBRAIN_FLAGS__ = {};
  window.__CODEBRAIN_PREVIEW__ = true;
})();
</script>`;

export default defineConfig({
  root: "src",
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  plugins: [
    tailwindcss(),
    react(),
    {
      name: "codebrain-preload-stub",
      transformIndexHtml(html) {
        // O index.html traz uma CSP com `script-src 'self'`, que bloqueia
        // script inline — e portanto o stub. Removemos a meta tag *apenas
        // nesta pré-visualização*; o index.html em si não é tocado, e o build
        // de produção mantém a CSP intacta.
        const withoutCsp = html.replace(
          /<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/i,
          "<!-- CSP removida na pré-visualização de renderer (vite.renderer.config.ts) -->",
        );
        return withoutCsp.replace("<head>", `<head>${PRELOAD_STUB}`);
      },
    },
  ],
  server: { port: 5199 },
});
