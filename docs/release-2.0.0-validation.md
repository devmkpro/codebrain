# Codebrain 2.0.0 — validação da integração

## Terminal

O renderer não força mais `scrollToBottom()` no recebimento de cada chunk nem
durante fit/redraw. O xterm mantém o acompanhamento nativo: ao sair do fim para
ler o histórico, a saída continua sendo processada sem puxar o viewport para
baixo; voltar ao fim retoma o acompanhamento. Nenhuma sequência ANSI é filtrada.

Regressões automatizadas reproduziram o salto em streaming e no fit atrasado
antes da correção. A validação no Electron usou um perfil isolado e saída
PowerShell offline: histórico estável durante streaming, retomada pelo scrollbar
e resize sem salto para a saída mais recente. Nenhum terminal do usuário foi
usado como fixture.

## Skills embutidas

O pacote nativo inclui `cb-site-premium`, `cb-showcase`, `cb-design-dna`,
`cb-copywriting` e `cb-image-assets`, além das oito skills de operação existentes.
O instalador copia a árvore completa, incluindo scripts, regras e avisos, para
os diretórios nativos suportados. O filtro do empacotador portátil preserva os
scripts dentro das skills. A Central foi conferida no Electron com as cinco
skills visíveis como nativas.

Os helpers de DNA foram testados com fixtures locais e Chromium existente.
Playwright e navegador são dependências de execução dos helpers, não downloads
silenciosos. Cinema, scrub e encode são integrações opcionais não incluídas.
Os avisos de autoria de terceiros permanecem nos arquivos NOTICE.

## Decisor e MCP externo

O seletor distingue CLI com login existente e API com chave. A disponibilidade
de `Claude · login existente` foi conferida pelo IPC e pela interface real.
Somente Claude é oferecido como Decisor CLI: os demais não têm isolamento
equivalente confirmado. Listagem não comprova autenticação; não foi executada
inferência real nesta validação. Falha, timeout ou resposta inválida devem manter
o fallback por palavras-chave/tipo padrão.

O cadastro local aprovado de HTTP Toolkit é mesclado às configurações de MCP
dos adaptadores implementados, sem substituir servidores ou permissões do
usuário. A descoberta stdio e a inicialização do HTTP Toolkit foram verificadas.
Harnesses já abertos precisam de nova sessão para carregar a configuração.

## Limitações de validação

Não foram testadas geração paga em OpenAI/Gemini/Sora nem autenticação de uma
segunda conta. O typecheck do main é uma verificação separada do renderer;
`npm run typecheck` usa uma configuração raiz sem arquivos e não comprova que
o renderer inteiro está sem erros. A distribuição final depende dos jobs da CI.
