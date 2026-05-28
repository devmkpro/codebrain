# Autopart Scraper — Skill para CodeBrain

## O que faz

Dado um URL de um site de autopeças, este skill inspeciona o site automaticamente,
infere um plano de extração JSON (ExtractionPlan) e gera um script Python que
executa o scraping completo usando o motor whitelabel_scrapper.

**Resultado final:** um plano JSON em `plans/<domain>.json` e um script standalone
em `scripts/scrape_<domain>.py` pronto para execução.

## Como invocar

No CodeBrain, digite:

```
/autopart-scraper https://ford.oempartsonline.com
```

O agente irá:
1. Abrir o site no browser e inspecionar a estrutura (menu, listing, detail)
2. Inferir os seletores CSS e montar o ExtractionPlan
3. Validar o plano com a CLI do motor
4. Testar a extração com uma URL real (dry-run)
5. Gerar o script standalone

## Pré-requisitos

- Motor whitelabel_scrapper em `C:\Users\Maike\Documents\whitelabel_scrapper\`
- Chrome instalado com perfil acessível
- Diretórios `plans/` e `scripts/` no workspace (criados automaticamente se necessário)

## Estrutura gerada

```
whitelabel_scrapper/
├── plans/
│   └── <domain>.json              ← plano de extração gerado
├── scripts/
│   └── scrape_<domain>.py         ← script standalone gerado
└── sessions/
    └── <domain>/
        └── cookies.json           ← cookies CF (criado em runtime)
```

## Como executar o script gerado

```bash
cd C:\Users\Maike\Documents\whitelabel_scrapper
python scripts/scrape_ford_oempartsonline_com.py
```

O script vai:
1. Abrir Chrome com perfil persistido
2. Navegar até o site
3. Se Cloudflare bloquear, pausar para que você resolva o CAPTCHA manualmente
4. Descobrir categorias automaticamente
5. Listar produtos em todas as páginas
6. Extrair detalhes de cada produto (nome, SKU, marca, imagens, aplicações)
7. Salvar em CSV (`products_<domain>.csv`)

## Validação do site (Fase 0)

Antes de inspecionar, o skill verifica se o URL aponta para um site real:
- Checa se o texto tem mais de 200 caracteres
- Detecta placeholders ("domain for sale", "coming soon", "404", etc.)
- Verifica se o HTML tem pelo menos 2KB
- Confirma com o usuário antes de prosseguir

Isso evita que o agente trave em sites que não são de autopeças.

## Regra de execução

O skill executa **single-agent** (sem squad/sub-agentes). Todo o trabalho é
feito no próprio pane do agente. Isso garante heartbeat consistente e evita
travas silenciosas.

## Sites suportados

Qualquer site de autopeças com estrutura similar a:
- Menu de categorias em HTML (não SPA pura)
- Listing pages com links de produtos
- Detail pages com informações do peça

Especificamente otimizado para sites white-label do grupo oempartsonline.com
(Acura, Ford, Honda, Hyundai, Lexus, Mazda, etc.), mas funciona com outros
sites se os seletores forem inferidos corretamente.

## Motor CLI — referência rápida

```bash
# Validar um plano
python -m motor.cli validate plans/<domain>.json

# Ver detalhes do plano
python -m motor.cli inspect plans/<domain>.json

# Testar extração com uma URL
python -m motor.cli inspect plans/<domain>.json --url <URL> --as detail

# Executar scraping completo
python -m motor.cli run plans/<domain>.json --tier insane
```

## Limitações

- Requer Chrome (não funciona headless sem perfil)
- Sites com JS puro (SPA) podem não ter HTML estático suficiente
- CAPTCHA do Cloudflare requer intervenção manual na primeira vez
- Cookies são persistidos e reusados em execuções subsequentes
