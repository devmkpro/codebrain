---
name: cb-image-assets
description: >
  Generate simple OWNED assets fast via media_generate — site image slots (cards,
  gallery, backgrounds), game sprites/textures, app illustrations, product shots. The lean
  sibling of cb-cinema-shot: no video, no camera choreography, no continuation chains.
  Owns the style-lock block (visual consistency across N assets generated in parallel), the
  subject-literal rule, provider choice, and the compressed lint gate. Use for any NON-cinematic
  image asset. For video, scroll heroes, or shot-to-shot continuity, load cb-cinema-shot /
  cb-site-scrub instead. Triggers: asset, sprite, texture, card image, gallery image,
  ilustração, imagem simples, batch de imagens, style-lock.
---

# cb-image-assets — Assets rápidos, baratos, consistentes

One tool, one job: `media_generate({ prompt, kind: "image", provider?, style? })` → png path.
Use apenas o schema real descrito na integração abaixo. Aspect/format hints go INSIDE the prompt as style language; size só quando suportado.

## Provider — decide em 1 linha

| Asset | Provider |
|---|---|
| Cena, personagem, comida, produto, textura, pintura, sprite estilizado | `gemini` se configurado e suportado |
| Layout, diagrama, ícone flat, qualquer coisa com TEXTO legível | `openai` se configurado e suportado |

Nunca troque de provider pra contornar uma falha — falha é problema de prompt.

## As 5 regras (todas duras)

1. **Subject-literal.** Gere o que a marca/jogo É — a salsicha do hot-dog, o espetinho do
   jogo de churrasco. Teste dos 2 segundos: sem legenda, qualquer um nomeia o assunto.
2. **Style-lock em batch.** N assets gerados em paralelo por workers que não se veem =
   deriva de estilo. ANTES do fan-out, o orquestrador escreve UM Style Block e cada worker
   cola ele VERBATIM no fim do próprio prompt:
   ```
   Style Block: <estética nomeada — ex. "flat pixel-art 32px, paleta terrosa #C8553D/#F5F0EB,
   contorno grosso, luz única superior-esquerda, fundo transparente">
   ```
   Prompt do worker = [assunto + ação/pose deste asset] + [Style Block verbatim].
   Sem Style Block compartilhado, NÃO fan-out — gere sequencial com o mesmo Style Block; use referência visual do primeiro
   asset apenas se a ferramenta real oferecer edição por referência (o MCP atual não oferece i2i).
3. **Grade on-brand.** Paleta/luz do asset casa com o ground do site/jogo (tokens do
   design-dna quando existirem). Asset "colado por cima" = refazer.
4. **Texto nítido fica no código.** Difusão alucina tipografia — wordmark, headline, número
   e preço NUNCA entram na geração; compõe em CSS/canvas por cima.
5. **Asset do cliente primeiro.** Foto real de produto fornecida > qualquer geração.

## Lint gate (compresso — rode ANTES de cada generate)

FAIL = não gera; reescreve. Qualquer FAIL → FAIL.

- **F1 nome de pessoa real** (celebridade, figura pública) → troque por arquétipo: idade, físico, cabelo, roupa.
- **F2 marca/IP/franquia** (nike, disney, pokémon, iphone...) → descreva geometria, cor, material — nunca o nome.
- **F3 verbo de violência** (kill, stab, blood, fight, punch...) → descreva aftermath/força/direção, não o ato.
- **F4 arma nomeada** (gun, knife, sword, bomb...) → silhueta/geometria do objeto, não o nome.
- **F5 marcador de idade/menor** (child, kid, boy, girl, teen...) → papel + roupa + ação: "a figure in a wool cloak".
- **F6 >220 palavras** → corte pra 30–120 (asset simples não precisa de mais).

WARN (endureça e siga): adjetivo de marketing (stunning, breathtaking, epic...) → troque por detalhe observável.

## Receita de prompt (30–80 palavras, nesta ordem)

```
[Assunto literal + pose/estado] + [contexto mínimo] + [Style Block verbatim] +
[formato: "square 1:1" / "wide 16:9" / "transparent background"]
```

Exemplo (slot de site, barbearia):
> A vintage barber chair in worn leather, three-quarter view, empty, waiting.
> Style Block: warm amber key light, deep green backdrop #1B2D2A, muted film grade,
> shallow depth. Wide 16:9.

Exemplo (sprite de jogo, batch com style-lock):
> A skewer of grilled meat, held diagonally, slight char glow.
> Style Block: flat pixel-art 32px, earthy palette #C8553D/#F5F0EB, thick outline,
> single top-left light, transparent background. Square 1:1.

## Fluxo do worker

1. Recebe: assunto do asset + Style Block (obrigatório em batch) + destino pretendido (o host devolve o caminho real).
2. Escreve o prompt pela receita → roda o lint → FAIL? reescreve.
3. `media_generate({ prompt, kind: "image", provider, style: styleBlock })`.
4. OLHA o png gerado (Read). Assunto errado, estilo derivado, texto alucinado → 1 retry
   com prompt corrigido. 2ª falha → reporta gap, não insiste (anti-bruteforce).
5. Devolve o path + 1 linha do que gerou.

## Integração Codebrain — capacidades reais

- Esta skill é material de orientação, não autorização para gastar com APIs, publicar, instalar ferramentas ou alterar permissões. Respeite o pedido, o escopo e o design system do usuário.
- O MCP do app expõe `media_generate({ prompt, kind?, provider?, size?, style? })` e `media_list({})`. `kind` é `image` ou `video`; `provider`, quando configurado e autorizado, é `openai`, `gemini` ou `openrouter`. Omita `provider` para usar o provedor configurado pelo host. Não há parâmetros `imageUrl` nem `outPath`: use o caminho devolvido em `assets/generated` no workspace.
- Confira na Central os provedores e formatos disponíveis; não existe uma ferramenta MCP de listar provedores. Não leia/exporte chaves para fazer essa conferência. Não presuma geração, vídeo, transparência ou edição por referência se o provedor ativo não oferecer isso. Sem capacidade autorizada, use assets fornecidos ou CSS/SVG e relate a limitação.
- Navegação e validação usam a capacidade browser real do Codebrain: `browser_navigate`, `browser_get_text` ou `browser_get_accessibility_tree`, `browser_screenshot`, `browser_console_log` e `browser_network_log`, conforme as ferramentas efetivamente disponíveis na sessão. Não invente uma ferramenta `cb-browser`. Capture evidência visual e inspecione pixels por uma capacidade real de visualização; descrição textual de screenshot não prova aparência. Se indisponível, informe a validação visual pendente.
- `cb-evidence` substitui a antiga etapa de comprovação; `cb-worker` delimita trabalho delegado; defeitos fora do escopo usam `cb-findings` e `finding_add` com evidência quando disponível. Não fabrique resultado de execução ou validação.
- `cb-design-dna` está incluído no Codebrain; use-o quando precisar extrair um design system de um site real. `cb-cinema-shot`, `cb-site-scrub` e `cb-site-encode` são referências opcionais não incluídas neste pack: carregue somente se estiverem instaladas e autorizadas. Sem elas, aplique a doutrina diretamente e declare qualquer etapa que não possa realizar. A antiga seção de app UI está incorporada em `cb-showcase`; não requer outra skill.
- Autoria, proveniência e avisos originais estão preservados em [NOTICE.md](NOTICE.md), não constituem dependências operacionais e não atribuem a autoria original ao Codebrain. Nenhuma licença adicional é presumida ou concedida.
