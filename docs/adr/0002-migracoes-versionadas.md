# ADR 0002 — Migrações de schema versionadas

**Status:** aceito · **Data:** 2026-08-13 · **Fase:** 1 (Fundação)

## Contexto

`packages/memory/store.js` construía o schema imperativamente: ~450 linhas de
`CREATE TABLE IF NOT EXISTS` seguidas de alterações assim:

```js
const addColumn = (table, colDef) => {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef}`); } catch {}
};
addColumn("actor_registry", "role TEXT DEFAULT 'worker'");
```

O `catch` vazio engole qualquer erro, não só "coluna já existe": um typo no
SQL, uma tabela ausente ou um banco corrompido viram no-op silencioso. A
coluna não aparece e a falha surge muito depois, como `no such column` em
runtime, longe da causa.

Não havia registro de versão — impossível saber em que estado um banco está,
ou escrever uma alteração que dependa de outra ter rodado antes. E não havia
transação: uma mudança de vários passos que falha no meio deixa o banco
inconsistente.

O banco é aberto por três runtimes (processo main, servidor MCP, daemon
stdio), o que torna cada um desses problemas mais provável, não menos.

## Decisão

Runner de migrações em `packages/memory/migrations.js`:

- **`PRAGMA user_version`** como contador de versão.
- **Uma transação por migração** — `up()` que estoura reverte inteira, e a
  versão não avança.
- **Falha ruidosa** — o erro sobe com número e nome da migração. Melhor o app
  não subir que subir com schema meio aplicado.
- **Tabela `schema_migrations`** para auditoria: o que rodou, quando, quanto
  demorou.
- **Guarda de downgrade** — banco mais novo que o código aborta com mensagem
  explícita, em vez de rodar código antigo contra schema novo.
- **Helpers de introspecção** (`hasTable`, `hasColumn`, `addColumnIfMissing`)
  que *perguntam ao schema* em vez de tentar-e-ignorar-o-erro.

`applyConnectionPragmas()` centraliza os PRAGMAs, incluindo o
**`busy_timeout = 5000`** que faltava — sem ele, um escritor concorrente
recebia `SQLITE_BUSY` na hora, que é o tipo de erro intermitente que os
`catch {}` do store vinham escondendo.

## Estratégia de baseline

O bloco imperativo continua rodando, **antes** das migrações, e é idempotente.
A versão 1 (`baseline`) não cria nada: ela verifica que o bloco legado
produziu as 14 tabelas base e carimba esse estado.

Isso torna a adoção segura para os bancos já em campo (`user_version = 0`,
schema completo): eles recebem o carimbo sem alteração. Bancos novos chegam ao
mesmo ponto pelo mesmo caminho.

Da versão 2 em diante, o bloco legado migra para cá aos poucos — cada tabela
movida vira uma migração, e o `CREATE ... IF NOT EXISTS` correspondente sai do
`createMemoryStore()`. É o caminho para eliminar o bloco imperativo sem um big
bang no banco de todo mundo. Esse trabalho é da Fase 5.

## Consequências

- Toda alteração de schema a partir de agora entra em
  `packages/memory/schema-migrations.js`. Migração publicada é imutável;
  corrigir é adicionar outra.
- O runner é testado (`migrations.test.js`, 18 casos) com SQLite real em
  `:memory:` — rollback, ordenação, idempotência e guarda de downgrade não são
  verificáveis com mock.
- `store.schemaVersion()` expõe a versão para diagnóstico.

## Nota

A guarda de downgrade nasceu com um bug que o próprio teste pegou: estava
depois do early-return de "nada pendente" e, como banco à frente do código
nunca tem migração pendente, ela jamais disparava no caso que existe para
pegar. Vale como evidência de por que o runner precisa de teste.
