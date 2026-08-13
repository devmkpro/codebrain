# ADR 0004 — Conversa durável, saúde da memória e Spec Kit

**Status:** aceito · **Data:** 2026-08-13 · **Fases:** 4–6

## Conversa

A timeline usa `agent_messages` no SQLite como fonte durável. A fila em memória
continua responsável por entrega de baixa latência, mas não serve como histórico:
ela tem TTL e pode desaparecer ao reiniciar. Mensagens do operador são persistidas
antes de serem escritas no PTY e podem referenciar uma mensagem pai.

## Memória

O painel passa a expor versão do schema, tamanho, espaço recuperável, journal e
disponibilidade de FTS5. A manutenção aplica a política existente de retenção de
memórias `working` (7 dias / 500 entradas) e executa `PRAGMA optimize`. Os limites
recebidos por IPC são normalizados para impedir operações acidentais sem limite.

## Spec Kit

Cada workspace mantém specs em `specs/NNN-slug/`, com `spec.md`, `plan.md` e
`tasks.md`. A criação acontece no processo main, com validação de workspace, slug,
ID e nome de arquivo. O renderer nunca envia um caminho arbitrário para abrir.
O fluxo fica disponível como ação pesquisável no palette.
