# RFC — Sistema de Webhooks de Notificação de Pedidos

## Metadados

| Campo | Valor |
| --- | --- |
| **Autor** | Larissa (Tech Lead) |
| **Status** | Em revisão |
| **Data** | Não especificada na fonte (reunião técnica de "quinta-feira, 09:00") |
| **Revisores** | Marcos (Product Manager), Bruno (Eng. Pleno — Pedidos), Diego (Eng. Sênior — Plataforma), Sofia (Eng. de Segurança) |
| **Decisões relacionadas** | [ADR-001](./adrs/ADR-001-outbox-no-mysql.md), [ADR-002](./adrs/ADR-002-worker-processo-separado-polling.md), [ADR-003](./adrs/ADR-003-retry-backoff-exponencial-dlq.md), [ADR-004](./adrs/ADR-004-hmac-sha256-secret-por-endpoint.md), [ADR-005](./adrs/ADR-005-entrega-at-least-once-x-event-id.md), [ADR-006](./adrs/ADR-006-reuso-de-padroes-existentes.md) |

---

## 1. Resumo executivo (TL;DR)

Propomos um sistema de **webhooks outbound** que notifica clientes B2B, em tempo quase real
(< 10s), sempre que o status de um pedido muda. A solução usa o **padrão Outbox no MySQL já
existente**: o evento é gravado na mesma transação que altera o status do pedido, e um **worker
em processo separado** faz *polling* a cada 2 segundos para entregar via HTTP POST assinado com
**HMAC-SHA256**. Falhas são reentregues com **backoff exponencial (5 tentativas)** e, esgotadas,
vão para uma **Dead Letter Queue** com replay manual. A garantia é **at-least-once**, com
deduplicação pelo cliente via `X-Event-Id`. O módulo reaproveita integralmente os padrões do
projeto (estrutura modular, `AppError`, Pino, `requireRole`), sem introduzir nova infraestrutura.

Estimativa da Tech Lead: **3 sprints**, incluindo revisão de segurança. [09:46]

## 2. Contexto e problema

Três clientes B2B (Atlas Comercial, MaxDistribuição, Nova Cargo) pediram formalmente para serem
notificados quando o status de seus pedidos muda. Hoje eles fazem *polling* manual em
`GET /orders`, o que deixa a integração lenta e cara; a Atlas sinalizou risco de migrar para um
concorrente se a entrega não sair até o fim do trimestre. [09:00–09:02 Marcos]

O OMS atual **não possui** nenhum mecanismo de notificação externa, eventos, filas ou webhooks.
A mudança de status acontece em `OrderService.changeStatus`, dentro de uma transação Prisma que
já atualiza o pedido, o histórico e o estoque. O desafio central é emitir notificações confiáveis
**sem** acoplar a latência/disponibilidade de clientes externos a essa transação crítica. [09:04 Bruno]

## 3. Proposta técnica (visão geral)

**Fluxo de emissão.** Ao mudar o status, `changeStatus` insere — na mesma transação — um evento
já renderizado (snapshot) na tabela `webhook_outbox`, via uma função `publishWebhookEvent(tx, …)`.
Se a transação commita, o evento existe; se dá rollback, some junto. O evento só é inserido se
algum webhook do cliente estiver inscrito naquele status (filtro na inserção). [ADR-001, 09:34]

**Fluxo de entrega.** Um worker dedicado (`src/worker.ts`, `npm run worker`), em processo
separado da API e com `PrismaClient` próprio, faz *polling* a cada 2s pelos eventos pendentes
mais antigos, monta o payload, assina com HMAC-SHA256 e envia via HTTP POST (timeout 10s). [ADR-002]

**Resiliência.** Falha de entrega dispara retry com backoff **1m/5m/30m/2h/12h** (5 tentativas).
Esgotadas, o evento vai para `webhook_dead_letter`, reprocessável por um endpoint admin
(`POST /admin/webhooks/dead-letter/:id/replay`, role `ADMIN`). [ADR-003]

**Segurança.** Assinatura HMAC-SHA256 no header `X-Signature`, com **secret única por endpoint**
e rotação com *grace period* de 24h. TLS obrigatório (URL https) e limite de payload de 64KB são
validações de schema. [ADR-004]

**Entrega.** Garantia **at-least-once**; cada evento carrega `X-Event-Id` (UUID) para o cliente
deduplicar. [ADR-005]

**Superfície de API (CRUD).** Endpoints autenticados para cadastrar, editar, remover e listar
webhooks de um customer, além de consultar o histórico de entregas. O `customer_id` vem do
corpo/rota, **não** do JWT. [09:31–09:33]

**Reuso.** O módulo `src/modules/webhooks` segue o padrão dos demais módulos e reaproveita
`AppError` (códigos `WEBHOOK_*`), o error middleware, o logger Pino e `requireRole`. [ADR-006]

> O detalhamento de contratos, payloads, matriz de erros e integração linha a linha com o código
> fica no **[FDD](./FDD.md)**; este RFC descreve *o que* propomos e *por quê*.

## 4. Alternativas consideradas

| Alternativa | Trade-off que levou ao descarte |
| --- | --- |
| **Disparo síncrono no `order.service`** | Simples, mas acopla a latência e a disponibilidade do cliente externo ao lock da transação de `changeStatus`, e não permite rollback seguro se o cliente está offline. [09:04, 09:06] |
| **Redis Streams / fila externa** | Desacoplaria bem, mas exige subir e operar nova infraestrutura (Redis Cluster) — overengineering para um time pequeno, quando o MySQL existente resolve. [09:07 Diego] |
| **Trigger de banco para reatividade** | MySQL não tem NOTIFY/LISTEN; um trigger só executa SQL e não notifica processo externo. Improvisar (arquivo/endpoint) é frágil; polling de 2s já atende o SLA. [09:09 Diego] |
| **Exactly-once na entrega** | Eliminaria duplicatas, mas exige coordenação dos dois lados, muito mais complexa. At-least-once + `X-Event-Id` resolve 99% dos casos. [09:25 Diego] |
| **3 tentativas de retry** | Mais agressivo, mas mataria eventos de clientes com indisponibilidade de horas (ex.: manutenção planejada de 2h). 5 tentativas cobrem ~12–24h. [09:16] |

## 5. Questões em aberto

1. **Rate limiting de saída.** Se um cliente tem 50 pedidos mudando de status em um minuto,
   podemos bombardeá-lo com 50 chamadas. A equipe decidiu *observar e decidir depois*, não entra
   nesta fase. [09:38–09:39 Diego/Larissa]
2. **Estratégia de escala do worker.** Com single-worker, a ordenação é garantida só por
   `order_id`. Escalar para múltiplos workers (particionar por `order_id` ou lock pessimista)
   fica como problema futuro. [09:12–09:13 Diego]
3. **Critério de falha HTTP e retenção da DLQ.** Quais códigos de resposta contam como falha vs.
   sucesso, e qual a política de expurgo de `webhook_dead_letter`, não foram decididos. [ADR-003]
4. **Storage da secret em repouso e rate limit de rotação.** Formato de armazenamento (texto
   plano vs. hash/cripto) e limite de frequência de rotação ficaram em aberto. [ADR-004]

## 6. Impacto e riscos

**Impacto no código existente.** A única alteração intrusiva é dentro de `changeStatus`
(`src/modules/orders/order.service.ts`), que passa a chamar `publishWebhookEvent(tx, …)` dentro
da transação. O restante é aditivo: novo módulo, novas tabelas, novo entry-point de worker.

| Risco | Prob. | Impacto | Mitigação |
| --- | --- | --- | --- |
| Inserção da outbox falhar e derrubar a transação de status | Baixa | Alto | Insert simples e indexado; a atomicidade é justamente o objetivo — sem outbox, sem mudança de status. [09:40] |
| `requireRole`/replay admin sem cobertura de teste hoje | Média | Médio | Adicionar testes do endpoint admin antes do deploy; revisão de segurança dedicada (2 dias úteis). [09:36, 09:46] |
| Cliente lento (>10s) tratado como falha e reentrando no retry | Média | Baixo | Timeout de 10s documentado; 5 tentativas absorvem picos de lentidão. [09:42] |
| Crescimento indefinido de `webhook_outbox` | Média | Médio | Arquivamento de entregues (~30 dias) — identificado, fora do escopo desta fase. [09:08] |
| Colisão de códigos `WEBHOOK_*` (sem registro central) | Baixa | Baixo | Convenção de prefixo e revisão de code review. [ADR-006] |

## 7. Decisões relacionadas

- [ADR-001 — Padrão Outbox no MySQL](./adrs/ADR-001-outbox-no-mysql.md)
- [ADR-002 — Worker em processo separado com polling de 2s](./adrs/ADR-002-worker-processo-separado-polling.md)
- [ADR-003 — Retry com backoff exponencial e DLQ](./adrs/ADR-003-retry-backoff-exponencial-dlq.md)
- [ADR-004 — HMAC-SHA256 com secret por endpoint](./adrs/ADR-004-hmac-sha256-secret-por-endpoint.md)
- [ADR-005 — Entrega at-least-once com X-Event-Id](./adrs/ADR-005-entrega-at-least-once-x-event-id.md)
- [ADR-006 — Reuso dos padrões existentes do projeto](./adrs/ADR-006-reuso-de-padroes-existentes.md)
