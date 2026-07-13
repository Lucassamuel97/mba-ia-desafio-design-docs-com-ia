# Fase 2 — Changeset de demonstração

Este diretório contém a mudança de código usada para provar o mecanismo de documentação viva
(Parte 2). Ela é a **única** alteração de código sancionada pelo desafio.

## A mudança

`order-status-change.patch` adiciona uma nova transição na máquina de estados de pedidos
(`src/modules/orders/order.status.ts`): um pedido em **`SHIPPED`** agora pode ir para
**`CANCELLED`** (antes só podia ir para `DELIVERED`).

Isso torna a máquina de estados 6 status / 8 transições (antes eram 7).

## Como aplicar

```bash
git apply fase-2/order-status-change.patch
git add src/modules/orders/order.status.ts
git commit -m "feat(orders): permite transição SHIPPED -> CANCELLED (changeset fase 2)"
```

## Como o mecanismo reage

Depois de commitado, rode:

```bash
npm run docs:update   # node tools/docs-site/update.mjs
```

O mecanismo lê o `source_commit` de `docs/site/docs-meta.json`, roda
`git diff <source_commit>..HEAD`, descobre que `src/modules/orders/order.status.ts` mudou e,
via as linhas do `docs/TRACKER.md` com Fonte = `CODIGO`, mapeia essa mudança para o item
`FDD-INT-02` em `docs/FDD.md`. A IA então atualiza apenas os documentos afetados para refletir
a nova transição, e o `npm run docs:build` regenera o HTML e re-ancora o `source_commit` no HEAD.
