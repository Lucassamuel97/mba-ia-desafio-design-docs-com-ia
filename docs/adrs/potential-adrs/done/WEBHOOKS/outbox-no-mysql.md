# Potential ADR — Padrão Outbox no MySQL para eventos de webhook

**Módulo:** WEBHOOKS
**Prioridade:** must-document
**Decisão fechada na reunião:** sim

## Contexto
A feature de webhooks precisa notificar clientes B2B quando o status de um pedido muda.
A dúvida inicial foi: disparar a chamada HTTP de forma síncrona dentro do `changeStatus`
ou registrar o evento e processar fora da transação.

Disparo síncrono foi descartado: a transação de mudança de status já é pesada — atualiza
`orders`, insere em `order_status_history` e decrementa `stock_quantity`. Um HTTP call no
meio acoplaria a latência do cliente ao tempo de lock do banco, e um cliente offline
forçaria a pergunta impossível de "dar rollback na mudança de status". [09:04 Bruno]

Decidiu-se pelo padrão **Outbox**: na mesma transação SQL que muda o status, insere-se uma
linha em `webhook_outbox`. Se a transação commita, o evento está garantido; se dá rollback,
o evento some junto — sem inconsistência possível. [09:06 Diego]

## Decisão
Adotar o padrão Outbox persistido no MySQL já existente. O evento é inserido na tabela
`webhook_outbox` dentro da mesma transação Prisma do `changeStatus`, via uma função
`publishWebhookEvent(tx, order, fromStatus, toStatus)` que recebe o `tx` client. [09:41 Bruno/Diego]

## Alternativas consideradas
- **Disparo síncrono no order.service** — descartado: acopla latência externa à transação e
  não permite rollback seguro. [09:04, 09:06]
- **Redis Streams / fila externa** — descartado: exigiria subir mais infra (Redis Cluster),
  overengineering para um time pequeno. Outbox no MySQL existente resolve. [09:07 Diego]

## Consequências
- Positiva: atomicidade total entre mudança de status e registro do evento; zero infra nova.
- Positiva: tabela indexada por status e `created_at`; worker lê pendentes em batch pequeno. [09:08]
- Negativa: exige um worker de polling para processar a outbox (ver ADR do worker).
- Negativa: acúmulo de linhas exige arquivamento (linhas entregues após ~30 dias, fora de escopo). [09:08]

## Fontes / rastreabilidade
- TRANSCRICAO: [09:04] Bruno, [09:06] Diego, [09:07] Diego, [09:08] Diego, [09:41] Bruno/Diego
- CODIGO: `src/modules/orders/order.service.ts` (método `changeStatus`, linhas 126-179; hook de insert entre a linha 167 e 169, com `tx`/`order`/`from`/`to` em escopo)
- CODIGO: `prisma/schema.prisma` (nova tabela `webhook_outbox`, IDs em UUID conforme padrão do projeto [09:51])
